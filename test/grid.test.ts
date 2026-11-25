import { describe, expect, it } from "vitest";
import { clock, columnName, duration, gridOf, isNight, realMinutesUntil } from "../src/rust/grid.js";

describe("map grid", () => {
  it("names columns like the in-game map", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });

  it("counts rows from the top of the map", () => {
    // Rust+ y grows upwards; the grid's row 0 is at the top.
    expect(gridOf(10, 3990, 4000)).toBe("A0");
    expect(gridOf(10, 10, 4000)).toBe("A26");
    expect(gridOf(3990, 3990, 4000)).toBe("AA0");
    expect(gridOf(1000, 2000, 4000)).toBe("G13");
  });

  it("clamps the last partial square onto the last full one", () => {
    expect(gridOf(3999.9, 0.1, 4000)).toBe("AA26");
  });

  it("reports positions outside the map as at sea", () => {
    expect(gridOf(-300, 1700, 4000)).toBe("at sea");
    expect(gridOf(4100, 1700, 4000)).toBe("at sea");
  });
});

describe("time helpers", () => {
  const time = { time: 18, sunrise: 7.5, sunset: 19.5, dayLengthMinutes: 48, timeScale: 1 };

  it("formats the in-game clock", () => {
    expect(clock(14.0833)).toBe("14:05");
    expect(clock(23.999)).toBe("00:00");
  });

  it("converts in-game hours to real minutes", () => {
    // 1.5 in-game hours of a 48-minute day = 3 real minutes.
    expect(realMinutesUntil(time, 19.5)).toBeCloseTo(3);
    // Sunrise is 13.5 game hours away, across midnight.
    expect(realMinutesUntil(time, 7.5)).toBeCloseTo(27);
  });

  it("knows day from night", () => {
    expect(isNight(time)).toBe(false);
    expect(isNight({ ...time, time: 22 })).toBe(true);
    expect(isNight({ ...time, time: 5 })).toBe(true);
  });

  it("formats durations", () => {
    expect(duration(0.5)).toBe("less than a minute");
    expect(duration(12.7)).toBe("12 min");
    expect(duration(125)).toBe("2 h 05 min");
  });
});
