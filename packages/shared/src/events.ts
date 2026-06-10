/**
 * Kontrak event — dipancarkan agent runtime, dikonsumsi orchestrator & world 2D
 * (event bus → animasi karakter). Lihat plan §2 (BUS → WORLD) & §3.1 (emitEvents).
 *
 * Event adalah union ber-`type` agar konsumen bisa narrowing secara aman.
 */

import type { AgentStatus, Id } from "./types.js";

/** Field yang dimiliki semua event. */
interface AgentEventBase {
  agentId: Id;
  /** Epoch ms saat event dibuat. */
  at: number;
}

/** Perubahan status agent → menggerakkan sprite (idle/working/talking/blocked). */
export interface AgentStatusEvent extends AgentEventBase {
  type: "status";
  status: AgentStatus;
}

/** Agent mulai menjalankan sebuah skill/tool. */
export interface AgentSkillStartEvent extends AgentEventBase {
  type: "skill_start";
  skill: string;
  /** Argumen ringkas (jangan masukkan secret). */
  args?: Record<string, unknown>;
}

/** Agent selesai menjalankan skill (sukses/gagal). */
export interface AgentSkillEndEvent extends AgentEventBase {
  type: "skill_end";
  skill: string;
  ok: boolean;
  /** Ringkasan hasil/eror untuk observability (bukan payload penuh). */
  summary?: string;
}

/** Agent menghasilkan pesan/teks (mis. balasan, log think). */
export interface AgentMessageEvent extends AgentEventBase {
  type: "message";
  /** Tujuan: "user" (keluar via comms) atau id agent (internal). */
  to: "user" | Id;
  text: string;
}

/** Agent meminta approval untuk aksi berisiko (pause sampai diputuskan). */
export interface AgentApprovalRequestedEvent extends AgentEventBase {
  type: "approval_requested";
  approvalId: Id;
  summary: string;
}

/** Agent menulis item memory baru. */
export interface AgentMemoryEvent extends AgentEventBase {
  type: "memory";
  memoryId: Id;
  kind: string;
}

/** Eror tingkat-loop (mis. router gagal di semua tier). */
export interface AgentErrorEvent extends AgentEventBase {
  type: "error";
  message: string;
}

/** Union semua event agent. */
export type AgentEvent =
  | AgentStatusEvent
  | AgentSkillStartEvent
  | AgentSkillEndEvent
  | AgentMessageEvent
  | AgentApprovalRequestedEvent
  | AgentMemoryEvent
  | AgentErrorEvent;

/** Tipe diskriminan untuk indexing/filtering. */
export type AgentEventType = AgentEvent["type"];

/** Fungsi penerima event (di-inject ke SkillContext & loop). */
export type EmitFn = (event: AgentEvent) => void;
