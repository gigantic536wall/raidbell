import { EventEmitter } from "node:events";
import type { Device, RustServer } from "../rust/types.js";
import type { Alert } from "./alerts.js";
import { DeviceWatcher } from "./devices.js";
import { MarkerWatcher } from "./markers.js";
import { TeamWatcher } from "./team.js";

export interface MonitorOptions {
  devices: Device[];
  /** How often to poll the map and team. 0 = never (tests call poll() themselves). */
  pollSeconds?: number;
  /** The paired player's Steam id: no team notifications about yourself. */
  ownSteamId?: string;
  upkeepWarnMinutes?: number;
  now?: () => number;
}

interface MonitorEvents {
  alert: [Alert];
  error: [Error];
}

/**
 * Connects the watchers to a Rust server: polls map markers and the team, subscribes to paired
 * devices, forwards team chat, and emits one stream of alerts for the Telegram side.
 */
export class Monitor extends EventEmitter<MonitorEvents> {
  readonly devices: DeviceWatcher;
  mapSize = 4000;

  private readonly markers = new MarkerWatcher();
  private readonly team: TeamWatcher;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  /** Messages the bridge sent recently; the game echoes them back and they must not loop. */
  private readonly recentlySent = new Map<string, number>();

  constructor(
    private readonly server: RustServer,
    private readonly options: MonitorOptions,
  ) {
    super();
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.team = new TeamWatcher(options.ownSteamId);
    this.devices = new DeviceWatcher(options.devices, { warnMinutes: options.upkeepWarnMinutes ?? 180 });

    server.on("teamMessage", (msg) => {
      if (this.isEcho(msg.message)) {
        return;
      }
      this.publish([{ kind: "chat", name: msg.name, message: msg.message }]);
    });
    server.on("entityChanged", (entityId, payload) => this.publish(this.devices.update(entityId, payload, this.now())));
  }

  async start(): Promise<void> {
    await this.server.connect();
    this.mapSize = (await this.server.getInfo()).mapSize;
    // Querying a device once subscribes to its changes; the first reading also seeds the watchers.
    for (const device of this.options.devices) {
      try {
        this.publish(this.devices.update(device.entityId, await this.server.getEntity(device.entityId), this.now()));
      } catch (e) {
        this.emit("error", new Error(`Device "${device.name}" (${device.entityId}) did not answer: ${(e as Error).message}`));
      }
    }
    await this.poll();
    const seconds = this.options.pollSeconds ?? 10;
    if (seconds > 0) {
      this.timer = setInterval(() => void this.poll(), seconds * 1000);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.server.disconnect();
  }

  /** One round of map, team and upkeep checks. */
  async poll(): Promise<void> {
    try {
      const [markers, team] = await Promise.all([this.server.getMarkers(), this.server.getTeam()]);
      this.publish([
        ...this.markers.update(markers, this.mapSize),
        ...this.team.update(team, this.mapSize),
        ...this.devices.check(this.now()),
      ]);
    } catch (e) {
      this.emit("error", e as Error);
    }
  }

  /** Sends a message to the in-game team chat, remembering it so the echo is not forwarded back. */
  async sendTeamMessage(text: string): Promise<void> {
    this.recentlySent.set(text, this.now());
    await this.server.sendTeamMessage(text);
  }

  private isEcho(text: string): boolean {
    const sentAt = this.recentlySent.get(text);
    for (const [key, at] of this.recentlySent) {
      if (this.now() - at > 60) {
        this.recentlySent.delete(key);
      }
    }
    if (sentAt !== undefined && this.now() - sentAt <= 60) {
      this.recentlySent.delete(text);
      return true;
    }
    return false;
  }

  private publish(alerts: Alert[]): void {
    for (const alert of alerts) {
      this.emit("alert", alert);
    }
  }
}
