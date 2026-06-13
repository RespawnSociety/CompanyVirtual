/**
 * Phase 4.3 — Audit log + Approval store. Membuktikan persist & query: addAuditEntry/list,
 * countAuditByAgentSince (filter action + window), createApproval/decideApproval.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { ConfigStore } from "@vc/server";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

describe("Phase 4.3 — audit & approval store", () => {
  let store: ConfigStore;

  beforeAll(async () => {
    store = await createTestStore();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await store.close();
  });

  it("addAuditEntry + listAuditByCompany (urut waktu) + getAuditEntry", async () => {
    const c = await store.createCompany({ name: "Audit Co" });
    const e1 = await store.addAuditEntry(
      { companyId: c.id, agentId: "ag-1", action: "ig_post", detail: { dryRun: true } },
      1000,
    );
    const e2 = await store.addAuditEntry(
      { companyId: c.id, agentId: "ag-1", action: "approval_decided", approvalId: "appr-1", detail: { decision: "approve" } },
      2000,
    );
    const list = await store.listAuditByCompany(c.id);
    expect(list.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect((await store.getAuditEntry(e2.id))!.approvalId).toBe("appr-1");
    expect((await store.getAuditEntry(e1.id))!.detail["dryRun"]).toBe(true);
  });

  it("countAuditByAgentSince: filter action + jendela waktu", async () => {
    const c = await store.createCompany({ name: "Count Co" });
    await store.addAuditEntry({ companyId: c.id, agentId: "ag-x", action: "schedule_post" }, 1_000);
    await store.addAuditEntry({ companyId: c.id, agentId: "ag-x", action: "schedule_post" }, 5_000);
    await store.addAuditEntry({ companyId: c.id, agentId: "ag-x", action: "ig_post" }, 5_000);
    await store.addAuditEntry({ companyId: c.id, agentId: "ag-y", action: "schedule_post" }, 5_000);

    // ag-x, action schedule_post|ig_post, sejak ts=2000 → hanya 2 (yang ts=5000).
    expect(await store.countAuditByAgentSince("ag-x", ["schedule_post", "ig_post"], 2_000)).toBe(2);
    // sejak ts=0 → 3 (dua schedule + satu ig untuk ag-x).
    expect(await store.countAuditByAgentSince("ag-x", ["schedule_post", "ig_post"], 0)).toBe(3);
    // action lain → 0.
    expect(await store.countAuditByAgentSince("ag-x", ["twitter_post"], 0)).toBe(0);
  });

  it("createApproval (pending) → decideApproval (approved + note + decidedAt)", async () => {
    const c = await store.createCompany({ name: "Appr Co" });
    const a = await store.createApproval({ id: "appr-xyz", companyId: c.id, summary: "Publish caption" });
    expect(a.status).toBe("pending");
    expect(a.id).toBe("appr-xyz");

    const decided = await store.decideApproval("appr-xyz", "approved", "ok lanjut", 4242);
    expect(decided!.status).toBe("approved");
    expect(decided!.note).toBe("ok lanjut");
    expect(decided!.decidedAt).toBe(4242);

    // approval tak dikenal → undefined.
    expect(await store.decideApproval("appr-nope", "rejected")).toBeUndefined();
  });
});
