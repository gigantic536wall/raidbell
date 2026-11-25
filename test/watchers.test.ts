import { describe, expect, it } from "vitest";
import type { MapMarker, TeamInfo, TeamMember } from "../src/rust/types.js";
import { MarkerType } from "../src/rust/types.js";
import { DeviceWatcher } from "../src/watch/devices.js";
import { MarkerWatcher } from "../src/watch/markers.js";
import { TeamWatcher } from "../src/watch/team.js";

const MAP = 4000;
const marker = (id: number, type: number, x: number, y: number): MapMarker => ({ id, type, x, y });

describe("MarkerWatcher", () => {
  it("does not announce what is already on the map when the bot starts", () => {
    const watcher = new MarkerWatcher();
    expect(watcher.update([marker(1, MarkerType.CargoShip, 1000, 1000)], MAP)).toEqual([]);
  });

  it("announces the cargo ship arriving and leaving, with its grid square", () => {
    const watcher = new MarkerWatcher();
    watcher.update([], MAP);
    expect(watcher.update([marker(1, MarkerType.CargoShip, 1000, 2000)], MAP)).toEqual([
      { kind: "event", event: "cargo-arrived", grid: "G13" },
    ]);
    expect(watcher.update([marker(1, MarkerType.CargoShip, 1500, 2000)], MAP)).toEqual([]);
    expect(watcher.update([], MAP)).toEqual([{ kind: "event", event: "cargo-left", grid: "K13" }]);
  });

  it("tells a shot-down helicopter from one that flew away", () => {
    const watcher = new MarkerWatcher();
    watcher.update([marker(1, MarkerType.PatrolHelicopter, 2000, 2000)], MAP);
    expect(watcher.update([marker(9, MarkerType.Explosion, 2050, 1980)], MAP)).toEqual([
      { kind: "event", event: "heli-down", grid: "O13" },
    ]);

    watcher.update([marker(2, MarkerType.PatrolHelicopter, 500, 500), marker(9, MarkerType.Explosion, 2050, 1980)], MAP);
    // The old explosion is still on the map, but it is not new and too far away: the heli just left.
    expect(watcher.update([marker(9, MarkerType.Explosion, 2050, 1980)], MAP)).toEqual([
      { kind: "event", event: "heli-left", grid: "D23" },
    ]);
  });

  it("ignores vending machines and players, reports Chinook and the travelling vendor", () => {
    const watcher = new MarkerWatcher();
    watcher.update([marker(1, MarkerType.VendingMachine, 10, 10)], MAP);
    expect(
      watcher.update(
        [
          marker(1, MarkerType.VendingMachine, 10, 10),
          marker(2, MarkerType.Player, 100, 100),
          marker(3, MarkerType.Chinook, 600, 3400),
          marker(4, MarkerType.TravellingVendor, 2000, 2000),
        ],
        MAP,
      ),
    ).toEqual([
      { kind: "event", event: "chinook-arrived", grid: "E4" },
      { kind: "event", event: "vendor-arrived", grid: "N13" },
    ]);
  });
});

describe("TeamWatcher", () => {
  const member = (name: string, change: Partial<TeamMember> = {}): TeamMember => ({
    steamId: name,
    name,
    x: 1000,
    y: 2000,
    isOnline: true,
    isAlive: true,
    ...change,
  });
  const team = (...members: TeamMember[]): TeamInfo => ({ leaderSteamId: "Ana", members });

  it("reports logins, logouts, deaths with the grid, respawns, joins and leaves", () => {
    const watcher = new TeamWatcher();
    watcher.update(team(member("Ana"), member("Ben", { isOnline: false }), member("Cy")), MAP);

    expect(watcher.update(team(member("Ana", { isAlive: false }), member("Ben"), member("Dee")), MAP)).toEqual([
      { kind: "team", change: "died", name: "Ana", grid: "G13" },
      { kind: "team", change: "online", name: "Ben" },
      { kind: "team", change: "joined", name: "Dee" },
      { kind: "team", change: "left", name: "Cy" },
    ]);
    expect(watcher.update(team(member("Ana"), member("Ben", { isOnline: false }), member("Dee")), MAP)).toEqual([
      { kind: "team", change: "respawned", name: "Ana" },
      { kind: "team", change: "offline", name: "Ben" },
    ]);
  });

  it("does not report your own player", () => {
    const watcher = new TeamWatcher("Ana");
    watcher.update(team(member("Ana")), MAP);
    expect(watcher.update(team(member("Ana", { isOnline: false })), MAP)).toEqual([]);
  });
});

describe("DeviceWatcher", () => {
  const devices = [
    { entityId: 1, name: "Base alarm", kind: "alarm" as const },
    { entityId: 2, name: "Lights", kind: "switch" as const },
    { entityId: 3, name: "Main TC", kind: "monitor" as const },
  ];
  const NOW = 1_800_000_000;

  it("raises a raid alert when the alarm goes off, and says when it stops", () => {
    const watcher = new DeviceWatcher(devices);
    expect(watcher.update(1, { value: false }, NOW)).toEqual([]);
    expect(watcher.update(1, { value: true }, NOW)).toEqual([{ kind: "raid", device: "Base alarm" }]);
    expect(watcher.update(1, { value: true }, NOW)).toEqual([]);
    expect(watcher.update(1, { value: false }, NOW)).toEqual([{ kind: "raid-over", device: "Base alarm" }]);
  });

  it("an alarm that is already sounding when the bot starts is still reported", () => {
    expect(new DeviceWatcher(devices).update(1, { value: true }, NOW)).toEqual([{ kind: "raid", device: "Base alarm" }]);
  });

  it("ignores switches and unknown entities", () => {
    const watcher = new DeviceWatcher(devices);
    expect(watcher.update(2, { value: true }, NOW)).toEqual([]);
    expect(watcher.update(99, { value: true }, NOW)).toEqual([]);
  });

  it("warns once when upkeep runs low, again when the base decays, and when it is topped up", () => {
    const watcher = new DeviceWatcher(devices, { warnMinutes: 180 });
    expect(watcher.update(3, { hasProtection: true, protectionExpiry: NOW + 200 * 60 }, NOW)).toEqual([]);

    expect(watcher.check(NOW + 30 * 60)).toEqual([{ kind: "upkeep-low", device: "Main TC", minutesLeft: 170 }]);
    expect(watcher.check(NOW + 60 * 60)).toEqual([]); // still low: no repeat
    expect(watcher.check(NOW + 200 * 60)).toEqual([{ kind: "decaying", device: "Main TC" }]);

    expect(watcher.update(3, { hasProtection: true, protectionExpiry: NOW + 1000 * 60 }, NOW + 200 * 60)).toEqual([
      { kind: "upkeep-restored", device: "Main TC", minutesLeft: 800 },
    ]);
    expect(watcher.upkeepStatus(NOW + 200 * 60)).toEqual([{ device: "Main TC", minutesLeft: 800 }]);
  });

  it("treats a cupboard without protection as decaying", () => {
    const watcher = new DeviceWatcher(devices);
    expect(watcher.update(3, { hasProtection: false }, NOW)).toEqual([{ kind: "decaying", device: "Main TC" }]);
  });
});
