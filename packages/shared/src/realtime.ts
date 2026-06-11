/**
 * Kontrak realtime FACE ↔ ORCH (plan §2: BUS → WORLD).
 * Dipakai server (socket.io) & web (socket.io-client) agar tipe event konsisten dua sisi.
 */

import type { AgentEvent } from "./events.js";
import type { AgentProfile, Company, Department, Floor, Id } from "./types.js";

/**
 * Read model satu company untuk render world & sinkronisasi. Gabungan entitas
 * Configuration layer yang dibutuhkan FACE untuk menggambar lantai + karakter.
 */
export interface WorldSnapshot {
  company: Company;
  floors: Floor[];
  departments: Department[];
  agents: AgentProfile[];
}

/** Event dari server → client (socket.io). */
export interface ServerToClientEvents {
  /** Snapshot terbaru sebuah company (dikirim saat subscribe & tiap config berubah). */
  "world:sync": (snapshot: WorldSnapshot) => void;
  /** Event agent runtime → animasi karakter (dipakai mulai Phase 2). */
  "agent:event": (event: AgentEvent) => void;
}

/** Event dari client → server (socket.io). */
export interface ClientToServerEvents {
  /** Berlangganan update sebuah company; server membalas `world:sync`. */
  "world:subscribe": (companyId: Id) => void;
}
