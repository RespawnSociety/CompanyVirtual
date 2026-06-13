/**
 * Phase 5.1 — Template Sales (departemen #2) + skill `send_outreach`.
 * Membuktikan: template ke-2 terdaftar & berbentuk benar (engine generik), dan skill outreach
 * (risky, mock/dry-run) memvalidasi input, mengembalikan dry-run, dan meng-audit (sukses & gagal).
 */

import { describe, it, expect } from "vitest";
import type { AuditDraft, SkillContext } from "@vc/shared";
import {
  createSendOutreachSkill,
  mockOutreachSender,
  type OutreachSender,
} from "@vc/agent-runtime";
import {
  DEPARTMENT_TEMPLATES,
  SALES_TEMPLATE,
  SALES_TEMPLATE_ID,
  getDepartmentTemplate,
} from "@vc/templates";

function makeCtx(): { ctx: SkillContext; audits: AuditDraft[] } {
  const audits: AuditDraft[] = [];
  const ctx: SkillContext = {
    agentId: "ag-sales",
    router: { chat: () => Promise.reject(new Error("router tak dipakai")) },
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

describe("Phase 5.1 — Sales department template (data-driven)", () => {
  it("terdaftar di DEPARTMENT_TEMPLATES + bisa diambil by id", () => {
    expect(getDepartmentTemplate(SALES_TEMPLATE_ID)).toBe(SALES_TEMPLATE);
    expect(DEPARTMENT_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    expect(DEPARTMENT_TEMPLATES.map((t) => t.id)).toContain(SALES_TEMPLATE_ID);
  });

  it("punya 5 role + alur berbeda (aksi akhir = send_outreach, bukan publish sosmed)", () => {
    const roles = SALES_TEMPLATE.roleTemplates.map((r) => r.role);
    expect(roles).toEqual([
      "Sales Manager",
      "Lead Researcher",
      "Proposal Writer",
      "Sales Reviewer",
      "Outreach Rep",
    ]);
    const steps = SALES_TEMPLATE.defaultWorkflow.steps;
    expect(steps.find((s) => s.role === "Sales Reviewer")?.next).toBe("loop_until_pass");
    expect(steps.find((s) => s.action === "request_approval")?.next).toBe("approval_gate");
    const last = steps[steps.length - 1]!;
    expect(last.action).toBe("send_outreach");
    expect(last.next).toBeUndefined();
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("defaultSkills = union skillScope; Outreach Rep punya guardrail rate_limit + approval", () => {
    const union = new Set(SALES_TEMPLATE.roleTemplates.flatMap((r) => r.skillScope));
    expect(new Set(SALES_TEMPLATE.defaultSkills)).toEqual(union);
    expect(SALES_TEMPLATE.defaultSkills).toContain("send_outreach");
    const rep = SALES_TEMPLATE.roleTemplates.find((r) => r.role === "Outreach Rep")!;
    expect(rep.guardrails.map((g) => g.rule)).toContain("approval_required_for_external_actions");
    const rate = rep.guardrails.find((g) => g.rule === "rate_limit");
    expect(rate?.params?.["maxPostsPerDay"]).toBe(20);
  });
});

describe("Phase 5.1 — skill send_outreach (mock sender)", () => {
  const sender = mockOutreachSender();

  it("risky + dry-run sukses + audit berisi preview (bukan secret)", async () => {
    const skill = createSendOutreachSkill(sender);
    expect(skill.risky).toBe(true);
    const { ctx, audits } = makeCtx();
    const res = await skill.handler(
      { channel: "email", recipient: "calon@contoh.com", subject: "Penawaran", message: "Halo, ada penawaran." },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.channel).toBe("email");
    expect(res.dryRun).toBe(true);
    expect(res.messageId).toMatch(/^mock-email-/);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("send_outreach");
    expect(String(audits[0]!.detail?.["preview"])).toContain("calon@contoh.com");
    expect(String(audits[0]!.detail?.["preview"])).toContain("Halo, ada penawaran.");
  });

  it("message/recipient kosong → error", async () => {
    const skill = createSendOutreachSkill(sender);
    const { ctx } = makeCtx();
    await expect(skill.handler({ recipient: "x@y.com", message: "  " }, ctx)).rejects.toThrow(/message/);
    await expect(skill.handler({ recipient: "  ", message: "hai" }, ctx)).rejects.toThrow(/recipient/);
  });

  it("channel: 'wa' → whatsapp; kosong → email; tak dikenal → error (BUG-116)", async () => {
    const skill = createSendOutreachSkill(sender);
    const { ctx } = makeCtx();
    const wa = await skill.handler({ channel: "wa", recipient: "628123", message: "hai" }, ctx);
    expect(wa.channel).toBe("whatsapp");
    const def = await skill.handler({ recipient: "x@y.com", message: "hai" }, ctx); // tanpa channel → email
    expect(def.channel).toBe("email");
    // BUG-116: channel tak dikenal TIDAK boleh diam-diam jadi email → ditolak.
    await expect(
      skill.handler({ channel: "merpati-pos", recipient: "x@y.com", message: "hai" }, ctx),
    ).rejects.toThrow(/tidak diizinkan/);
  });

  it("BUG-114 pattern: sender GAGAL → audit *_failed lalu rethrow", async () => {
    const failing: OutreachSender = { send: () => Promise.reject(new Error("SMTP down")) };
    const skill = createSendOutreachSkill(failing);
    const { ctx, audits } = makeCtx();
    await expect(
      skill.handler({ channel: "email", recipient: "x@y.com", message: "hai" }, ctx),
    ).rejects.toThrow(/SMTP down/);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("send_outreach_failed");
    expect(String(audits[0]!.detail?.["reason"])).toContain("SMTP down");
  });

  it("BUG-117: provider ok:false (tanpa throw) → audit *_failed + throw (bukan sukses palsu)", async () => {
    const softFail: OutreachSender = {
      send: () => Promise.resolve({ ok: false, channel: "email", dryRun: false, note: "ditolak provider" }),
    };
    const skill = createSendOutreachSkill(softFail);
    const { ctx, audits } = makeCtx();
    await expect(
      skill.handler({ channel: "email", recipient: "x@y.com", message: "hai" }, ctx),
    ).rejects.toThrow();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("send_outreach_failed");
  });
});
