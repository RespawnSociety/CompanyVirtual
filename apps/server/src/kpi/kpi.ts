/**
 * computeKpi (Phase 5.4) — agregasi KPI biaya + aktivitas + status agent per company/departemen.
 *
 * Biaya = token NYATA (tabel `usage_events`, dari 9Router `usage`) × tarif per-tier (`CostRates`).
 * Aktivitas & status dibaca dari tabel runtime yang sudah ada (tasks/artifacts/directives/audit/agents).
 * Agregasi dilakukan di memori (skala single-user kecil) untuk menjaga store tetap sederhana & teruji.
 */

import type {
  ActivityStats,
  AgentStatusStats,
  AgentProfile,
  AuditEntry,
  CostRates,
  DailyCostPoint,
  DepartmentKpi,
  Id,
  KpiReport,
  ModelTier,
  Task,
  UsageEvent,
} from "@vc/shared";
import type { ConfigStore } from "../db/store.js";
import { EXTERNAL_POST_ACTIONS } from "../security/guardrails.js";

const EXTERNAL_ACTION_SET = new Set(EXTERNAL_POST_ACTIONS);

function blankCost(): KpiReport["total"] {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, llmCalls: 0, estimatedCost: 0 };
}

function blankActivity(): ActivityStats {
  return {
    tasksTotal: 0,
    tasksDone: 0,
    tasksBlocked: 0,
    tasksInProgress: 0,
    artifacts: 0,
    directives: 0,
    externalActions: 0,
    approvalsRequested: 0,
    approvalsDecided: 0,
  };
}

function blankAgents(): AgentStatusStats {
  return { total: 0, idle: 0, working: 0, talking: 0, blocked: 0 };
}

/** Tambah satu usage event ke akumulator biaya (token + estimasi biaya per tarif tier). */
function addUsage(acc: KpiReport["total"], ev: UsageEvent, rates: CostRates): void {
  acc.promptTokens += ev.promptTokens;
  acc.completionTokens += ev.completionTokens;
  acc.totalTokens += ev.totalTokens;
  acc.llmCalls += ev.calls;
  const rate = rates.perThousandTokens[ev.tier] ?? 0;
  acc.estimatedCost += (ev.totalTokens / 1000) * rate;
}

/** Bulatkan biaya ke 2 desimal (hindari noise float saat dijumlah). */
function roundCost(c: KpiReport["total"]): void {
  c.estimatedCost = Math.round(c.estimatedCost * 100) / 100;
}

/** Kunci hari LOKAL `YYYY-MM-DD` dari epoch ms (untuk grafik "biaya per hari kerja"). */
function localDayKey(at: number): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tallyTask(activity: ActivityStats, status: Task["status"]): void {
  activity.tasksTotal += 1;
  if (status === "done") activity.tasksDone += 1;
  else if (status === "blocked") activity.tasksBlocked += 1;
  else if (status === "in_progress") activity.tasksInProgress += 1;
}

function tallyAudit(activity: ActivityStats, action: string): void {
  if (EXTERNAL_ACTION_SET.has(action)) activity.externalActions += 1;
  else if (action === "approval_requested") activity.approvalsRequested += 1;
  else if (action === "approval_decided") activity.approvalsDecided += 1;
}

function tallyAgent(stats: AgentStatusStats, status: AgentProfile["status"]): void {
  stats.total += 1;
  stats[status] += 1;
}

/**
 * Hitung KPI lengkap satu company. `now` default `Date.now()` (di-inject untuk test deterministik).
 * Mengembalikan `undefined` bila company tidak ada.
 */
