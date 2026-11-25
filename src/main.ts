import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { type Config, loadConfig } from "./config.js";
import { LiveServer } from "./rust/live.js";
import { DemoSessions, PrivateSessions } from "./sessions.js";
import { COMMANDS, createBot } from "./telegram/bot.js";

async function main(): Promise<void> {
  const env = process.argv.includes("--simulator") ? { ...process.env, MODE: "demo" } : process.env;
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  // The bot needs its sessions and the sessions need the bot's API: create the provider lazily.
  let sessions: DemoSessions | PrivateSessions | undefined;
  const bot = createBot(config.TELEGRAM_BOT_TOKEN, {
    get: (chatId) => sessions!.get(chatId),
    start: (chatId) => sessions!.start(chatId),
    get welcome() {
      return sessions!.welcome;
    },
  });
  try {
    await bot.init();
  } catch (e) {
    console.error(`Telegram did not accept the bot token (${(e as Error).message}). Check TELEGRAM_BOT_TOKEN from @BotFather.`);
    process.exit(1);
  }
  await bot.api.setMyCommands(COMMANDS);

  if (config.MODE === "demo") {
    sessions = new DemoSessions(bot.api);
    console.log(`Demo mode: @${bot.botInfo.username} gives every chat its own simulated server.`);
  } else {
    const server = new LiveServer({
      ip: config.RUST_SERVER_IP!,
      port: config.RUST_SERVER_PORT!,
      playerId: config.RUST_PLAYER_ID!,
      playerToken: config.RUST_PLAYER_TOKEN!,
      useFacepunchProxy: config.RUST_USE_PROXY === "true",
    });
    const privateSessions = new PrivateSessions(server, config.devices, config.TELEGRAM_CHAT_ID!, {
      pollSeconds: config.POLL_SECONDS,
      upkeepWarnMinutes: config.UPKEEP_WARN_MINUTES,
      ownSteamId: config.RUST_PLAYER_ID!,
    });
    sessions = privateSessions;
    await privateSessions.run(bot.api);
    console.log(`Watching ${config.RUST_SERVER_IP}:${config.RUST_SERVER_PORT} with ${config.devices.length} paired devices.`);
  }

  if (config.WEBHOOK_URL && config.PORT) {
    // Hosting: Telegram pushes updates to us; /healthz answers the platform's health checks.
    const secret = config.WEBHOOK_SECRET ?? config.TELEGRAM_BOT_TOKEN.replace(/\W/g, "").slice(-32);
    const handle = webhookCallback(bot, "http", { secretToken: secret });
    createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      } else if (req.method === "POST" && req.url === "/telegram") {
        void handle(req, res);
      } else {
        res.writeHead(302, { location: "https://github.com/gigantic536wall/raidbell" }).end();
      }
    }).listen(config.PORT);
    await bot.api.setWebhook(`${config.WEBHOOK_URL.replace(/\/$/, "")}/telegram`, { secret_token: secret });
    console.log(`Webhook mode on port ${config.PORT}.`);
  } else {
    await bot.api.deleteWebhook();
    console.log("Long polling. Press Ctrl+C to stop.");
    await bot.start();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
