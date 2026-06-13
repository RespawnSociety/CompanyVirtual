/**
 * Phase 5.4 (KPI biaya/aktivitas/status) + 5.3 (custom dept) + 5.1/5.2 store-level:
 *  - computeKpi mengagregasi token→biaya per company/dept/tier/hari, aktivitas, status agent.
 *  - Sales template di-seed engine GENERIK (5 agent + workflow clone) sama seperti Marketing.
 *  - Departemen CUSTOM (tanpa template) bisa dibuat lewat REST & muncul di KPI.
 *  - Floor menyimpan mapKey berbeda (5.2 multi-map).
 *
 * Butuh MySQL hidup (lihat docs/RUNBOOK.md).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CostRates } from "@vc/shared";
import {
  buildServer,
  computeKpi,
  seedDepartmentFromTemplate,
  type ConfigStore,
} from "@vc/server";
import { MARKETING_TEMPLATE, SALES_TEMPLATE } from "@vc/templates";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

const RATES: CostRates = {
  currency: "IDR",
  perThousandTokens: { subscription: 0, cheap: 100, free: 0 },
};
const AT = 1_750_000_000_000; // timestamp tetap (satu hari) untuk byDay deterministik

describe("Phase 5 — KPI + custom dept + Sales seeding (DB)", () => {
  let store: ConfigStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    store = await createTestStore();
    app = buildServer({ configStore: store, costRates: RATES });
    await app.ready();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await app.close();
    await store.close();
  });

  it("Sales template di-seed engine generik (5 agent + workflow clone) di lantai map berbeda", async () => {
    const c = await store.createCompany({ name: "Co" });
    const f = await store.createFloor(c.id, { name: "L2", mapKey: "office-open" });
    expect(f.mapKey).toBe("office-open"); // 5.2: mapKey per lantai tersimpan

    const seeded = await seedDepartmentFromTemplate(store, {
      companyId: c.id,
      floorId: f.id,
      template: SALES_TEMPLATE,
    });
    expect(seeded.agents.map((a) => a.role)).toEqual(SALES_TEMPLATE.roleTemplates.map((r) => r.role));
    expect(seeded.department.workflowId).toBe(seeded.workflow.id);
    expect(seeded.workflow.id).not.toBe(SALES_TEMPLATE.defaultWorkflow.id);
  });

  it("computeKpi: biaya per tier/hari + aktivitas + status agent, per company & dept", async () => {
    const c = await store.createCompany({ name: "Co" });
    const f1 = await store.createFloor(c.id, { name: "L1" });
    const f2 = await store.createFloor(c.id, { name: "L2", mapKey: "office-open" });
    const mkt = await seedDepartmentFromTemplate(store, { companyId: c.id, floorId: f1.id, template: MARKETING_TEMPLATE });
    const sales = await seedDepartmentFromTemplate(store, { companyId: c.id, floorId: f2.id, template: SALES_TEMPLATE });
    const mAgent = mkt.agents[0]!;
    const sAgent = sales.agents[sales.agents.length - 1]!; // Outreach Rep

    // Usage: Marketing pakai subscription (gratis marginal) + cheap (berbiaya); Sales pakai free.
    await store.addUsageEvent({ companyId: c.id, departmentId: mkt.department.id, agentId: mAgent.id, tier: "subscription", calls: 2, promptTokens: 100, completionTokens: 50, totalTokens: 150 }, AT);
    await store.addUsageEvent({ companyId: c.id, departmentId: mkt.department.id, agentId: mAgent.id, tier: "cheap", calls: 1, promptTokens: 600, completionTokens: 400, totalTokens: 1000 }, AT);
    await store.addUsageEvent({ companyId: c.id, departmentId: sales.department.id, agentId: sAgent.id, tier: "free", calls: 1, promptTokens: 300, completionTokens: 200, totalTokens: 500 }, AT);

    // Tasks + artifact + audit + status.
    const dir = await store.createDirective(c.id, { text: "x", source: "ui", departmentId: mkt.department.id });
    const t1 = await store.createTask({ companyId: c.id, directiveId: dir.id, departmentId: mkt.department.id, title: "t1", assignee: mAgent.id, status: "done" });
    await store.createTask({ companyId: c.id, directiveId: dir.id, departmentId: mkt.department.id, title: "t2", assignee: mAgent.id, status: "blocked" });
    await store.createTask({ companyId: c.id, directiveId: dir.id, departmentId: sales.department.id, title: "t3", assignee: sAgent.id, status: "done" });
    await store.addArtifact({ taskId: t1.id, kind: "content", content: "hasil" });
    await store.addAuditEntry({ companyId: c.id, agentId: sAgent.id, action: "send_outreach", detail: {} });
    await store.addAuditEntry({ companyId: c.id, agentId: sales.department.id, action: "approval_requested", detail: {} });
    await store.addAuditEntry({ companyId: c.id, agentId: sales.department.id, action: "approval_decided", detail: {} });
    await store.updateAgent(mAgent.id, { status: "working" });

    const kpi = (await computeKpi(store, c.id, RATES, AT))!;
    expect(kpi).toBeTruthy();

    // Company totals: 150 + 1000 + 500 token; biaya hanya dari cheap (1000/1000*100 = 100).
    expect(kpi.total.totalTokens).toBe(1650);
    expect(kpi.total.llmCalls).toBe(4);
    expect(kpi.total.estimatedCost).toBe(100);

    // byDay: satu hari.
    expect(kpi.byDay).toHaveLength(1);
    expect(kpi.byDay[0]!.cost.totalTokens).toBe(1650);

    // Company activity + status.
    expect(kpi.activity.tasksDone).toBe(2);
    expect(kpi.activity.tasksBlocked).toBe(1);
    expect(kpi.activity.artifacts).toBe(1);
    expect(kpi.activity.externalActions).toBe(1);
    expect(kpi.activity.approvalsDecided).toBe(1);
    expect(kpi.agents.working).toBe(1);
    expect(kpi.agents.total).toBe(10); // 5 marketing + 5 sales

    // Per departemen.
    const m = kpi.departments.find((d) => d.departmentId === mkt.department.id)!;
    const s = kpi.departments.find((d) => d.departmentId === sales.department.id)!;
    expect(m.cost.totalTokens).toBe(1150);
    expect(m.cost.estimatedCost).toBe(100);
    expect(m.byTier.cheap?.totalTokens).toBe(1000);
    expect(m.byTier.subscription?.totalTokens).toBe(150);
    expect(m.activity.tasksDone).toBe(1);
    expect(m.activity.tasksBlocked).toBe(1);
    expect(m.activity.artifacts).toBe(1);
    expect(m.agents.working).toBe(1);
    expect(s.cost.totalTokens).toBe(500);
    expect(s.cost.estimatedCost).toBe(0);
    expect(s.activity.externalActions).toBe(1);
    expect(s.activity.approvalsRequested).toBe(1);
    expect(s.activity.approvalsDecided).toBe(1);
  });

  it("5.3: dept custom (tanpa template) via REST → dibuat, tanpa agent/workflow, muncul di KPI", async () => {
    const c = await store.createCompany({ name: "Co" });
    const f = await store.createFloor(c.id, { name: "L1" });

    const res = await app.inject({
      method: "POST",
      url: `/api/floors/${f.id}/departments`,
      payload: { name: "Riset Internal", purpose: "Eksperimen tanpa template", skillPool: ["web_search"] },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { department: { id: string; templateId?: string; workflowId?: string }; agents: unknown[]; workflow: unknown };
    expect(created.agents).toEqual([]);
    expect(created.workflow).toBeNull();
    expect(created.department.templateId).toBeUndefined();
    expect(created.department.workflowId).toBeUndefined();

    // Tambah satu karakter ke dept custom.
    const aRes = await app.inject({
      method: "POST",
      url: `/api/departments/${created.department.id}/agents`,
      payload: { name: "Periset", role: "Researcher", skillScope: ["web_search"] },
    });
    expect(aRes.statusCode).toBe(201);

    // KPI lewat REST: dept custom muncul dengan 1 agent.
    const kRes = await app.inject({ method: "GET", url: `/api/companies/${c.id}/kpi` });
    expect(kRes.statusCode).toBe(200);
    const kpi = kRes.json() as { departments: { departmentId: string; agents: { total: number } }[] };
    const dep = kpi.departments.find((d) => d.departmentId === created.department.id)!;
    expect(dep.agents.total).toBe(1);
  });
});
