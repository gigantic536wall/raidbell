import type { Api } from "grammy";
import { SIMULATED_DEVICES, SIMULATED_PLAYER, SimulatedServer } from "./rust/simulator.js";
import type { Device, RustServer } from "./rust/types.js";
import { forwardAlerts, type Session, type SessionProvider } from "./telegram/bot.js";
import { Monitor } from "./watch/monitor.js";

/** One real server, shared by the configured chats (a clan group, your private chat). */
export class PrivateSessions implements SessionProvider {
  readonly welcome = "🟢 RaidBell is watching your server.";
  private readonly session: Session;

  constructor(
    server: RustServer,
    devices: Device[],
    private readonly chatIds: number[],
    options: { pollSeconds: number; upkeepWarnMinutes: number; ownSteamId: string },
  ) {
    const monitor = new Monitor(server, { devices, ...options });
    monitor.on("error", (e) => console.error(e.message));
    this.session = { server, monitor, devices };
  }

  /** Connects to the server and starts sending alerts to every allowed chat. */
  async run(api: Api): Promise<void> {
    for (const chatId of this.chatIds) {
      forwardAlerts(api, chatId, this.session);
    }
    await this.session.monitor.start();
  }

  get(chatId: number): Session | undefined {
    return this.chatIds.includes(chatId) ? this.session : undefined;
  }

  async start(chatId: number): Promise<Session | undefined> {
    return this.get(chatId);
  }
}

/**
 * The public demo: every chat that sends /start gets its own simulated server running the
 * ten-minute story, so anyone can try the bot without owning a Rust server. Idle sessions end.
 */
export class DemoSessions implements SessionProvider {
  readonly welcome = [
    "🎮 <b>Demo mode.</b> You got your own simulated Rust server: a team of four and a base with a raid alarm,",
    "two smart switches and a tool cupboard. Over the next minutes a cargo ship comes, the patrol helicopter",
    "gets shot down, a teammate dies, and your base gets raided. Alerts arrive here by themselves.",
  ].join(" ");

  private readonly sessions = new Map<number, { session: Session; server: SimulatedServer; lastUsed: number }>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly api: Api,
    private readonly options: { maxSessions: number; idleMinutes: number } = { maxSessions: 200, idleMinutes: 60 },
  ) {
    // One clock for all simulated servers.
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get(chatId: number): Session | undefined {
    const entry = this.sessions.get(chatId);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    return entry?.session;
  }

  async start(chatId: number): Promise<Session | undefined> {
    const existing = this.get(chatId);
    if (existing) {
      return existing;
    }
    if (this.sessions.size >= this.options.maxSessions) {
      this.evictOldest();
    }
    const server = new SimulatedServer();
    const monitor = new Monitor(server, {
      devices: SIMULATED_DEVICES,
      pollSeconds: 5,
      ownSteamId: SIMULATED_PLAYER.steamId,
      now: () => server.startUnix + server.elapsed,
    });
    const session: Session = { server, monitor, devices: SIMULATED_DEVICES };
    forwardAlerts(this.api, chatId, session);
    await monitor.start();
    this.sessions.set(chatId, { session, server, lastUsed: Date.now() });
    return session;
  }

  get size(): number {
    return this.sessions.size;
  }

  stop(): void {
    clearInterval(this.timer);
    for (const chatId of [...this.sessions.keys()]) {
      this.end(chatId);
    }
  }

  private tick(): void {
    const idleBefore = Date.now() - this.options.idleMinutes * 60_000;
    for (const [chatId, entry] of this.sessions) {
      if (entry.lastUsed < idleBefore) {
        this.end(chatId);
      } else {
        entry.server.advance(1);
      }
    }
  }

  private evictOldest(): void {
    const oldest = [...this.sessions].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest) {
      this.end(oldest[0]);
    }
  }

  private end(chatId: number): void {
    this.sessions.get(chatId)?.session.monitor.stop();
    this.sessions.delete(chatId);
  }
}
