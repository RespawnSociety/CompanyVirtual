import { describe, it, expect } from "vitest";
import {
  DEPARTMENT_TEMPLATES,
  MARKETING_TEMPLATE,
  MARKETING_TEMPLATE_ID,
  getDepartmentTemplate,
  listDepartmentTemplates,
} from "@vc/templates";

describe("marketing department template (data-driven, Phase 1.6)", () => {
  it("punya 5 role sesuai plan §5", () => {
    const roles = MARKETING_TEMPLATE.roleTemplates.map((r) => r.role);
    expect(roles).toEqual([
      "Manager",
      "Market Checker",
      "Script Maker",
      "Reviewer",
      "Social Media",
    ]);
  });

  it("defaultSkills = union skillScope semua role, tanpa duplikat", () => {
    const union = new Set(MARKETING_TEMPLATE.roleTemplates.flatMap((r) => r.skillScope));
    expect(new Set(MARKETING_TEMPLATE.defaultSkills)).toEqual(union);
    expect(MARKETING_TEMPLATE.defaultSkills.length).toBe(union.size);
    // beberapa skill kunci harus ada
    for (const s of ["message_agent", "market_research", "write_content", "review_content", "ig_post"]) {
      expect(MARKETING_TEMPLATE.defaultSkills).toContain(s);
    }
  });

  it("workflow: review = loop_until_pass, approval = approval_gate, publish = langkah akhir", () => {
    const steps = MARKETING_TEMPLATE.defaultWorkflow.steps;
    const review = steps.find((s) => s.role === "Reviewer");
    const approval = steps.find((s) => s.action === "request_approval");
    const publish = steps.find((s) => s.role === "Social Media");
    expect(review?.next).toBe("loop_until_pass");
    expect(approval?.next).toBe("approval_gate");
    expect(publish?.next).toBeUndefined();
    // tiap step punya id, role, action unik & terisi
    for (const s of steps) {
      expect(s.id).toBeTruthy();
      expect(s.role).toBeTruthy();
      expect(s.action).toBeTruthy();
    }
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("registry: get by id & list", () => {
    expect(getDepartmentTemplate(MARKETING_TEMPLATE_ID)).toBe(MARKETING_TEMPLATE);
    expect(getDepartmentTemplate("tidak-ada")).toBeUndefined();
    expect(listDepartmentTemplates()).toBe(DEPARTMENT_TEMPLATES);
    expect(DEPARTMENT_TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });
});
