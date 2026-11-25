import { EventEmitter } from "node:events";
import type {
  Device,
  EntityPayload,
  GameTime,
  MapMarker,
  RustServer,
  RustServerEvents,
  ServerInfo,
  TeamInfo,
  TeamMember,
  TeamMessage,
} from "./types.js";
import { MarkerType } from "./types.js";

const MAP_SIZE = 4000;
/** The demo story repeats every 10 minutes. */
const LOOP_SECONDS = 600;

/** Devices the simulated base has; the demo config pairs exactly these. */
export const SIMULATED_DEVICES: Device[] = [
  { entityId: 1001, name: "Main base alarm", kind: "alarm" },
  { entityId: 2001, name: "Base lights", kind: "switch" },
  { entityId: 2002, name: "Auto turrets", kind: "switch" },
  { entityId: 3001, name: "Main tool cupboard", kind: "monitor" },
];

export const SIMULATED_PLAYER = { steamId: "76561190000000001", name: "You" };

interface Step {
  at: number;
  run: (sim: SimulatedServer) => void;
}

/**
 * An in-memory Rust server: a team of four, a base with an alarm, two switches and a tool
 * cupboard, and a scripted ten-minute story (cargo ship, patrol helicopter shot down, a raid,
 * deaths, chat). Time only moves when `advance` is called, so tests are deterministic; the demo
 * calls it once per second.
 */
export class SimulatedServer extends EventEmitter<RustServerEvents> implements RustServer {
  /** Seconds since the simulation started. */
  elapsed = 0;
  /** Unix seconds that correspond to elapsed = 0. */
  readonly startUnix: number;
  connected = false;
  readonly sentMessages: string[] = [];

  private readonly team: TeamMember[];
  private markers = new Map<number, MapMarker>();
  private readonly entities = new Map<number, EntityPayload>();
  private readonly subscribed = new Set<number>();
  private gameHour = 9.5;
  private nextMarkerId = 100;
  private cargo: { id: number; heading: number } | undefined;
  private heli: number | undefined;
  private readonly timeline: readonly Step[];
  private stepIndex = 0;
  private readonly pending: Array<{ at: number; run: () => void }> = [];

  constructor(startUnix = Math.floor(Date.now() / 1000)) {
    super();
    this.startUnix = startUnix;
    this.team = [
      member(SIMULATED_PLAYER.steamId, SIMULATED_PLAYER.name, 1810, 2240, true),
      member("76561190000000002", "Ana", 1840, 2210, true),
      member("76561190000000003", "Ben", 1790, 2260, false),
      member("76561190000000004", "Chloe", 2550, 1500, true),
    ];
    this.entities.set(1001, { value: false });
    this.entities.set(2001, { value: true });
    this.entities.set(2002, { value: false });
    // The cupboard holds upkeep for 3 h 09.5 min: it drops below the 3-hour warning after 9.5 minutes.
    this.entities.set(3001, { capacity: 24, itemCount: 9, hasProtection: true, protectionExpiry: startUnix + 189 * 60 + 30 });
    for (const [x, y] of [[1200, 2900], [2600, 1100], [3100, 3000]] as const) {
      this.addMarker(MarkerType.VendingMachine, x, y, "Shop");
    }
    this.timeline = story();
  }

  // ------------------------------------------------------------------------------------------
  // RustServer

  async connect(): Promise<void> {
    this.connected = true;
    this.emit("connected");
  }

  disconnect(): void {
    this.connected = false;
    this.emit("disconnected");
  }

  async getInfo(): Promise<ServerInfo> {
    return {
      name: "RaidBell Simulated | Monthly | 2x",
      map: "Procedural Map",
      mapSize: MAP_SIZE,
      wipeTime: this.startUnix - 3 * 86400,
      players: 142 + Math.round(10 * Math.sin(this.elapsed / 60)),
      maxPlayers: 200,
      queuedPlayers: 0,
    };
  }

  async getTime(): Promise<GameTime> {
    return { time: this.gameHour, sunrise: 7.5, sunset: 19.5, dayLengthMinutes: 45, timeScale: 1 };
  }

  async getTeam(): Promise<TeamInfo> {
    return { leaderSteamId: SIMULATED_PLAYER.steamId, members: this.team.map((m) => ({ ...m })) };
  }

  async getMarkers(): Promise<MapMarker[]> {
    return [...this.markers.values()].map((m) => ({ ...m }));
  }

