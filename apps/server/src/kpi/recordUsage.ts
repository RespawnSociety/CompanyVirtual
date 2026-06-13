/**
 * recordLoopUsage (Phase 5.4) — persist pemakaian token satu loop agent ke `usage_events`
 * (satu baris per tier). Dipanggil dispatcher (single-agent) & workflow engine (per step).
 *
 * CR-111: pemanggil meng-`await` ini (insert kecil & cepat) lalu MEMBUNGKUS dengan `.catch()` →
 * usage dijamin tersimpan sebelum kerja ditandai selesai (KPI akurat seketika) DAN kegagalan
 * pencatatan biaya hanya di-log, TIDAK menggagalkan kerja agent. Sengaja BUKAN fire-and-forget:
 * melepas insert ke latar bisa menulis ke pool yang sudah ditutup (mis. teardown test) → error.
 */

import type { Id, ModelTier } from "@vc/shared";
import type { LoopUsage } from "@vc/agent-runtime";
import type { ConfigStore } from "../db/store.js";

export interface UsageScope {
  companyId?: Id;
  departmentId?: Id;
  agentId: Id;
}

export async function recordLoopUsage(
  store: ConfigStore,
  scope: UsageScope,
  usage: LoopUsage | undefined,
  now?: number,
): Promise<void> {
  if (!usage) return;
  for (const [tier, totals] of Object.entries(usage.byTier)) {
    if (!totals) continue;
    await store.addUsageEvent(
      {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
        agentId: scope.agentId,
        tier: tier as ModelTier,
        calls: totals.calls,
        promptTokens: totals.promptTokens,
        completionTokens: totals.completionTokens,
        totalTokens: totals.totalTokens,
      },
      now,
    );
  }
}
