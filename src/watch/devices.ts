import type { Device, EntityPayload } from "../rust/types.js";
import type { Alert } from "./alerts.js";

export interface UpkeepOptions {
  /** Warn when the tool cupboard has less upkeep than this. */
  warnMinutes: number;
}

/**
 * Raid alarms and tool-cupboard upkeep. Alarms fire when their value switches on (and report when
 * they go quiet again). Storage monitors on a cupboard report the protection expiry; the bot warns
 * once when it drops below the threshold, again when the base starts decaying, and says when the
 * upkeep was topped up.
 */
export class DeviceWatcher {
  private readonly alarms = new Map<number, boolean>();
  private readonly upkeep = new Map<number, { expiry: number; state: "ok" | "low" | "decaying" }>();
  private readonly byId: Map<number, Device>;

  constructor(
    devices: Device[],
    private readonly options: UpkeepOptions = { warnMinutes: 180 },
  ) {
    this.byId = new Map(devices.map((d) => [d.entityId, d]));
  }

  /** A device's current state (from a query or a change broadcast). */
  update(entityId: number, payload: EntityPayload, nowUnix: number): Alert[] {
    const device = this.byId.get(entityId);
    if (!device) {
      return [];
    }

    if (device.kind === "alarm") {
      const on = payload.value === true;
      const before = this.alarms.get(entityId);
      this.alarms.set(entityId, on);
      if (before === undefined) {
        // First reading: an alarm that is already sounding is still worth telling.
        return on ? [{ kind: "raid", device: device.name }] : [];
      }
      if (on && !before) {
        return [{ kind: "raid", device: device.name }];
      }
      return !on && before ? [{ kind: "raid-over", device: device.name }] : [];
    }

    if (device.kind === "monitor" && payload.hasProtection !== undefined) {
      const expiry = payload.hasProtection ? (payload.protectionExpiry ?? 0) : 0;
      const known = this.upkeep.get(entityId);
      this.upkeep.set(entityId, { expiry, state: known?.state ?? "ok" });
      return this.check(nowUnix).filter((a) => "device" in a && a.device === device.name);
    }

    return [];
  }

  /**
   * Re-evaluates upkeep against the clock. Protection runs out without any broadcast, so the bot
   * calls this every minute.
   */
  check(nowUnix: number): Alert[] {
    const alerts: Alert[] = [];
    for (const [entityId, entry] of this.upkeep) {
      const name = this.byId.get(entityId)!.name;
      const minutesLeft = Math.max(0, (entry.expiry - nowUnix) / 60);
      const state = minutesLeft <= 0 ? "decaying" : minutesLeft < this.options.warnMinutes ? "low" : "ok";
      if (state === entry.state) {
        continue;
      }
      if (state === "decaying") {
        alerts.push({ kind: "decaying", device: name });
      } else if (state === "low" && entry.state === "ok") {
        alerts.push({ kind: "upkeep-low", device: name, minutesLeft });
      } else if (state === "ok") {
        alerts.push({ kind: "upkeep-restored", device: name, minutesLeft });
      }
      entry.state = state;
    }
    return alerts;
  }

  /** Minutes of upkeep left per monitored cupboard (for the /upkeep command). */
  upkeepStatus(nowUnix: number): Array<{ device: string; minutesLeft: number }> {
    return [...this.upkeep].map(([entityId, entry]) => ({
      device: this.byId.get(entityId)!.name,
      minutesLeft: Math.max(0, (entry.expiry - nowUnix) / 60),
    }));
  }
}
