/**
 * Phase 4 — publish via Workflow Engine (aksi eksternal + keamanan, end-to-end pakai mock publisher):
 *  - APPROVE → step publish menjalankan skill `schedule_post` (risky) → dry-run → run `done`,
 *    audit berisi approval_requested/decided + publish_authorized + schedule_post.
 *  - Guardrail rate_limit (maxPostsPerDay) → publish DITAHAN → run `blocked` + audit publish_blocked.
 *
 * Approval gate workflow = persetujuan owner; skill `risky` di segmen pasca-gate boleh eksekusi
 * TAPI tetap lewat guardrail. Router di-mock (tool-calling deterministik), tanpa 9Router/akun nyata.
 */

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
  createIgPostSkill,
  createTwitterPostSkill,
  createSchedulePostSkill,
  mockPostPublisher,
  MockRouterClient,
  textResponse,
  toolCallResponse,
} from "@vc/agent-runtime";
import { MARKETING_TEMPLATE } from "@vc/templates";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

function skillsWithSocial(): SkillRegistry {
  const pub = mockPostPublisher();
  return new SkillRegistry().registerAll([
    createWebSearchSkill(),
    createWriteContentSkill(),
    createReviewContentSkill(),
    createMarketResearchSkill(),
    createWebFetchSkill(),
    createIgPostSkill(pub),
    createTwitterPostSkill(pub),
    createSchedulePostSkill(pub),
  ]);
}

const instr = (req: ChatRequest): string => req.messages.map((m) => m.content ?? "").join("\n");
const hasToolMsg = (req: ChatRequest): boolean => req.messages.some((m) => m.role === "tool");

/** Responder: publish step → panggil schedule_post; setelah hasil tool → balas teks selesai. */
function publishResponder(req: ChatRequest) {
  if (hasToolMsg(req)) return textResponse("Konten sudah dijadwalkan.");
  const t = instr(req);
  if (/Tugasmu \(schedule_post\)/.test(t)) {
    return toolCallResponse("schedule_post", {
      content: "Caption final promo diskon 30%",
      platform: "instagram",
      scheduleAt: "2026-07-01T10:00:00.000Z",
    });
  }
  if (/review output terakhir/i.test(t)) return textResponse("PASS\nlayak terbit.");
  if (/persetujuan owner/i.test(t)) return textResponse("Ringkasan: caption siap publish.");
  return textResponse("Output langkah siap dipakai.");
}

async function seedMarketing(store: ConfigStore): Promise<{ companyId: Id; departmentId: Id }> {
  const c = await store.createCompany({ name: "Pub Co" });
  const f = await store.createFloor(c.id, { name: "L1" });
  const seeded = await seedDepartmentFromTemplate(store, {
    companyId: c.id,
    floorId: f.id,
    template: MARKETING_TEMPLATE,
  });
  return { companyId: c.id, departmentId: seeded.department.id };
}

describe("Phase 4 — publish (approval gate → guardrail → dry-run)", () => {
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

  it("APPROVE → schedule_post (dry-run) → run done + audit lengkap", async () => {
    const { companyId, departmentId } = await seedMarketing(store);
    const events: AgentEvent[] = [];
    const engine = new WorkflowEngine({
      store,
      router: new MockRouterClient([publishResponder]),
      skills: skillsWithSocial(),
      memory: store.createMemoryStore(),
      emitAgentEvent: (_c, e) => events.push(e),
    });

    const { run, done } = await engine.startForDepartment(departmentId, "Promo diskon 30% IG", "ui");
    const paused = await done;
    expect(paused.status).toBe("awaiting_approval");

    const resumed = await engine.resumeByApproval(paused.approvalId!, "approve");
    expect(resumed!.status).toBe("done");

    const audit = await store.listAuditByCompany(companyId);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("approval_requested");
    expect(actions).toContain("approval_decided");
    expect(actions).toContain("publish_authorized");
    expect(actions).toContain("schedule_post");

    const post = audit.find((a) => a.action === "schedule_post");
    expect(post!.detail["dryRun"]).toBe(true);
    expect(String(post!.detail["postId"])).toMatch(/^mock-instagram-/);

    // Approval record tercatat & approved.
    const approval = await store.getApproval(paused.approvalId!);
    expect(approval!.status).toBe("approved");
    expect(run.directiveId).toBeTruthy();
  });

  it("guardrail rate_limit (maxPostsPerDay=5) tercapai → publish DITAHAN → run blocked", async () => {
    const { companyId, departmentId } = await seedMarketing(store);
    const agents = await store.listAgentsByDepartment(departmentId);
    const social = agents.find((a) => a.role === "Social Media")!;
    expect(social).toBeTruthy();

    // Pra-isi 5 posting hari ini → mencapai batas rate_limit template (maxPostsPerDay: 5).
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await store.addAuditEntry(
        { companyId, agentId: social.id, action: "schedule_post", detail: { seeded: true } },
        now - i * 1000,
      );
    }

    const engine = new WorkflowEngine({
      store,
      router: new MockRouterClient([publishResponder]),
      skills: skillsWithSocial(),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });

    const { directive, done } = await engine.startForDepartment(departmentId, "Publish lagi", "ui");
    const paused = await done;
    expect(paused.status).toBe("awaiting_approval");

    const resumed = await engine.resumeByApproval(paused.approvalId!, "approve");
    expect(resumed!.status).toBe("blocked");
    expect((await store.getDirective(directive.id))!.status).toBe("blocked");

    const audit = await store.listAuditByCompany(companyId);
    expect(audit.some((a) => a.action === "publish_blocked")).toBe(true);
    // Tidak ada posting NYATA tambahan (hanya 5 pra-isi; tak ada schedule_post baru dari run ini).
    expect(audit.filter((a) => a.action === "schedule_post").length).toBe(5);
  });
});
