import type { GameTime } from "./types.js";

/** Side length of one map grid square in Rust, in metres. */
export const GRID_SIZE = 146.28;

/** Column letters as the in-game map shows them: A..Z, then AA, AB, ... */
export function columnName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/**
 * The map grid square ("G12") of world position (x, y). Rust+ positions start at the bottom-left
 * corner, while the in-game grid numbers rows from the top.
 */
export function gridOf(x: number, y: number, mapSize: number): string {
  if (x < 0 || y < 0 || x > mapSize || y > mapSize) {
    return "at sea";
  }
  const cells = Math.floor(mapSize / GRID_SIZE);
  const col = Math.min(Math.floor(x / GRID_SIZE), cells - 1);
  const row = Math.min(Math.floor((mapSize - y) / GRID_SIZE), cells - 1);
  return `${columnName(col)}${row}`;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** "14:05" from an in-game hour such as 14.083. */
export function clock(hours: number): string {
  const total = Math.round(hours * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Real minutes until the in-game clock reaches `targetHour` (wrapping past midnight). */
export function realMinutesUntil(time: GameTime, targetHour: number): number {
  const gameHours = (targetHour - time.time + 24) % 24;
  return (gameHours * time.dayLengthMinutes) / 24 / time.timeScale;
}

export function isNight(time: GameTime): boolean {
  return time.time < time.sunrise || time.time >= time.sunset;
}

/** "2 h 05 min", "12 min", "less than a minute". */
export function duration(minutes: number): string {
  if (minutes < 1) {
    return "less than a minute";
  }
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
