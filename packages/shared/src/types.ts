/**
 * Kontrak inti data model — sumber kebenaran tipe untuk seluruh platform.
 * Diturunkan dari `virtual-company-platform-plan.md` §9.
 *
 * Aturan: implementasi di package lain TIDAK boleh menyimpang dari tipe di sini.
 * Tambah field di sini dulu, baru pakai di tempat lain.
 */

/** Identifier unik (opaque string, mis. uuid/nanoid). */
export type Id = string;

/** Posisi 2D di world (grid kantor). */
export interface Vec2 {
  x: number;
  y: number;
}

// ============================================================
// Configuration layer — Company / Floor / Department / Template
// ============================================================

/** Perusahaan virtual yang dibuat & dinamai pengguna. */
export interface Company {
  id: Id;
  name: string;
  branding?: Record<string, unknown>;
  createdAt: number;
  floorIds: Id[];
}

/** Satu lantai kantor; memuat satu atau lebih departemen. */
export interface Floor {
  id: Id;
  companyId: Id;
  name: string;
  /** Urutan lantai (0-based) untuk navigasi antar lantai. */
  index: number;
  /** Kunci map Tiled yang dipakai render lantai ini. */
  mapKey: string;
  departmentIds: Id[];
}

/** Departemen di sebuah lantai; berisi agent (karakter). */
export interface Department {
  id: Id;
  companyId: Id;
  floorId: Id;
  name: string;
  /** Template asal bila dibuat dari Department Template (opsional bila custom). */
  templateId?: Id;
  /** Tujuan departemen (dipakai konteks LLM & UI). */
  purpose: string;
  /** Subset skill dari Skill Registry yang boleh dipakai departemen ini. */
  skillPool: string[];
  /** Workflow yang dijalankan departemen ini (opsional sampai dikonfigurasi). */
  workflowId?: Id;
  agentIds: Id[];
}

/** Paket siap pakai: role default + skill default + workflow default. */
export interface DepartmentTemplate {
  id: Id;
  name: string;
  description: string;
  roleTemplates: RoleTemplate[];
  defaultSkills: string[];
  defaultWorkflow: WorkflowDef;
}

/** Cetakan satu role di dalam template. */
export interface RoleTemplate {
  role: string;
  description: string;
  skillScope: string[];
  guardrails: Guardrail[];
  spriteKey?: string;
}

// ============================================================
// Agent (karakter) & guardrails
// ============================================================

/** Status visual/operasional agent (menggerakkan animasi). */
export type AgentStatus = "idle" | "working" | "talking" | "blocked";

/** Tier model untuk routing biaya via 9Router. */
export type ModelTier = "subscription" | "cheap" | "free";

/** Kebijakan pemilihan model per agent (diteruskan ke router). */
export interface ModelPolicy {
  tier?: ModelTier;
  preferredProvider?: string;
}

/** Aturan pembatas perilaku agent ("bebas dalam lingkup kerja"). */
export interface Guardrail {
  rule: string;
  params?: Record<string, unknown>;
}

/** Profil agent = definisi satu karakter. Hasil dari Character Editor. */
export interface AgentProfile {
  id: Id;
  departmentId: Id;
  name: string;
  role: string;
  /** Posisi meja di lantai. */
  deskPos: Vec2;
  spriteKey: string;
  /** Deskripsi bebas → dipakai sebagai system prompt/persona. */
  description: string;
  /** Skill yang boleh dipanggil agent ini (subset Skill Registry). */
  skillScope: string[];
  guardrails: Guardrail[];
  /** Handle comms (mis. nomor WA bila pakai handle per-agent). */
  commsHandle?: string;
  modelPolicy?: ModelPolicy;
  /** Namespace memory (isolasi memory per-agent). */
  memoryNamespace: string;
  status: AgentStatus;
}

// ============================================================
// Workflow (generik, data-driven)
// ============================================================

/** Penanda tujuan langkah berikutnya yang punya makna khusus di engine. */
export type WorkflowStepNext = Id | "approval_gate" | "loop_until_pass";

/** Satu langkah pipeline departemen. */
export interface WorkflowStep {
  id: Id;
  /** Role pelaksana langkah ini. */
  role: string;
  /** Skill/intent yang dijalankan. */
  action: string;
  /** Langkah berikutnya, atau gate/loop khusus. */
  next?: WorkflowStepNext;
}

/** Definisi pipeline yang dijalankan engine (engine membaca data ini, bukan if-else). */
export interface WorkflowDef {
  id: Id;
  name: string;
  steps: WorkflowStep[];
}

// ============================================================
// Memory
// ============================================================

export type MemoryKind = "observation" | "decision" | "result";

/** Satu item memory long-term per agent. */
export interface MemoryItem {
  id: Id;
  agentId: Id;
  kind: MemoryKind;
  text: string;
  createdAt: number;
  /** Skor kepentingan (0..1) untuk retrieval relevance. */
  importance: number;
  tags: string[];
  /** Embedding opsional (via 9Router nanti); keyword dulu di Phase 0. */
  embedding?: number[];
}

// ============================================================
// Directive / Task / Artifact / Approval / Comms / Audit
// ============================================================

export type DirectiveSource = "whatsapp" | "ui";
export type DirectiveStatus =
  | "received"
  | "planned"
  | "in_progress"
  | "awaiting_approval"
  | "blocked"
  | "done";

/** Arahan dari user (lewat WA atau UI). */
export interface Directive {
  id: Id;
  text: string;
  source: DirectiveSource;
  createdAt: number;
  status: DirectiveStatus;
}

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "awaiting_approval"
  | "done";

/** Unit kerja yang di-dispatch ke agent. */
export interface Task {
  id: Id;
  directiveId: Id;
  departmentId: Id;
  title: string;
  assignee: Id;
  status: TaskStatus;
  inputs?: Record<string, unknown>;
  outputRef?: Id;
  dependsOn: Id[];
}

/** Output kerja agent (konten, hasil riset, dll). */
export interface Artifact {
  id: Id;
  kind: string;
  taskId: Id;
  content: string;
  meta?: Record<string, unknown>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Permintaan approval untuk aksi berisiko (selalu via WA). */
export interface ApprovalRequest {
  id: Id;
  summary: string;
  artifactId: Id;
  channel: "whatsapp";
  status: ApprovalStatus;
  decidedAt?: number;
  note?: string;
}

/** Identitas peserta percakapan: "user" atau id agent. */
export type CommsParty = "user" | Id;
export type CommsChannel = "whatsapp" | "internal";

/** Satu pesan dalam thread percakapan. */
export interface CommsMessage {
  id: Id;
  threadId: Id;
  from: CommsParty;
  to: CommsParty;
  channel: CommsChannel;
  text: string;
  at: number;
}

/** Catatan audit tiap aksi + approval (lihat plan §8). */
export interface AuditEntry {
  id: Id;
  agentId: Id;
  action: string;
  approvalId?: Id;
  at: number;
  detail: Record<string, unknown>;
}
