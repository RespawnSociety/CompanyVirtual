/**
 * Klien realtime (socket.io) ke orchestrator. Tipe event memakai kontrak `@vc/shared`.
 * Subscribe ke sebuah company → terima `world:sync` (snapshot) & `agent:event` (animasi, Phase 2+).
 */

import { io, type Socket } from "socket.io-client";
import type {
  AgentEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  WorldSnapshot,
} from "@vc/shared";
import { AUTH_TOKEN } from "./api.js";

type WorldSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface WorldSubscription {
  disconnect: () => void;
}

/**
 * Buka koneksi & subscribe ke `companyId`. Callback dipanggil tiap snapshot/event masuk.
 * Mengembalikan handle untuk memutus koneksi (panggil saat company berganti / unmount).
 */
export function subscribeWorld(
  companyId: string,
  handlers: {
    onSync?: (snapshot: WorldSnapshot) => void;
    onAgentEvent?: (event: AgentEvent) => void;
    onConnectChange?: (connected: boolean) => void;
  },
): WorldSubscription {
  // Same-origin (di-proxy Vite ke server). socket.io default path /socket.io.
  // BUG-108/CR-101: kirim token via handshake auth bila server dilindungi (sama dgn REST bearer).
  const socket: WorldSocket = io({
    autoConnect: true,
    ...(AUTH_TOKEN ? { auth: { token: AUTH_TOKEN } } : {}),
  });

  socket.on("connect", () => {
    handlers.onConnectChange?.(true);
    socket.emit("world:subscribe", companyId);
  });
  socket.on("disconnect", () => handlers.onConnectChange?.(false));
  if (handlers.onSync) socket.on("world:sync", handlers.onSync);
  if (handlers.onAgentEvent) socket.on("agent:event", handlers.onAgentEvent);

  return {
    disconnect: () => {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
