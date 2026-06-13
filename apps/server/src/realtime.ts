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
import { hasValidSocketToken } from "./security/auth.js";

function room(companyId: Id): string {
  return `company:${companyId}`;
}

export class RealtimeHub {
  private readonly io: IoServer<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    httpServer: HttpServer,
    private readonly store: ConfigStore,
    corsOrigin: string | boolean = true,
    /** Token bearer wajib bila di-set (BUG-108: tutup celah socket tanpa auth saat REST dilindungi). */
    apiAuthToken?: string,
  ) {
    this.io = new IoServer(httpServer, { cors: { origin: corsOrigin } });

    // BUG-108/CR-101: bila token di-set, validasi handshake socket SEBELUM connection diterima.
    // Klien kirim via `auth: { token }` (socket.io-client) atau header Authorization.
    const token = apiAuthToken?.trim() || undefined;
    if (token) {
      this.io.use((socket, next) => {
        const handshakeToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
        const header = socket.handshake.headers.authorization;
        if (hasValidSocketToken(handshakeToken, header, token)) {
          next();
        } else {
          next(new Error("unauthorized: token socket tidak valid"));
        }
      });
    }

    this.io.on("connection", (socket) => {
      socket.on("world:subscribe", (companyId: Id) => {
        const target = room(companyId);
        // CR-108: subscribe idempoten — tinggalkan room company lain agar satu socket tak
        // menumpuk di >1 room company (cegah broadcast/snapshot ganda saat ganti company cepat).
        const stale = [...socket.rooms].filter((r) => r.startsWith("company:") && r !== target);
        for (const r of stale) void socket.leave(r);
        void socket.join(target);
        // Store async (MySQL): ambil snapshot lalu emit; error di-log, tak menjatuhkan socket.
        void this.store
          .getWorldSnapshot(companyId)
          .then((snap) => {
            if (snap) socket.emit("world:sync", snap);
          })
          .catch(() => {});
      });
    });
  }

  /** Kirim ulang snapshot company ke semua subscriber-nya (dipanggil setelah mutasi config). */
  async broadcastWorld(companyId: Id): Promise<void> {
    const snap = await this.store.getWorldSnapshot(companyId);
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
