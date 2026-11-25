import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { loadConfig } from "../src/config.js";
import { toEntityPayload } from "../src/rust/live.js";
import { DemoSessions } from "../src/sessions.js";

const TOKEN = "123456:ABC-def_ghi";

describe("configuration", () => {
  const live = {
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: "-100123, 456",
    RUST_SERVER_IP: "1.2.3.4",
    RUST_SERVER_PORT: "28082",
    RUST_PLAYER_ID: "76561198000000001",
    RUST_PLAYER_TOKEN: "-123456789",
  };

  it("reads a live setup with devices from a file", () => {
    const config = loadConfig(live, () => '[{"entityId": 12345, "name": "Base alarm", "kind": "alarm"}]');
    expect(config.MODE).toBe("live");
    expect(config.TELEGRAM_CHAT_ID).toEqual([-100123, 456]);
    expect(config.RUST_PLAYER_TOKEN).toBe(-123456789);
    expect(config.POLL_SECONDS).toBe(10);
    expect(config.devices).toEqual([{ entityId: 12345, name: "Base alarm", kind: "alarm" }]);
  });

  it("works without a devices file (no paired devices yet)", () => {
    const config = loadConfig(live, () => {
      throw new Error("ENOENT");
    });
    expect(config.devices).toEqual([]);
  });

  it("lists every missing setting in one readable message", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "nope" })).toThrow(
      /TELEGRAM_BOT_TOKEN: looks like 123456:ABC-[\s\S]*TELEGRAM_CHAT_ID: required in live mode[\s\S]*RUST_PLAYER_TOKEN: required in live mode/,
    );
  });

  it("rejects broken device lists", () => {
    expect(() => loadConfig({ ...live, DEVICES: '[{"entityId": -1, "name": "", "kind": "toaster"}]' })).toThrow(/Devices are not valid/);
  });

  it("needs nothing but a token in demo mode", () => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, MODE: "demo" }).devices).toEqual([]);
  });

  it("requires a port for webhooks", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, MODE: "demo", WEBHOOK_URL: "https://bot.example.com" })).toThrow(
      /PORT: required with WEBHOOK_URL/,
    );
  });
});

describe("Rust+ payload mapping", () => {
  it("maps switches, alarms and storage monitors, ignoring protobuf nulls", () => {
    expect(toEntityPayload({ value: true, capacity: 0, hasProtection: null })).toEqual({ value: true });
    expect(
      toEntityPayload({ value: null, capacity: 24, items: [{ itemId: 1, quantity: 5 }], hasProtection: true, protectionExpiry: 1800000000 }),
    ).toEqual({ capacity: 24, itemCount: 1, hasProtection: true, protectionExpiry: 1800000000 });
    expect(toEntityPayload({ hasProtection: false, protectionExpiry: null })).toEqual({ hasProtection: false, protectionExpiry: 0 });
  });
});

describe("demo sessions", () => {
  afterEach(() => vi.useRealTimers());

  it("gives every chat its own simulated server and ends idle ones", async () => {
    vi.useFakeTimers();
    const sent: Array<{ chat: number; text: string }> = [];
    const api = {
      sendMessage: async (chat: number, text: string) => {
        sent.push({ chat, text });
        return {};
      },
    } as unknown as Api;
    const demo = new DemoSessions(api, { maxSessions: 2, idleMinutes: 30 });

    const a = await demo.start(1);
    const b = await demo.start(2);
    expect(a).toBeDefined();
    expect(a!.server).not.toBe(b!.server);
    expect(await demo.start(1)).toBe(a); // same chat, same server

    // The story runs on its own: Ana's first chat message comes after 20 seconds.
    await vi.advanceTimersByTimeAsync(21_000);
    expect(sent.filter((s) => s.chat === 1).map((s) => s.text)).toContain("💬 <b>Ana</b>: morning! farming sulfur at the quarry");

    demo.get(1); // chat 1 was just used
    await demo.start(3); // over the limit: the least recently used session (chat 2) makes room
    expect(demo.get(2)).toBeUndefined();
    expect(demo.size).toBe(2);

    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(demo.size).toBe(0);
    demo.stop();
  });
});

describe("hosting", () => {
  it("uses Render's public address as the webhook URL", () => {
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, MODE: "demo", PORT: "8080", RENDER_EXTERNAL_URL: "https://raidbell-demo.onrender.com" });
    expect(config.WEBHOOK_URL).toBe("https://raidbell-demo.onrender.com");
  });
});
