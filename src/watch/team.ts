import { gridOf } from "../rust/grid.js";
import type { TeamInfo, TeamMember } from "../rust/types.js";
import type { Alert } from "./alerts.js";

/**
 * Compares team snapshots: who came online, went offline, died (and where), respawned, joined or
 * left the team. The bot's own player can be ignored, so you are not notified about yourself.
 */
export class TeamWatcher {
  private known: Map<string, TeamMember> | undefined;

  constructor(private readonly ignoreSteamId?: string) {}

  update(team: TeamInfo, mapSize: number): Alert[] {
    const current = new Map(team.members.map((m) => [m.steamId, m]));
    if (!this.known) {
      this.known = current;
      return [];
    }

    const alerts: Alert[] = [];
    for (const [id, now] of current) {
      if (id === this.ignoreSteamId) {
        continue;
      }
      const before = this.known.get(id);
      if (!before) {
        alerts.push({ kind: "team", change: "joined", name: now.name });
        continue;
      }
      if (!before.isOnline && now.isOnline) {
        alerts.push({ kind: "team", change: "online", name: now.name });
      } else if (before.isOnline && !now.isOnline) {
        alerts.push({ kind: "team", change: "offline", name: now.name });
      }
      if (before.isAlive && !now.isAlive) {
        // Rust+ keeps the position of the body, which is where the team wants to go.
        alerts.push({ kind: "team", change: "died", name: now.name, grid: gridOf(now.x, now.y, mapSize) });
      } else if (!before.isAlive && now.isAlive) {
        alerts.push({ kind: "team", change: "respawned", name: now.name });
      }
    }

    for (const [id, before] of this.known) {
      if (!current.has(id) && id !== this.ignoreSteamId) {
        alerts.push({ kind: "team", change: "left", name: before.name });
      }
    }

    this.known = current;
    return alerts;
  }
}