  async getEntity(entityId: number): Promise<EntityPayload> {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} is not paired`);
    }
    this.subscribed.add(entityId);
    return { ...entity };
  }

  async setSwitch(entityId: number, on: boolean): Promise<void> {
    const entity = this.entities.get(entityId);
    if (!entity || entity.value === undefined) {
      throw new Error(`Entity ${entityId} is not a switch`);
    }
    this.setEntity(entityId, { ...entity, value: on });
  }

  async sendTeamMessage(message: string): Promise<void> {
    this.sentMessages.push(message);
    // The game echoes your own messages back, like the real server does.
    this.chat(SIMULATED_PLAYER.name, message, SIMULATED_PLAYER.steamId);
  }

  // ------------------------------------------------------------------------------------------
  // Simulation controls (used by the story, tests and the demo)

  /** Moves the world forward by `seconds`, running every story step that falls into that span. */
  advance(seconds: number): void {
    for (let i = 0; i < seconds; i++) {
      this.elapsed++;
      this.gameHour = (this.gameHour + 24 / (45 * 60)) % 24;
      this.moveCargo();
      const loopTime = this.elapsed % LOOP_SECONDS;
      if (loopTime === 0) {
        this.stepIndex = 0;
      }
      while (this.stepIndex < this.timeline.length && this.timeline[this.stepIndex]!.at <= loopTime) {
        this.timeline[this.stepIndex]!.run(this);
        this.stepIndex++;
      }
      for (const due of this.pending.filter((p) => p.at <= this.elapsed)) {
        this.pending.splice(this.pending.indexOf(due), 1);
        due.run();
      }
    }
  }

  chat(name: string, message: string, steamId = this.team.find((m) => m.name === name)?.steamId ?? "0"): void {
    const msg: TeamMessage = { steamId, name, message, time: this.startUnix + this.elapsed };
    this.emit("teamMessage", msg);
  }

  setEntity(entityId: number, payload: EntityPayload): void {
    this.entities.set(entityId, payload);
    if (this.subscribed.has(entityId)) {
      this.emit("entityChanged", entityId, { ...payload });
    }
  }

  updateMember(name: string, change: Partial<TeamMember>): void {
    const m = this.team.find((t) => t.name === name);
    if (m) {
      Object.assign(m, change);
    }
  }

  addMarker(type: number, x: number, y: number, name?: string): number {
    const id = this.nextMarkerId++;
    this.markers.set(id, name === undefined ? { id, type, x, y } : { id, type, x, y, name });
    return id;
  }

  removeMarker(id: number): void {
    this.markers.delete(id);
  }

  spawnCargo(): void {
    this.cargo = { id: this.addMarker(MarkerType.CargoShip, -300, 1700), heading: 1 };
  }

  spawnHeli(): void {
    this.heli = this.addMarker(MarkerType.PatrolHelicopter, 2300, 2600);
  }

  /** The helicopter is shot down: its marker goes, an explosion marker appears where it was. */
  shootDownHeli(): void {
    if (this.heli === undefined) {
      return;
    }
    const heli = this.markers.get(this.heli)!;
    this.removeMarker(this.heli);
    this.heli = undefined;
    const explosion = this.addMarker(MarkerType.Explosion, heli.x + 40, heli.y - 30);
    // Explosion markers fade after a while.
    this.timelineAfter(120, () => this.removeMarker(explosion));
  }

  private moveCargo(): void {
    if (!this.cargo) {
      return;
    }
    const marker = this.markers.get(this.cargo.id);
    if (!marker) {
      this.cargo = undefined;
      return;
    }
    marker.x += 9;
    if (marker.x > MAP_SIZE + 300) {
      this.removeMarker(this.cargo.id);
      this.cargo = undefined;
    }
  }

  private timelineAfter(seconds: number, run: () => void): void {
    this.pending.push({ at: this.elapsed + seconds, run });
  }
}

function member(steamId: string, name: string, x: number, y: number, isOnline: boolean): TeamMember {
  return { steamId, name, x, y, isOnline, isAlive: true };
}

/** The ten-minute demo story. */
function story(): Step[] {
  return [
    { at: 20, run: (s) => s.chat("Ana", "morning! farming sulfur at the quarry") },
    { at: 30, run: (s) => s.spawnCargo() },
    { at: 45, run: (s) => s.chat("Chloe", "cargo just spawned, going?") },
    { at: 60, run: (s) => s.updateMember("Ben", { isOnline: true }) },
    { at: 90, run: (s) => s.spawnHeli() },
    { at: 120, run: (s) => s.updateMember("Chloe", { isAlive: false }) },
    { at: 125, run: (s) => s.chat("Chloe", "died to a scientist on cargo :(") },
    { at: 140, run: (s) => s.updateMember("Chloe", { isAlive: true, x: 1820, y: 2230 }) },
    { at: 170, run: (s) => s.shootDownHeli() },
    { at: 200, run: (s) => s.setEntity(1001, { value: true }) },
    { at: 205, run: (s) => s.chat("Ana", "RAID! they are at the east wall") },
    { at: 230, run: (s) => s.setEntity(1001, { value: false }) },
    { at: 260, run: (s) => s.addMarker(MarkerType.Chinook, 600, 3400) },
    { at: 420, run: (s) => s.updateMember("Ben", { isOnline: false }) },
  ];
}
