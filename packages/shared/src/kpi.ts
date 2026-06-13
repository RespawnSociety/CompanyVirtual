/**
 * Kontrak KPI / pemantauan biaya (Phase 5.4, plan §8). Sumber kebenaran tipe untuk
 * endpoint `GET /api/companies/:id/kpi` dan dashboard web.
 *
 * Biaya bersifat ESTIMASI: token nyata (dari 9Router `usage`) × tarif per-tier yang bisa
 * diatur (env). Tier `subscription` umumnya berlangganan flat → tarif default 0; `cheap`/`free`
 * bisa diberi tarif untuk perkiraan. Semua angka non-sensitif.
 */

import type { Id, ModelTier } from "./types.js";

/** Satu peristiwa pemakaian LLM (teragregasi per loop agent) yang dipersist. */
export interface UsageEvent {
  id: Id;
  companyId: Id;
  departmentId?: Id;
  agentId: Id;
  tier: ModelTier;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  at: number;
}

/** Tarif estimasi biaya per 1.000 token, per tier (mata uang dapat diatur). */
export interface CostRates {
  /** Mata uang untuk tampilan (mis. "IDR", "USD"). */
  currency: string;
  /** Biaya per 1.000 token per tier (gabungan prompt+completion, disederhanakan). */
  perThousandTokens: Record<ModelTier, number>;
}

/** Rincian token + estimasi biaya. */
export interface TokenCost {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCalls: number;
  /** Estimasi biaya (mata uang `CostRates.currency`). */
  estimatedCost: number;
}

/** Aktivitas kerja sebuah departemen/company (dari task/artifact/directive/audit). */
export interface ActivityStats {
  tasksTotal: number;
  tasksDone: number;
  tasksBlocked: number;
  tasksInProgress: number;
  artifacts: number;
  directives: number;
  /** Aksi eksternal yang berhasil (publish + outreach). */
  externalActions: number;
  approvalsRequested: number;
  approvalsDecided: number;
}

/** Ringkasan status agent (idle/working/talking/blocked). */
export interface AgentStatusStats {
  total: number;
  idle: number;
  working: number;
  talking: number;
  blocked: number;
}

/** KPI satu departemen. */
export interface DepartmentKpi {
  departmentId: Id;
  name: string;
  templateId?: Id;
  cost: TokenCost;
  /** Rincian token per tier (untuk transparansi tarif). */
  byTier: Partial<Record<ModelTier, TokenCost>>;
  activity: ActivityStats;
  agents: AgentStatusStats;
}

/** Titik biaya per hari kerja (untuk grafik "biaya per hari"). */
export interface DailyCostPoint {
  /** Tanggal lokal `YYYY-MM-DD`. */
  day: string;
  cost: TokenCost;
}

/** Laporan KPI lengkap satu company. */
export interface KpiReport {
  companyId: Id;
  generatedAt: number;
  rates: CostRates;
  /** Total seluruh company. */
  total: TokenCost;
  activity: ActivityStats;
  agents: AgentStatusStats;
  /** Biaya per hari kerja (urut menaik berdasarkan tanggal). */
  byDay: DailyCostPoint[];
  /** Rincian per departemen. */
  departments: DepartmentKpi[];
}
