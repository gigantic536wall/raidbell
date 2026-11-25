# RaidBell: Rust+ companion bot for Telegram

[![CI](https://github.com/gigantic536wall/raidbell/actions/workflows/ci.yml/badge.svg)](https://github.com/gigantic536wall/raidbell/actions/workflows/ci.yml)

A Telegram bot for teams playing [Rust](https://rust.facepunch.com/). It connects to your server through the
official Rust+ companion protocol and tells your Telegram group what is happening while you are away:

- 🚨 **Raid alerts** from Smart Alarms, with buttons to switch on turrets and lights right from the alert
- ⏳ **Upkeep warnings** when the tool cupboard runs low, and when the base starts decaying
- 🚢🚁 **Server events:** cargo ship, patrol helicopter (and where it was shot down), Chinook, travelling vendor
- 🟢💀 **Team:** who came online, went offline, died (with the map square) or respawned
- 💬 **Chat bridge:** messages in the Telegram group go to the in-game team chat, and back
- 🔌 **Smart switches** on and off with buttons; `/status`, `/team`, `/events`, `/upkeep` on demand

**▶ Try it:** DEMO_BOT_LINK: the demo gives your chat its own simulated server, where a cargo ship
arrives, the helicopter is shot down, a teammate dies and your base gets raided within a few minutes.

## How it works

```
Rust server ──Rust+ websocket──▶ RustServer ──▶ Monitor ──alerts──▶ Telegram bot ──▶ your group
  (or the simulator)              interface      watchers            (grammY)     ◀── /commands, chat
```

- **One interface, two implementations.** `LiveServer` wraps [rustplus.js](https://github.com/liamcottle/rustplus.js);
  `SimulatedServer` is an in-memory server with a scripted ten-minute story. The bot logic cannot tell them apart,
  so everything is tested without a game server, and the public demo runs on the simulator.
- **Watchers are pure.** They compare snapshots and return alerts: a helicopter that disappears next to a new
  explosion was shot down, one that just disappears left the map. Restarting the bot does not repeat old events.
- **No chat loops.** Messages the bridge sends are echoed back by the game; the monitor recognises and drops them.
- **Telegram limits respected:** alerts are retried with back-off on rate limits; only raids and decay ring,
  everything else arrives silently.
- **Demo mode** gives every chat its own simulated server (created on `/start`, ended after an hour of inactivity).

## Tech stack

TypeScript (strict) · Node.js 24 · grammY · rustplus.js (Rust+ protobuf over websockets) · zod · Vitest · Docker ·
GitHub Actions · Render

## Run it for your own server

### 1. Create the bot

Talk to [@BotFather](https://t.me/BotFather), `/newbot`, and keep the token. Add the bot to your team's group and,
in BotFather, turn off *Group Privacy* (`/setprivacy`) so the bot can read the chat it bridges.

### 2. Pairing

Rust+ hands out credentials when you pair a server or device in the game. The easiest way to see them is the
rustplus.js command-line tool:

```bash
npx @liamcottle/rustplus.js fcm-register   # once: opens a browser to sign in with Steam
npx @liamcottle/rustplus.js fcm-listen     # keep it running while you pair
```

In Rust, open the menu → *Rust+* → **Pair with server**. `fcm-listen` prints the server's `ip`, `port`, your
`playerId` and `playerToken`. Then, for every Smart Alarm, Smart Switch and Storage Monitor (on the tool cupboard),
hold `E` → **Pair**: each prints an `entityId`. Put the devices into `data/devices.json`
(see [examples/devices.json](examples/devices.json)):

```json
[{ "entityId": 12345678, "name": "Main base alarm", "kind": "alarm" }]
```

### 3. Run

```bash
cp .env.example .env        # fill in the token, chat id and pairing values
npm install
npm run build && node --env-file=.env dist/main.js
```

Send `/start` in your group: if the chat is not allowed yet, the bot replies with its chat id for `TELEGRAM_CHAT_ID`.

With Docker: `docker build -t raidbell . && docker run --env-file .env -v "$PWD/data:/app/data" raidbell`.

### Try it locally without a Rust server

```bash
TELEGRAM_BOT_TOKEN=… npm run demo
```

## Development

```bash
npm test          # 42 tests: grid maths, watchers, the simulator story, the bot, configuration
npm run typecheck
npm run dev       # watch mode
```

The bot tests feed real Telegram updates into grammY and intercept the API calls, so they check the exact
messages and buttons the bot sends without contacting Telegram.

## Credits

Rust+ protocol client: [rustplus.js](https://github.com/liamcottle/rustplus.js) by Liam Cottle.
Rust is a trademark of Facepunch Studios; this project is not affiliated with Facepunch.

## License

MIT
