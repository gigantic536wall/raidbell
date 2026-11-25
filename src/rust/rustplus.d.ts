// Minimal typings for the parts of @liamcottle/rustplus.js this project uses (the package ships none).
declare module "@liamcottle/rustplus.js" {
  import { EventEmitter } from "node:events";

  /** protobufjs 64-bit integers (Steam ids) arrive as Long objects. */
  interface Long {
    toString(): string;
  }

  export interface AppMessage {
    response?: AppResponse;
    broadcast?: {
      teamMessage?: { message: { steamId: Long; name: string; message: string; time: number } };
      entityChanged?: { entityId: number; payload: AppEntityPayload };
    };
  }

  export interface AppEntityPayload {
    value?: boolean | null;
    items?: Array<{ itemId: number; quantity: number }>;
    capacity?: number | null;
    hasProtection?: boolean | null;
    protectionExpiry?: number | null;
  }

  export interface AppResponse {
    error?: { error: string };
    info?: {
      name: string;
      map: string;
      mapSize: number;
      wipeTime: number;
      players: number;
      maxPlayers: number;
      queuedPlayers: number;
    };
    time?: { time: number; sunrise: number; sunset: number; dayLengthMinutes: number; timeScale: number };
    teamInfo?: {
      leaderSteamId: Long;
      members: Array<{ steamId: Long; name: string; x: number; y: number; isOnline: boolean; isAlive: boolean }>;
    };
    mapMarkers?: { markers: Array<{ id: number; type: number; x: number; y: number; name?: string | null }> };
    entityInfo?: { type: number; payload: AppEntityPayload };
    success?: object;
  }

  export default class RustPlus extends EventEmitter {
    constructor(server: string, port: number, playerId: string, playerToken: number, useFacepunchProxy?: boolean);
    connect(): void;
    disconnect(): void;
    isConnected(): boolean;
    sendRequestAsync(data: Record<string, unknown>, timeoutMilliseconds?: number): Promise<AppResponse>;
  }
}
