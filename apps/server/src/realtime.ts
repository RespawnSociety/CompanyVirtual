/**
 * RealtimeHub — event bus FACE ↔ ORCH via socket.io (plan §2: BUS → WORLD).
 *
 * Client `world:subscribe` ke sebuah company → masuk room company → terima `world:sync`.
 * Tiap config berubah (REST mutation), server `broadcastWorld` ke room itu. `agent:event`
 * (animasi) dipakai mulai Phase 2; jalurnya disiapkan di sini.
 */

import type { Server as HttpServer } from "node:http";
import { Server as IoServer } from "socket.io";
import type {
  AgentEvent,
  ClientToServerEvents,
  Id,
  ServerToClientEvents,
} from "@vc/shared";
import type { ConfigStore } from "./db/store.js";

function room(companyId: Id): string {
  return `company:${companyId}`;
}

export class RealtimeHub {
  private readonly io: IoServer<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    httpServer: HttpServer,
    private readonly store: ConfigStore,
    corsOrigin: string | boolean = true,
  ) {
    this.io = new IoServer(httpServer, { cors: { origin: corsOrigin } });
    this.io.on("connection", (socket) => {
      socket.on("world:subscribe", (companyId: Id) => {
        void socket.join(room(companyId));
        const snap = this.store.getWorldSnapshot(companyId);
        if (snap) socket.emit("world:sync", snap);
      });
    });
  }

  /** Kirim ulang snapshot company ke semua subscriber-nya (dipanggil setelah mutasi config). */
  broadcastWorld(companyId: Id): void {
    const snap = this.store.getWorldSnapshot(companyId);
    if (snap) this.io.to(room(companyId)).emit("world:sync", snap);
  }

  /** Teruskan event agent (animasi) ke subscriber company (Phase 2+). */
  emitAgentEvent(companyId: Id, event: AgentEvent): void {
    this.io.to(room(companyId)).emit("agent:event", event);
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
