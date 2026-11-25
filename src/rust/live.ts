import { EventEmitter } from "node:events";
import RustPlus, { type AppEntityPayload, type AppMessage, type AppResponse } from "@liamcottle/rustplus.js";
import type {
  EntityPayload,
  GameTime,
  MapMarker,
  RustServer,
  RustServerEvents,
  ServerInfo,
  TeamInfo,
} from "./types.js";

export interface LiveServerOptions {
  ip: string;
  port: number;
  /** Your Steam id (64-bit, as a string). */
  playerId: string;
  /** The Rust+ player token from pairing (a number). */
  playerToken: number;
  /** Route through Facepunch's proxy when the server's app port is not reachable directly. */
  useFacepunchProxy?: boolean;
}

/** Translates the Rust+ protocol message into the app's payload type. */
export function toEntityPayload(p: AppEntityPayload): EntityPayload {
  const payload: EntityPayload = {};
  if (p.value !== undefined && p.value !== null) {
    payload.value = p.value;
  }
  if (p.capacity !== undefined && p.capacity !== null && p.capacity > 0) {
    payload.capacity = p.capacity;
    payload.itemCount = p.items?.length ?? 0;
  }
  if (p.hasProtection !== undefined && p.hasProtection !== null) {
    payload.hasProtection = p.hasProtection;
    payload.protectionExpiry = p.protectionExpiry ?? 0;
  }
  return payload;
}

/** Rust+ answers failed requests with { error: "not_found" } objects, not Errors. */
function asError(e: unknown): Error {
  if (e instanceof Error) {
    return e;
  }
  const code = (e as { error?: string } | undefined)?.error;
  return new Error(code ? `Rust+ error: ${code}` : String(e));
}

/**
 * The real thing: a Rust+ websocket connection (via @liamcottle/rustplus.js) behind the
 * RustServer interface. Reconnects with backoff when the server restarts or the connection drops.
 */
export class LiveServer extends EventEmitter<RustServerEvents> implements RustServer {
  private readonly client: RustPlus;
  private wantConnected = false;
  private retryDelay = 5;

  constructor(options: LiveServerOptions) {
    super();
    this.client = new RustPlus(options.ip, options.port, options.playerId, options.playerToken, options.useFacepunchProxy ?? false);

    this.client.on("connected", () => {
      this.retryDelay = 5;
      this.emit("connected");
    });
    this.client.on("disconnected", () => {
      this.emit("disconnected");
      if (this.wantConnected) {
        // Servers restart daily and on wipe: keep trying, slower each time, up to five minutes.
        setTimeout(() => this.wantConnected && this.client.connect(), this.retryDelay * 1000);
        this.retryDelay = Math.min(this.retryDelay * 2, 300);
      }
    });
    this.client.on("error", (e: Error) => console.error(`Rust+ connection error: ${e.message}`));
    this.client.on("message", (message: AppMessage) => {
      const chat = message.broadcast?.teamMessage?.message;
      if (chat) {
        this.emit("teamMessage", { steamId: chat.steamId.toString(), name: chat.name, message: chat.message, time: chat.time });
      }
      const changed = message.broadcast?.entityChanged;
      if (changed) {
        this.emit("entityChanged", changed.entityId, toEntityPayload(changed.payload));
      }
    });
  }

  connect(): Promise<void> {
    this.wantConnected = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Could not connect to the Rust+ server within 20 seconds")), 20_000);
      this.client.once("connected", () => {
        clearTimeout(timer);
        resolve();
      });
      this.client.connect();
    });
  }

  disconnect(): void {
    this.wantConnected = false;
    this.client.disconnect();
  }

  private async request(data: Record<string, unknown>): Promise<AppResponse> {
    try {
      return await this.client.sendRequestAsync(data);
    } catch (e) {
      throw asError(e);
    }
  }

  async getInfo(): Promise<ServerInfo> {
    const info = (await this.request({ getInfo: {} })).info!;
    return {
      name: info.name,
      map: info.map,
      mapSize: info.mapSize,
      wipeTime: info.wipeTime,
      players: info.players,
      maxPlayers: info.maxPlayers,
      queuedPlayers: info.queuedPlayers,
    };
  }

  async getTime(): Promise<GameTime> {
    const t = (await this.request({ getTime: {} })).time!;
    return { time: t.time, sunrise: t.sunrise, sunset: t.sunset, dayLengthMinutes: t.dayLengthMinutes, timeScale: t.timeScale };
  }

  async getTeam(): Promise<TeamInfo> {
    const team = (await this.request({ getTeamInfo: {} })).teamInfo!;
    return {
      leaderSteamId: team.leaderSteamId.toString(),
      members: team.members.map((m) => ({
        steamId: m.steamId.toString(),
        name: m.name,
        x: m.x,
        y: m.y,
        isOnline: m.isOnline,
        isAlive: m.isAlive,
      })),
    };
  }

  async getMarkers(): Promise<MapMarker[]> {
    const markers = (await this.request({ getMapMarkers: {} })).mapMarkers?.markers ?? [];
    return markers.map((m) => (m.name ? { id: m.id, type: m.type, x: m.x, y: m.y, name: m.name } : { id: m.id, type: m.type, x: m.x, y: m.y }));
  }

  async getEntity(entityId: number): Promise<EntityPayload> {
    // Querying an entity also subscribes this connection to its changes.
    return toEntityPayload((await this.request({ entityId, getEntityInfo: {} })).entityInfo!.payload);
  }

  async setSwitch(entityId: number, on: boolean): Promise<void> {
    await this.request({ entityId, setEntityValue: { value: on } });
  }

  async sendTeamMessage(message: string): Promise<void> {
    await this.request({ sendTeamMessage: { message } });
  }
}
