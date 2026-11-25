import { distance, gridOf } from "../rust/grid.js";
import { type MapMarker, MarkerType } from "../rust/types.js";
import type { Alert, WorldEvent } from "./alerts.js";

/** How close an explosion must be to where the helicopter was last seen to count as "shot down". */
const HELI_DOWN_RADIUS = 400;

const TRACKED: Partial<Record<number, { arrived: WorldEvent; left?: WorldEvent }>> = {
  [MarkerType.CargoShip]: { arrived: "cargo-arrived", left: "cargo-left" },
  [MarkerType.PatrolHelicopter]: { arrived: "heli-arrived", left: "heli-left" },
  [MarkerType.Chinook]: { arrived: "chinook-arrived" },
  [MarkerType.TravellingVendor]: { arrived: "vendor-arrived", left: "vendor-left" },
};

/**
 * Turns successive map-marker snapshots into world events: the cargo ship, patrol helicopter,
 * Chinook and travelling vendor appearing and leaving. A helicopter that disappears next to a new
 * explosion was shot down. The first snapshot only records what is already there, so restarting
 * the bot does not announce old events again.
 */
export class MarkerWatcher {
  private known: Map<number, MapMarker> | undefined;
  private explosions = new Set<number>();

  update(markers: MapMarker[], mapSize: number): Alert[] {
    const current = new Map(markers.filter((m) => TRACKED[m.type]).map((m) => [m.id, m]));
    const newExplosions = markers.filter((m) => m.type === MarkerType.Explosion && !this.explosions.has(m.id));
    this.explosions = new Set(markers.filter((m) => m.type === MarkerType.Explosion).map((m) => m.id));

    if (!this.known) {
      this.known = current;
      return [];
    }

    const alerts: Alert[] = [];
    for (const [id, marker] of current) {
      if (!this.known.has(id)) {
        alerts.push({ kind: "event", event: TRACKED[marker.type]!.arrived, grid: gridOf(marker.x, marker.y, mapSize) });
      }
    }

    for (const [id, marker] of this.known) {
      if (current.has(id)) {
        continue;
      }
      const left = TRACKED[marker.type]!.left;
      if (marker.type === MarkerType.PatrolHelicopter) {
        const wreck = newExplosions.find((e) => distance(e, marker) <= HELI_DOWN_RADIUS);
        alerts.push(
          wreck
            ? { kind: "event", event: "heli-down", grid: gridOf(wreck.x, wreck.y, mapSize) }
            : { kind: "event", event: "heli-left", grid: gridOf(marker.x, marker.y, mapSize) },
        );
      } else if (left) {
        alerts.push({ kind: "event", event: left, grid: gridOf(marker.x, marker.y, mapSize) });
      }
    }

    this.known = current;
    return alerts;
  }
}
