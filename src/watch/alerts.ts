/** Something worth telling the team about. Watchers produce these; the Telegram layer formats them. */
export type Alert =
  | { kind: "raid"; device: string }
  | { kind: "raid-over"; device: string }
  | { kind: "upkeep-low"; device: string; minutesLeft: number }
  | { kind: "decaying"; device: string }
  | { kind: "upkeep-restored"; device: string; minutesLeft: number }
  | { kind: "event"; event: WorldEvent; grid: string }
  | { kind: "team"; change: TeamChange; name: string; grid?: string }
  | { kind: "chat"; name: string; message: string };

export type WorldEvent =
  | "cargo-arrived"
  | "cargo-left"
  | "heli-arrived"
  | "heli-down"
  | "heli-left"
  | "chinook-arrived"
  | "vendor-arrived"
  | "vendor-left";

export type TeamChange = "online" | "offline" | "died" | "respawned" | "joined" | "left";
