import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { AgentEvent, ChatRequest, Id } from "@vc/shared";
import { WorkflowEngine, seedDepartmentFromTemplate, type ConfigStore } from "@vc/server";
import {
  SkillRegistry,
  createWebSearchSkill,
  createWriteContentSkill,
  createReviewContentSkill,
  createMarketResearchSkill,
  createWebFetchSkill,
  MockRouterClient,
  textResponse,
} from "@vc/agent-runtime";
import { MARKETING_TEMPLATE } from "@vc/templates";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

function allSkills(): SkillRegistry {
  return new SkillRegistry().registerAll([
    createWebSearchSkill(),
    createWriteContentSkill(),
    createReviewContentSkill(),
    createMarketResearchSkill(),
    createWebFetchSkill(),
  ]);
}

/** Seed marketing dept (workflow + 5 role) dan kembalikan id penting. */
async function seedMarketing(store: ConfigStore): Promise<{ companyId: Id; departmentId: Id }> {
  const c = await store.createCompany({ name: "WF Co" });
  const f = await store.createFloor(c.id, { name: "L1" });
  const seeded = await seedDepartmentFromTemplate(store, {
    companyId: c.id,
    floorId: f.id,
    template: MARKETING_TEMPLATE,
  });
  return { companyId: c.id, departmentId: seeded.department.id };
}

const instr = (req: ChatRequest): string => req.messages.map((m) => m.content ?? "").join("\n");

describe("Phase 3 — WorkflowEngine (pipeline generik + approval gate)", () => {
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

  it("pipeline lolos review → PAUSE di approval_gate → resume APPROVE → done", async () => {
    const { companyId, departmentId } = await seedMarketing(store);
    const events: AgentEvent[] = [];
    // Responder berbasis isi instruksi: review → PASS, approval → ringkasan, lainnya → output.
    const router = new MockRouterClient([
      (req) => {
        const t = instr(req);
        if (/review output terakhir/i.test(t)) return textResponse("PASS\nKonten layak terbit.");
        if (/persetujuan owner/i.test(t)) return textResponse("Ringkasan: caption final siap publish.");
        return textResponse("Output langkah siap dipakai.");
      },
    ]);
    const engine = new WorkflowEngine({
      store,
      router,
      skills: allSkills(),
      memory: store.createMemoryStore(),
      emitAgentEvent: (_c, e) => events.push(e),
    });

    const { directive, run, done } = await engine.startForDepartment(departmentId, "Kampanye diskon akhir pekan", "ui");
    expect(run.status).toBe("running");

    const paused = await done;
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.approvalId).toBeTruthy();
    expect((await store.getDirective(directive.id))!.status).toBe("awaiting_approval");

    // Task per step sampai approval (intake, research, write, review, approval) = 5.
    const tasksBefore = await store.listTasksByCompany(companyId);
    expect(tasksBefore.length).toBe(5);
    expect(tasksBefore.every((t) => t.status === "done")).toBe(true);

    // Event: minta approval + pesan ke owner (Manager wajah).
    expect(events.some((e) => e.type === "approval_requested")).toBe(true);
    expect(events.some((e) => e.type === "message" && e.to === "user")).toBe(true);

    // Resume APPROVE → publish (stub) → done.
    const resumed = await engine.resumeByApproval(paused.approvalId!, "approve");
    expect(resumed!.status).toBe("done");
    expect((await store.getDirective(directive.id))!.status).toBe("done");
    const tasksAfter = await store.listTasksByCompany(companyId);
    expect(tasksAfter.length).toBe(6); // + publish
  });

  it("reviewer minta REVISI → loop balik ke step konten (reviewRounds naik) lalu lanjut", async () => {
    const { departmentId } = await seedMarketing(store);
    let reviewSeen = 0;
    const router = new MockRouterClient([
      (req) => {
        const t = instr(req);
        if (/review output terakhir/i.test(t)) {
          reviewSeen += 1;
          return textResponse(reviewSeen === 1 ? "REVISI: tambahkan CTA yang kuat." : "PASS\nSudah oke.");
        }
        if (/persetujuan owner/i.test(t)) return textResponse("Ringkasan final.");
        return textResponse("Output langkah.");
      },
    ]);
    const engine = new WorkflowEngine({
      store,
      router,
      skills: allSkills(),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });

    const { done } = await engine.startForDepartment(departmentId, "Bikin konten", "ui");
    const paused = await done;
    expect(reviewSeen).toBeGreaterThanOrEqual(2); // direview ulang setelah revisi
    expect(paused.reviewRounds).toBeGreaterThanOrEqual(1);
    expect(paused.status).toBe("awaiting_approval");
  });

  it("resume REVISI → ulang dari step konten lalu PAUSE lagi di approval (approvalId baru)", async () => {
    const { departmentId } = await seedMarketing(store);
    const router = new MockRouterClient([
      (req) => {
        const t = instr(req);
        if (/review output terakhir/i.test(t)) return textResponse("PASS\nlayak.");
        if (/persetujuan owner/i.test(t)) return textResponse("Ringkasan.");
        return textResponse("Output.");
      },
    ]);
    const engine = new WorkflowEngine({
      store,
      router,
      skills: allSkills(),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });

    const { done } = await engine.startForDepartment(departmentId, "Konten X", "ui");
    const paused = await done;
    const firstApproval = paused.approvalId!;
    const resumed = await engine.resumeByApproval(firstApproval, "revise", "ganti angle");
    expect(resumed!.status).toBe("awaiting_approval");
    expect(resumed!.approvalId).toBeTruthy();
    expect(resumed!.approvalId).not.toBe(firstApproval);
  });

  it("department tanpa workflow → departmentHasWorkflow false; resume approval tak dikenal → undefined", async () => {
    const c = await store.createCompany({ name: "NoWf" });
    const f = await store.createFloor(c.id, { name: "L1" });
    const d = await store.createDepartment(c.id, f.id, { name: "Custom", purpose: "p" });
    const engine = new WorkflowEngine({
      store,
      router: new MockRouterClient([textResponse("x")]),
      skills: allSkills(),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });
    expect(await engine.departmentHasWorkflow(d.id)).toBe(false);
    expect(await engine.resumeByApproval("appr_tidakada", "approve")).toBeUndefined();
  });
});
