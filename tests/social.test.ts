/**
 * Phase 4.2 — Skill sosial (ig_post/twitter_post/schedule_post) dengan provider MOCK/dry-run.
 * Membuktikan: konten wajib, platform allowlist, schedule parsing, hasil dry-run, dan AUDIT
 * dipanggil dengan PREVIEW (bukan secret).
 */

import { describe, it, expect } from "vitest";
import type { AuditDraft, SkillContext } from "@vc/shared";
import {
  createIgPostSkill,
  createTwitterPostSkill,
  createSchedulePostSkill,
  mockPostPublisher,
  MockRouterClient,
  textResponse,
} from "@vc/agent-runtime";

function makeCtx(): { ctx: SkillContext; audits: AuditDraft[] } {
  const audits: AuditDraft[] = [];
  const ctx: SkillContext = {
    agentId: "ag-1",
    router: new MockRouterClient([textResponse("x")]),
    vault: { get: () => Promise.resolve(undefined), has: () => Promise.resolve(false) },
    emit: () => {},
    requestApproval: () =>
      Promise.resolve({ id: "appr", summary: "", artifactId: "", channel: "whatsapp", status: "approved" }),
    audit: (e) => {
      audits.push(e);
      return Promise.resolve();
    },
  };
  return { ctx, audits };
}

describe("Phase 4.2 — skill sosial (mock publisher)", () => {
  const pub = mockPostPublisher();

  it("ig_post: dry-run sukses + audit berisi preview & platform instagram", async () => {
    const skill = createIgPostSkill(pub);
    expect(skill.risky).toBe(true);
    const { ctx, audits } = makeCtx();
    const res = await skill.handler({ content: "Promo diskon 30%!" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.platform).toBe("instagram");
    expect(res.dryRun).toBe(true);
    expect(res.postId).toMatch(/^mock-instagram-/);
    expect(res.url).toContain("dry-run.local");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("ig_post");
    expect(String(audits[0]!.detail?.["preview"])).toContain("Promo diskon 30%!");
    expect(audits[0]!.detail?.["dryRun"]).toBe(true);
  });

  it("twitter_post: platform twitter", async () => {
    const { ctx } = makeCtx();
    const res = await createTwitterPostSkill(pub).handler({ content: "Halo dunia" }, ctx);
    expect(res.platform).toBe("twitter");
    expect(res.dryRun).toBe(true);
  });

  it("content kosong → error", async () => {
    const { ctx } = makeCtx();
    await expect(createIgPostSkill(pub).handler({ content: "  " }, ctx)).rejects.toThrow(/content/);
  });

  it("schedule_post: parse scheduleAt (ISO) → scheduledFor, platform 'x' → twitter", async () => {
    const { ctx, audits } = makeCtx();
    const when = "2026-07-01T10:00:00.000Z";
    const res = await createSchedulePostSkill(pub).handler(
      { content: "Jadwalkan ini", platform: "x", scheduleAt: when },
      ctx,
    );
    expect(res.platform).toBe("twitter");
    expect(res.scheduledFor).toBe(Date.parse(when));
    expect(audits[0]!.detail?.["scheduledFor"]).toBe(Date.parse(when));
  });

  it("schedule_post: scheduleAt invalid → error; tanpa scheduleAt → error (wajib)", async () => {
    const { ctx } = makeCtx();
    await expect(
      createSchedulePostSkill(pub).handler({ content: "x", scheduleAt: "bukan-tanggal" }, ctx),
    ).rejects.toThrow(/scheduleAt/);
    await expect(createSchedulePostSkill(pub).handler({ content: "x" }, ctx)).rejects.toThrow(
      /scheduleAt/,
    );
  });
});
