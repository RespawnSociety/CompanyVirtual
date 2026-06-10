/**
 * Kontrak skill/tool — plan §3.2. Skill bersifat GLOBAL & GENERIK.
 * Departemen apa pun memilih dari Skill Registry. Menambah skill = menambah file
 * di `agent-runtime/src/skills/`, BUKAN mengubah agent loop.
 */

import type { EmitFn } from "./events.js";
import type { ApprovalRequest, Id } from "./types.js";
import type { RouterClient } from "./router.js";

/**
 * JSON Schema (subset) untuk mendeskripsikan parameter skill ke LLM.
 * Sengaja longgar; validasi runtime dilakukan terpisah.
 */
export interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  [key: string]: unknown;
}

/** Pembaca rahasia (kredensial) dari Vault — tidak pernah expose nilai mentah ke prompt. */
export interface VaultReader {
  /** Ambil sebuah secret berdasarkan key logis (mis. "twitter.accessToken"). */
  get(key: string): Promise<string | undefined>;
  /** Cek keberadaan tanpa membaca nilainya. */
  has(key: string): Promise<boolean>;
}

/** Draft permintaan approval yang diajukan skill berisiko. */
export interface ApprovalDraft {
  summary: string;
  /**
   * Id artifact yang akan dieksekusi (mis. konten yang mau dipublish).
   * Opsional: sebagian aksi berisiko belum punya artifact saat gate dipicu —
   * orchestrator/approval gate yang melengkapinya (lihat plan §8).
   */
  artifactId?: Id;
}

/** Konteks yang di-inject ke tiap pemanggilan skill (plan §3.2). */
export interface SkillContext {
  agentId: Id;
  router: RouterClient;
  vault: VaultReader;
  emit: EmitFn;
  /** Ajukan approval; resolve setelah owner memutuskan (atau pending bila async). */
  requestApproval: (req: ApprovalDraft) => Promise<ApprovalRequest>;
  /** Sinyal pembatalan agar skill panjang bisa berhenti rapi. */
  signal?: AbortSignal;
}

/** Definisi satu skill. `I` = tipe input, `O` = tipe output. */
export interface Skill<I = unknown, O = unknown> {
  /** Nama unik; dipakai LLM untuk memilih tool. */
  name: string;
  /** Deskripsi; dipakai LLM untuk memutuskan kapan memakai. */
  description: string;
  /** Schema parameter (diteruskan ke router sebagai tool definition). */
  paramsSchema: JsonSchema;
  /** Bila true → aksi berisiko, WAJIB melewati approval gate (plan §8). */
  risky?: boolean;
  handler: (input: I, ctx: SkillContext) => Promise<O>;
}
