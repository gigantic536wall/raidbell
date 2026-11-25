import { describe, expect, it } from "vitest";
import { SIMULATED_DEVICES, SIMULATED_PLAYER, SimulatedServer } from "../src/rust/simulator.js";
import { type BotInfo, createBot, forwardAlerts, type Session, type SessionProvider } from "../src/telegram/bot.js";
import { Monitor } from "../src/watch/monitor.js";

const CHAT = -100123;
const OTHER_CHAT = 555;

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "RaidBell",
  username: "raidbell_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
} as unknown as BotInfo;

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

async function harness() {
  const server = new SimulatedServer(1_800_000_000);
  const monitor = new Monitor(server, {
    devices: SIMULATED_DEVICES,
    pollSeconds: 0,
    ownSteamId: SIMULATED_PLAYER.steamId,
    now: () => server.startUnix + server.elapsed,
  });
  const session: Session = { server, monitor, devices: SIMULATED_DEVICES };
  const sessions: SessionProvider = {
    get: (id) => (id === CHAT ? session : undefined),
    start: async (id) => sessions.get(id),
    welcome: "Welcome to the test server.",
  };
  const bot = createBot("123:test", sessions, BOT_INFO);

  // Answer every Telegram API call locally and record it.
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });
    const result =
      method === "sendMessage"
        ? { message_id: calls.length, date: 0, chat: { id: p.chat_id, type: "group" }, text: p.text }
        : true;
    return { ok: true, result } as never;
  });
  await bot.init();
  await monitor.start();

  let updateId = 1;
  const send = (text: string, chatId = CHAT) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: chatId, type: "group", title: "Clan" },
        from: { id: 7, is_bot: false, first_name: "Max" },
        text,
        ...(text.startsWith("/")
          ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] }
          : {}),
      },
    } as never);
  const tap = (data: string) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: `cb${updateId}`,
        from: { id: 7, is_bot: false, first_name: "Max" },
        chat_instance: "1",
        data,
        message: { message_id: 50, date: 0, chat: { id: CHAT, type: "group", title: "Clan" }, text: "switches" },
      },
    } as never);
  const replies = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

  return { server, monitor, session, bot, calls, send, tap, replies };
}

type Button = { text: string; callback_data: string };
const buttons = (call: Call | undefined) =>
  ((call?.payload.reply_markup as { inline_keyboard: Button[][] } | undefined)?.inline_keyboard ?? []).flat();

describe("Telegram bot", () => {
  it("welcomes allowed chats and tells other chats how to get access", async () => {
    const h = await harness();
    await h.send("/start");
    await h.send("/start", OTHER_CHAT);
    await h.send("hello", OTHER_CHAT);

    const [welcome, privateHint, startFirst] = h.replies();
    expect(welcome).toContain("Welcome to the test server.");
    expect(welcome).toContain("/switches");
    expect(privateHint).toContain(`<code>${OTHER_CHAT}</code>`);
    expect(startFirst).toBe("Send /start first.");
  });

  it("/status shows the server, time of day and team", async () => {
    const h = await harness();
    await h.send("/status");
    const status = h.replies()[0]!;
    expect(status).toContain("<b>RaidBell Simulated | Monthly | 2x</b>");
    expect(status).toMatch(/👥 \d+\/200 players/);
    expect(status).toContain("☀️ 09:30 in game, night in");
    expect(status).toContain("🫂 Team: 3/4 online");
  });

  it("/team lists everyone with state and grid, leader first among the online", async () => {
    const h = await harness();
    await h.send("/team");
    expect(h.replies()[0]).toBe(
      ["<b>Team</b>", "🟢 Ana: M12", "🟢 Chloe: R17", "🟢 You 👑: M12", "⚫ Ben: offline"].join("\n"),
    );
  });

  it("/events shows the cargo ship once it is on the map", async () => {
    const h = await harness();
    await h.send("/events");
    h.server.advance(200);
    await h.send("/events");
    const [quiet, busy] = h.replies();
    expect(quiet).toContain("Quiet on the map");
    expect(busy).toContain("🚢 Cargo ship: ");
  });

  it("switch buttons show the state and toggle the device in game", async () => {
    const h = await harness();
    await h.send("/switches");
    const menu = h.calls.find((c) => c.method === "sendMessage");
    expect(buttons(menu).map((b) => b.text)).toEqual(["🟢 Base lights: ON", "⚪ Auto turrets: OFF"]);
    expect(buttons(menu)[1]!.callback_data).toBe("sw:2002:1");

    await h.tap("sw:2002:1");
    expect((await h.server.getEntity(2002)).value).toBe(true);
    const answer = h.calls.find((c) => c.method === "answerCallbackQuery");
    expect(answer?.payload.text).toBe("Auto turrets: ON");
    const edit = h.calls.find((c) => c.method === "editMessageReplyMarkup");
    expect(buttons(edit).map((b) => b.text)).toContain("🟢 Auto turrets: ON");
  });

  it("refuses to toggle something that is not a paired switch", async () => {
    const h = await harness();
    await h.tap("sw:3001:1");
    expect(h.calls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toBe("This switch is not paired anymore.");
  });

  it("bridges chat: Telegram text goes to the team chat, commands do not", async () => {
    const h = await harness();
    await h.send("on my way, bring meds");
    await h.send("/team");
    expect(h.server.sentMessages).toEqual(["Max: on my way, bring meds"]);
  });

  it("cuts long messages to the in-game limit", async () => {
    const h = await harness();
    await h.send("x".repeat(300));
    expect(h.server.sentMessages[0]).toHaveLength(128);
  });

  it("forwards alerts: raids ring and carry the switch buttons, chat arrives silently and escaped", async () => {
    const h = await harness();
    forwardAlerts(h.bot.api, CHAT, h.session);

    h.server.chat("Ana", "<b>loot</b> & run");
    h.server.setEntity(1001, { value: true });
    await new Promise((r) => setTimeout(r, 0));

    const sent = h.calls.filter((c) => c.method === "sendMessage");
    expect(sent[0]?.payload).toMatchObject({
      chat_id: CHAT,
      text: "💬 <b>Ana</b>: &lt;b&gt;loot&lt;/b&gt; &amp; run",
      disable_notification: true,
    });
    expect(sent[1]?.payload).toMatchObject({ text: "🚨 <b>RAID!</b> Main base alarm went off", disable_notification: false });
    expect(buttons(sent[1]).map((b) => b.text)).toEqual(["🟢 Base lights: ON", "⚪ Auto turrets: OFF"]);
  });
});
