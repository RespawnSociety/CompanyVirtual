import { describe, it, expect } from "vitest";
import type { WorkflowDef } from "@vc/shared";
import { ConfigStore, seedDepartmentFromTemplate, cloneWorkflowDef } from "@vc/server";
import { MARKETING_TEMPLATE, MARKETING_TEMPLATE_ID } from "@vc/templates";

describe("seedDepartmentFromTemplate (Phase 1.6 — engine generik)", () => {
  it("seed Marketing → department + workflow (cloned) + 1 agent per role", () => {
    const store = new ConfigStore(":memory:");
    const c = store.createCompany({ name: "Co" });
    const f = store.createFloor(c.id, { name: "L1" });

    const seeded = seedDepartmentFromTemplate(store, {
      companyId: c.id,
      floorId: f.id,
      template: MARKETING_TEMPLATE,
    });

    expect(seeded.department.templateId).toBe(MARKETING_TEMPLATE_ID);
    expect(seeded.department.skillPool).toEqual(MARKETING_TEMPLATE.defaultSkills);
    expect(seeded.agents).toHaveLength(MARKETING_TEMPLATE.roleTemplates.length);
    expect(seeded.agents.map((a) => a.role)).toEqual(
      MARKETING_TEMPLATE.roleTemplates.map((r) => r.role),
    );

    // workflow di-clone (id baru, bukan id template) & tersimpan, dirujuk department.
    expect(seeded.workflow.id).not.toBe(MARKETING_TEMPLATE.defaultWorkflow.id);
    expect(seeded.department.workflowId).toBe(seeded.workflow.id);
    expect(store.getWorkflow(seeded.workflow.id)).toBeTruthy();

    // tersimpan di DB & muncul di snapshot, urutan DETERMINISTIK sesuai urutan role template
    const snap = store.getWorldSnapshot(c.id)!;
    expect(snap.agents).toHaveLength(MARKETING_TEMPLATE.roleTemplates.length);
    expect(snap.agents.map((a) => a.role)).toEqual(
      MARKETING_TEMPLATE.roleTemplates.map((r) => r.role),
    );
    store.close();
  });

  it("dua seed dari template sama → workflow id berbeda (tak bentrok)", () => {
    const store = new ConfigStore(":memory:");
    const c = store.createCompany({ name: "Co" });
    const f = store.createFloor(c.id, { name: "L1" });
    const a = seedDepartmentFromTemplate(store, { companyId: c.id, floorId: f.id, template: MARKETING_TEMPLATE });
    const b = seedDepartmentFromTemplate(store, { companyId: c.id, floorId: f.id, template: MARKETING_TEMPLATE });
    expect(a.workflow.id).not.toBe(b.workflow.id);
    // meja tidak menumpuk: baris berbeda (deptIndexOnFloor naik → y berbeda)
    expect(a.agents[0]!.deskPos.y).not.toBe(b.agents[0]!.deskPos.y);
    store.close();
  });

  it("cloneWorkflowDef: id step baru & referensi next antar-step di-remap, token dipertahankan", () => {
    let n = 0;
    const gen = (): string => `x${n++}`;
    const def: WorkflowDef = {
      id: "wf-orig",
      name: "t",
      steps: [
        { id: "s1", role: "A", action: "a", next: "s2" },
        { id: "s2", role: "B", action: "b", next: "loop_until_pass" },
      ],
    };
    const cloned = cloneWorkflowDef(def, gen);
    expect(cloned.id).not.toBe("wf-orig");
    expect(cloned.steps[0]!.id).not.toBe("s1");
    // next "s2" di-remap ke id baru step kedua
    expect(cloned.steps[0]!.next).toBe(cloned.steps[1]!.id);
    // token khusus tidak diubah
    expect(cloned.steps[1]!.next).toBe("loop_until_pass");
  });
});