export async function computeKpi(
  store: ConfigStore,
  companyId: Id,
  rates: CostRates,
  now: number = Date.now(),
): Promise<KpiReport | undefined> {
  if (!(await store.getCompany(companyId))) return undefined;

  const [usage, tasks, artifacts, directives, audit, agents, departments] = await Promise.all([
    store.listUsageByCompany(companyId),
    store.listTasksByCompany(companyId),
    store.listArtifactsByCompany(companyId),
    store.listDirectivesByCompany(companyId),
    store.listAuditByCompany(companyId),
    store.listAgentsByCompany(companyId),
    store.listDepartmentsByCompany(companyId),
  ]);

  // Peta bantu: agentId → departmentId (untuk atribusi audit), taskId → departmentId (artifact).
  const agentToDept = new Map<Id, Id>(agents.map((a) => [a.id, a.departmentId]));
  const deptIds = new Set<Id>(departments.map((d) => d.id));
  const taskToDept = new Map<Id, Id>(tasks.map((t) => [t.id, t.departmentId]));

  /** Resolusi departemen sebuah audit entry: agentId bisa = agentId ATAU departmentId (engine). */
  const auditDept = (e: AuditEntry): Id | undefined =>
    agentToDept.get(e.agentId) ?? (deptIds.has(e.agentId) ? e.agentId : undefined);

  // ---- Akumulator per departemen ----
  interface DeptAcc {
    cost: KpiReport["total"];
    byTier: Map<ModelTier, KpiReport["total"]>;
    activity: ActivityStats;
    agents: AgentStatusStats;
    directiveIds: Set<Id>;
  }
  const deptAcc = new Map<Id, DeptAcc>();
  for (const d of departments) {
    deptAcc.set(d.id, {
      cost: blankCost(),
      byTier: new Map(),
      activity: blankActivity(),
      agents: blankAgents(),
      directiveIds: new Set(),
    });
  }

  // ---- Totals company ----
  const total = blankCost();
  const companyActivity = blankActivity();
  const companyAgents = blankAgents();
  const byDay = new Map<string, KpiReport["total"]>();

  // Usage → biaya (company, per-hari, per-dept, per-tier).
  for (const ev of usage) {
    addUsage(total, ev, rates);
    const dayKey = localDayKey(ev.at);
    const dayCost = byDay.get(dayKey) ?? blankCost();
    addUsage(dayCost, ev, rates);
    byDay.set(dayKey, dayCost);
    if (ev.departmentId) {
      const acc = deptAcc.get(ev.departmentId);
      if (acc) {
        addUsage(acc.cost, ev, rates);
        const tierCost = acc.byTier.get(ev.tier) ?? blankCost();
        addUsage(tierCost, ev, rates);
        acc.byTier.set(ev.tier, tierCost);
      }
    }
  }

  // Tasks → aktivitas.
  for (const t of tasks) {
    tallyTask(companyActivity, t.status);
    const acc = deptAcc.get(t.departmentId);
    if (acc) {
      tallyTask(acc.activity, t.status);
      acc.directiveIds.add(t.directiveId);
    }
  }

  // Artifacts → aktivitas (via task → dept).
  for (const a of artifacts) {
    companyActivity.artifacts += 1;
    const deptId = taskToDept.get(a.taskId);
    if (deptId) {
      const acc = deptAcc.get(deptId);
      if (acc) acc.activity.artifacts += 1;
    }
  }

  // Directives → aktivitas (company-level; per-dept dihitung dari task di bawah).
  companyActivity.directives = directives.length;

  // Audit → aksi eksternal & approval (company + per-dept via agent/dept mapping).
  for (const e of audit) {
    tallyAudit(companyActivity, e.action);
    const deptId = auditDept(e);
    if (deptId) {
      const acc = deptAcc.get(deptId);
      if (acc) tallyAudit(acc.activity, e.action);
    }
  }

  // Agents → status (company + per-dept).
  for (const a of agents) {
    tallyAgent(companyAgents, a.status);
    const acc = deptAcc.get(a.departmentId);
    if (acc) tallyAgent(acc.agents, a.status);
  }

  // Susun output departemen (urut sesuai daftar departemen).
  const departmentKpis: DepartmentKpi[] = departments.map((d) => {
    const acc = deptAcc.get(d.id)!;
    acc.activity.directives = acc.directiveIds.size;
    roundCost(acc.cost);
    const byTier: DepartmentKpi["byTier"] = {};
    for (const [tier, cost] of acc.byTier) {
      roundCost(cost);
      byTier[tier] = cost;
    }
    return {
      departmentId: d.id,
      name: d.name,
      ...(d.templateId ? { templateId: d.templateId } : {}),
      cost: acc.cost,
      byTier,
      activity: acc.activity,
      agents: acc.agents,
    };
  });

  roundCost(total);
  const dailyPoints: DailyCostPoint[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, cost]) => {
      roundCost(cost);
      return { day, cost };
    });

  return {
    companyId,
    generatedAt: now,
    rates,
    total,
    activity: companyActivity,
    agents: companyAgents,
    byDay: dailyPoints,
    departments: departmentKpis,
  };
}
