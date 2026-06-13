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
import { AUTH_TOKEN, SERVER_URL } from "./api.js";

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
  // Same-origin (di-proxy Vite ke server) di dev/browser → `io(opts)`. Di shell Tauri (Phase 6)
  // SERVER_URL absolut → `io(url, opts)` agar socket menjangkau orchestrator lokal :8787
  // (webview di-host dari custom protocol, bukan same-origin). socket.io default path /socket.io.
  // BUG-108/CR-101: kirim token via handshake auth bila server dilindungi (sama dgn REST bearer).
  const opts = {
    autoConnect: true,
    ...(AUTH_TOKEN ? { auth: { token: AUTH_TOKEN } } : {}),
  };
  const socket: WorldSocket = SERVER_URL ? io(SERVER_URL, opts) : io(opts);

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
