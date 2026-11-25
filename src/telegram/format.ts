import { clock, duration, gridOf, isNight, realMinutesUntil } from "../rust/grid.js";
import type { GameTime, MapMarker, ServerInfo, TeamInfo } from "../rust/types.js";
import { MarkerType } from "../rust/types.js";
import type { Alert } from "../watch/alerts.js";

/** Escapes text for Telegram's HTML parse mode. */
export function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export interface Formatted {
  text: string;
  /** Loud alerts (raids, decay) ring; everything else arrives silently. */
  loud: boolean;
}

export function formatAlert(alert: Alert): Formatted {
  switch (alert.kind) {
    case "raid":
      return { text: `🚨 <b>RAID!</b> ${esc(alert.device)} went off`, loud: true };
    case "raid-over":
      return { text: `✅ ${esc(alert.device)} is quiet again`, loud: false };
    case "upkeep-low":
      return {
        text: `⏳ ${esc(alert.device)}: upkeep for ${duration(alert.minutesLeft)} left. Time to top it up.`,
        loud: true,
      };
    case "decaying":
      return { text: `🏚 <b>${esc(alert.device)} has no upkeep left: the base is decaying!</b>`, loud: true };
    case "upkeep-restored":
      return { text: `🧰 ${esc(alert.device)} topped up: ${duration(alert.minutesLeft)} of upkeep`, loud: false };
    case "team":
      return { text: teamText(alert.change, esc(alert.name), alert.grid), loud: false };
    case "chat":
      return { text: `💬 <b>${esc(alert.name)}</b>: ${esc(alert.message)}`, loud: false };
    case "event":
      return { text: eventText(alert.event, alert.grid), loud: false };
  }
}

function where(grid: string): string {
  return grid === "at sea" ? "at sea" : `at ${grid}`;
}

function eventText(event: Extract<Alert, { kind: "event" }>["event"], grid: string): string {
  switch (event) {
    case "cargo-arrived":
      return "🚢 Cargo ship entered the map";
    case "cargo-left":
      return "🚢 Cargo ship left the map";
    case "heli-arrived":
      return `🚁 Patrol helicopter arrived ${where(grid)}`;
    case "heli-down":
      return `💥 <b>Patrol helicopter shot down ${where(grid)}</b>: crates are up for grabs`;
    case "heli-left":
      return "🚁 Patrol helicopter left the map";
    case "chinook-arrived":
      return `🛩 Chinook arrived ${where(grid)}: a locked crate drop is coming`;
    case "vendor-arrived":
      return `🛒 Travelling vendor ${where(grid)}`;
    case "vendor-left":
      return "🛒 Travelling vendor left";
  }
}

function teamText(change: Extract<Alert, { kind: "team" }>["change"], name: string, grid?: string): string {
  switch (change) {
    case "online":
      return `🟢 ${name} is online`;
    case "offline":
      return `⚫ ${name} went offline`;
    case "died":
      return `💀 ${name} died${grid ? ` at ${grid}` : ""}`;
    case "respawned":
      return `🔄 ${name} respawned`;
    case "joined":
      return `👋 ${name} joined the team`;
    case "left":
      return `🚪 ${name} left the team`;
  }
}

function ago(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return `${duration(seconds / 60)} ago`;
}

export function formatStatus(info: ServerInfo, time: GameTime, team: TeamInfo, nowUnix: number): string {
  const online = team.members.filter((m) => m.isOnline).length;
  const night = isNight(time);
  const next = night
    ? `day in ${duration(realMinutesUntil(time, time.sunrise))}`
    : `night in ${duration(realMinutesUntil(time, time.sunset))}`;
  return [
    `<b>${esc(info.name)}</b>`,
    `👥 ${info.players}/${info.maxPlayers} players${info.queuedPlayers > 0 ? `, ${info.queuedPlayers} in queue` : ""}`,
    `${night ? "🌙" : "☀️"} ${clock(time.time)} in game, ${next}`,
    `🗺 ${esc(info.map)}, ${info.mapSize} m, wiped ${ago(nowUnix - info.wipeTime)}`,
    `🫂 Team: ${online}/${team.members.length} online`,
  ].join("\n");
}

export function formatTeam(team: TeamInfo, mapSize: number): string {
  const lines = [...team.members]
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name))
    .map((m) => {
      const icon = !m.isOnline ? "⚫" : m.isAlive ? "🟢" : "💀";
      const state = !m.isOnline ? "offline" : m.isAlive ? gridOf(m.x, m.y, mapSize) : "dead";
      const leader = m.steamId === team.leaderSteamId ? " 👑" : "";
      return `${icon} ${esc(m.name)}${leader}: ${state}`;
    });
  return ["<b>Team</b>", ...lines].join("\n");
}

const EVENT_MARKERS: Partial<Record<number, string>> = {
  [MarkerType.CargoShip]: "🚢 Cargo ship",
  [MarkerType.PatrolHelicopter]: "🚁 Patrol helicopter",
  [MarkerType.Chinook]: "🛩 Chinook",
  [MarkerType.TravellingVendor]: "🛒 Travelling vendor",
};

export function formatEvents(markers: MapMarker[], mapSize: number): string {
  const lines = markers
    .filter((m) => EVENT_MARKERS[m.type])
    .map((m) => `${EVENT_MARKERS[m.type]}: ${gridOf(m.x, m.y, mapSize)}`);
  return lines.length > 0
    ? ["<b>On the map now</b>", ...lines].join("\n")
    : "Quiet on the map: no cargo ship, helicopter, Chinook or travelling vendor.";
}

export function formatUpkeep(status: Array<{ device: string; minutesLeft: number }>): string {
  if (status.length === 0) {
    return "No tool cupboard is paired. Pair a storage monitor on your cupboard to track upkeep.";
  }
  return [
    "<b>Upkeep</b>",
    ...status.map((s) =>
      s.minutesLeft <= 0 ? `🏚 ${esc(s.device)}: decaying!` : `🧰 ${esc(s.device)}: ${duration(s.minutesLeft)}`,
    ),
  ].join("\n");
}
