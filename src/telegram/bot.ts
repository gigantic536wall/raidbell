import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Api, type BotConfig, type Context, InlineKeyboard } from "grammy";
/** What getMe returns; passing it lets tests run without contacting Telegram. */
export type BotInfo = NonNullable<BotConfig<Context>["botInfo"]>;
import type { Device, RustServer } from "../rust/types.js";
import type { Alert } from "../watch/alerts.js";
import type { Monitor } from "../watch/monitor.js";
import { esc, formatAlert, formatEvents, formatStatus, formatTeam, formatUpkeep } from "./format.js";

/** One Rust server watched for one Telegram chat. */
export interface Session {
  server: RustServer;
  monitor: Monitor;
  devices: Device[];
}

/**
 * Decides which chats may use the bot. A private setup has one server for its allowed chats; the
 * public demo gives every chat its own simulated server.
 */
export interface SessionProvider {
  /** The chat's session, or undefined if this chat may not use the bot (yet). */
  get(chatId: number): Session | undefined;
  /** Called on /start: the demo creates a session here; a private setup returns get(chatId). */
  start(chatId: number): Promise<Session | undefined>;
  /** Shown on /start, e.g. "Demo mode: a simulated server..." */
  readonly welcome: string;
}

export const COMMANDS = [
  { command: "status", description: "Server, time of day and team at a glance" },
  { command: "team", description: "Who is online, alive and where" },
  { command: "events", description: "Cargo ship, helicopter, Chinook on the map now" },
  { command: "switches", description: "Turn smart switches on and off" },
  { command: "upkeep", description: "Tool cupboard upkeep left" },
  { command: "help", description: "What this bot does" },
];

const HELP = [
  "<b>RaidBell</b> watches your Rust server through Rust+ and tells this chat:",
  "🚨 when a raid alarm goes off, ⏳ when the tool cupboard runs low,",
  "🚢🚁 cargo ship, helicopter and Chinook events, 🟢💀 teammates online, offline and dying.",
  "",
  "💬 Messages you write here go to the in-game team chat, and team chat comes back here.",
  "",
  ...COMMANDS.map((c) => `/${c.command}: ${c.description}`),
].join("\n");

/** Team chat messages are limited in game; longer texts are cut. */
const MAX_TEAM_MESSAGE = 128;

export function createBot(token: string, sessions: SessionProvider, botInfo?: BotInfo): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  // Telegram limits bursts (about 20 messages a minute per group): wait and retry instead of dropping alerts.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  bot.command("start", async (ctx) => {
    const session = await sessions.start(ctx.chat.id);
    if (!session) {
      await ctx.reply(
        `This bot is private. If it is yours, add this chat id to TELEGRAM_CHAT_ID: <code>${ctx.chat.id}</code>`,
        { parse_mode: "HTML" },
      );
      return;
    }
    await ctx.reply(`${sessions.welcome}\n\n${HELP}`, { parse_mode: "HTML" });
  });

  // Everything below needs a session; other chats get a single hint.
  const withSession = bot.filter((ctx): ctx is Context & { chat: NonNullable<Context["chat"]> } => {
    return ctx.chat !== undefined && sessions.get(ctx.chat.id) !== undefined;
  });
  bot.filter((ctx) => ctx.chat !== undefined && sessions.get(ctx.chat.id) === undefined).on("message", (ctx) =>
    ctx.reply("Send /start first."),
  );

  const session = (ctx: Context): Session => sessions.get(ctx.chat!.id)!;

  withSession.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  withSession.command("status", async (ctx) => {
    const { server } = session(ctx);
    const [info, time, team] = await Promise.all([server.getInfo(), server.getTime(), server.getTeam()]);
    await ctx.reply(formatStatus(info, time, team, Math.floor(Date.now() / 1000)), { parse_mode: "HTML" });
  });

  withSession.command("team", async (ctx) => {
    const { server, monitor } = session(ctx);
    await ctx.reply(formatTeam(await server.getTeam(), monitor.mapSize), { parse_mode: "HTML" });
  });

  withSession.command("events", async (ctx) => {
    const { server, monitor } = session(ctx);
    await ctx.reply(formatEvents(await server.getMarkers(), monitor.mapSize), { parse_mode: "HTML" });
  });

  withSession.command("upkeep", async (ctx) => {
    const { monitor } = session(ctx);
    await ctx.reply(formatUpkeep(monitor.devices.upkeepStatus(Math.floor(Date.now() / 1000))), { parse_mode: "HTML" });
  });

  withSession.command("switches", async (ctx) => {
    const keyboard = await switchKeyboard(session(ctx));
    await ctx.reply(keyboard ? "<b>Smart switches</b>: tap to toggle" : "No smart switches are paired.", {
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  withSession.callbackQuery(/^sw:(\d+):([01])$/, async (ctx) => {
    const s = session(ctx);
    const entityId = Number(ctx.match[1]);
    const on = ctx.match[2] === "1";
    const device = s.devices.find((d) => d.entityId === entityId && d.kind === "switch");
    if (!device) {
      await ctx.answerCallbackQuery({ text: "This switch is not paired anymore." });
      return;
    }
    try {
      await s.server.setSwitch(entityId, on);
    } catch {
      await ctx.answerCallbackQuery({ text: `${device.name} did not respond. Is the server up?`, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: `${device.name}: ${on ? "ON" : "OFF"}` });
    const keyboard = await switchKeyboard(s);
    if (keyboard) {
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    }
  });

  // Chat bridge: plain text in this chat goes to the in-game team chat.
  withSession.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      return;
    }
    const name = ctx.from?.first_name ?? "Telegram";
    const text = `${name}: ${ctx.message.text}`.slice(0, MAX_TEAM_MESSAGE);
    try {
      await session(ctx).monitor.sendTeamMessage(text);
    } catch {
      await ctx.reply("⚠️ Could not reach the server; the message was not sent to the team chat.");
    }
  });

  bot.catch((err) => console.error("Bot error:", err.error));
  return bot;
}

/** Buttons with each switch's current state; tapping flips it. */
export async function switchKeyboard(session: Session): Promise<InlineKeyboard | undefined> {
  const switches = session.devices.filter((d) => d.kind === "switch");
  if (switches.length === 0) {
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  for (const sw of switches) {
    let on: boolean | undefined;
    try {
      on = (await session.server.getEntity(sw.entityId)).value;
    } catch {
      on = undefined;
    }
    const label = on === undefined ? `❔ ${sw.name}` : `${on ? "🟢" : "⚪"} ${sw.name}: ${on ? "ON" : "OFF"}`;
    keyboard.text(label, `sw:${sw.entityId}:${on ? 0 : 1}`).row();
  }
  return keyboard;
}

/** Sends a session's alerts to its chat. Raid alerts carry the switch buttons (turrets, lights). */
export function forwardAlerts(api: Api, chatId: number, session: Session): (alert: Alert) => Promise<void> {
  const send = async (alert: Alert) => {
    const { text, loud } = formatAlert(alert);
    const keyboard = alert.kind === "raid" ? await switchKeyboard(session) : undefined;
    try {
      await api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_notification: !loud,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    } catch (e) {
      console.error(`Could not send an alert to chat ${chatId}: ${(e as Error).message}`);
    }
  };
  session.monitor.on("alert", (alert) => void send(alert));
  return send;
}

export { esc };
