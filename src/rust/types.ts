import type { EventEmitter } from "node:events";

/** Map marker types as sent by Rust+ (AppMarkerType). 9 is newer than the published proto file. */
export const MarkerType = {
  Player: 1,
  Explosion: 2,
  VendingMachine: 3,
  Chinook: 4,
  CargoShip: 5,
  Crate: 6,
  GenericRadius: 7,
  PatrolHelicopter: 8,
  TravellingVendor: 9,
} as const;
export type MarkerType = (typeof MarkerType)[keyof typeof MarkerType];

export interface ServerInfo {
  name: string;
  map: string;
  mapSize: number;
  /** Unix seconds of the last wipe. */
  wipeTime: number;
  players: number;
  maxPlayers: number;
  queuedPlayers: number;
}

export interface GameTime {
  /** Hour of the in-game day, 0..24 (fractional). */
  time: number;
  sunrise: number;
  sunset: number;
  /** Real minutes for a full in-game day. */
  dayLengthMinutes: number;
  timeScale: number;
}

export interface TeamMember {
  steamId: string;
  name: string;
  x: number;
  y: number;
  isOnline: boolean;
  isAlive: boolean;
}

export interface TeamInfo {
  leaderSteamId: string;
  members: TeamMember[];
}

export interface MapMarker {
  id: number;
  type: number;
  x: number;
  y: number;
  name?: string;
}

/** State of a paired device: smart switch/alarm (value) or storage monitor (items, protection). */
export interface EntityPayload {
  value?: boolean;
  capacity?: number;
  itemCount?: number;
  hasProtection?: boolean;
  /** Unix seconds when the tool cupboard runs out of upkeep (0 = no protection). */
  protectionExpiry?: number;
}

export interface TeamMessage {
  steamId: string;
  name: string;
  message: string;
  /** Unix seconds. */
  time: number;
}

export interface RustServerEvents {
  connected: [];
  disconnected: [];
  teamMessage: [TeamMessage];
  /** A paired entity changed (only sent for entities that were queried once with getEntity). */
  entityChanged: [entityId: number, payload: EntityPayload];
}

/**
 * Everything the bot needs from a Rust server. Implemented by the live Rust+ client and by the
 * simulator, so the bot logic is tested without a game server.
 */
export interface RustServer extends EventEmitter<RustServerEvents> {
  connect(): Promise<void>;
  disconnect(): void;
  getInfo(): Promise<ServerInfo>;
  getTime(): Promise<GameTime>;
  getTeam(): Promise<TeamInfo>;
  getMarkers(): Promise<MapMarker[]>;
  getEntity(entityId: number): Promise<EntityPayload>;
  setSwitch(entityId: number, on: boolean): Promise<void>;
  sendTeamMessage(message: string): Promise<void>;
}

export type DeviceKind = "switch" | "alarm" | "monitor";

/** A paired in-game device the bot knows by name. */
export interface Device {
  entityId: number;
  name: string;
  kind: DeviceKind;
}
