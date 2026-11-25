import { describe, expect, it } from "vitest";
import { SIMULATED_DEVICES, SIMULATED_PLAYER, SimulatedServer } from "../src/rust/simulator.js";
import type { Alert } from "../src/watch/alerts.js";
import { Monitor } from "../src/watch/monitor.js";

/** Runs the simulator's ten-minute story through the monitor and collects every alert. */
async function runStory(seconds: number) {
  const server = new SimulatedServer(1_800_000_000);
  const monitor = new Monitor(server, {
    devices: SIMULATED_DEVICES,
    pollSeconds: 0,
    ownSteamId: SIMULATED_PLAYER.steamId,
    now: () => server.startUnix + server.elapsed,
  });
  const alerts: Array<Alert & { at: number }> = [];
  monitor.on("alert", (a) => alerts.push({ ...a, at: server.elapsed }));
  await monitor.start();
  for (let i = 0; i < seconds; i += 5) {
    server.advance(5);
    await monitor.poll();
  }
  return { server, monitor, alerts };
}

describe("Monitor with the simulated server", () => {
  it("turns the ten-minute story into the expected alerts, in order", async () => {
    const { alerts } = await runStory(600);
    const summary = alerts.map((a) => {
      switch (a.kind) {
        case "event":
          return `${a.event}`;
        case "team":
          return `${a.name} ${a.change}`;
        case "chat":
          return `chat ${a.name}`;
        default:
          return a.kind;
      }
    });

    expect(summary).toEqual([
      "chat Ana",
      "cargo-arrived",
      "chat Chloe",
      "Ben online",
      "heli-arrived",
      "Chloe died",
      "chat Chloe",
      "Chloe respawned",
      "heli-down",
      "raid",
      "chat Ana",
      "raid-over",
      "chinook-arrived",
      "Ben offline",
      "cargo-left",
      "upkeep-low",
    ]);
  });

  it("gives grid squares for events and deaths", async () => {
    const { alerts } = await runStory(200);
    expect(alerts.find((a) => a.kind === "team" && a.change === "died")).toMatchObject({ grid: "R17" });
    expect(alerts.find((a) => a.kind === "event" && a.event === "heli-down")).toMatchObject({ grid: "P9" });
  });

  it("sends team messages without echoing them back as chat alerts", async () => {
    const { server, monitor, alerts } = await runStory(10);
    await monitor.sendTeamMessage("[TG] Max: on my way");
    expect(server.sentMessages).toEqual(["[TG] Max: on my way"]);
    expect(alerts.filter((a) => a.kind === "chat")).toEqual([]);

    // The same words typed in-game later are a real message again.
    server.chat("Ana", "[TG] Max: on my way");
    expect(alerts.filter((a) => a.kind === "chat")).toHaveLength(1);
  });

  it("switches report their state and can be toggled", async () => {
    const { server } = await runStory(5);
    await server.setSwitch(2002, true);
    expect((await server.getEntity(2002)).value).toBe(true);
    await expect(server.setSwitch(3001, true)).rejects.toThrow("not a switch");
  });

  it("reports devices that do not answer instead of crashing", async () => {
    const server = new SimulatedServer(1_800_000_000);
    const monitor = new Monitor(server, { devices: [{ entityId: 42, name: "Old alarm", kind: "alarm" }], pollSeconds: 0 });
    const errors: string[] = [];
    monitor.on("error", (e) => errors.push(e.message));
    await monitor.start();
    expect(errors).toEqual(['Device "Old alarm" (42) did not answer: Entity 42 is not paired']);
  });
});
