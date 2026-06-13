import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { ConfigStore } from "@vc/server";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

describe("ConfigStore (MySQL, Phase 1.2 + 2)", () => {
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

  it("CRUD company/floor/department/agent + relasi turunan", async () => {
    const company = await store.createCompany({ name: "PT Maju Jaya", branding: { primaryColor: "#fff" } });
    expect(company.id).toMatch(/^co_/);
    expect(company.floorIds).toEqual([]);
    expect(company.branding).toEqual({ primaryColor: "#fff" });

    const f0 = await store.createFloor(company.id, { name: "Lantai 1" });
    const f1 = await store.createFloor(company.id, { name: "Lantai 2" });
    expect(f0.index).toBe(0);
    expect(f1.index).toBe(1);
    expect((await store.getCompany(company.id))!.floorIds).toEqual([f0.id, f1.id]);

    const dept = await store.createDepartment(company.id, f0.id, {
      name: "Pemasaran",
      purpose: "iklan",
      skillPool: ["web_search", "write_content"],
    });
    expect((await store.getFloor(f0.id))!.departmentIds).toEqual([dept.id]);
    expect(dept.skillPool).toEqual(["web_search", "write_content"]);

    const agent = await store.createAgent(dept.id, {
      name: "Andi",
      role: "Manager",
      deskPos: { x: 3, y: 4 },
      spriteKey: "manager",
      description: "manajer",
      skillScope: ["web_search"],
      guardrails: [{ rule: "propose_only" }],
    });
    expect(agent.id).toMatch(/^ag_/);
    expect(agent.memoryNamespace).toBe(`agent:${agent.id}`);
    expect(agent.status).toBe("idle");
    expect((await store.getDepartment(dept.id))!.agentIds).toEqual([agent.id]);

    // update
    const updated = await store.updateAgent(agent.id, { name: "Andi B", status: "working" });
    expect(updated!.name).toBe("Andi B");
    expect(updated!.status).toBe("working");
    expect(updated!.deskPos).toEqual({ x: 3, y: 4 }); // tak berubah

    // world snapshot
    const snap = (await store.getWorldSnapshot(company.id))!;
    expect(snap.company.id).toBe(company.id);
    expect(snap.floors).toHaveLength(2);
    expect(snap.departments).toHaveLength(1);
    expect(snap.agents).toHaveLength(1);

    // delete agent → hilang dari relasi
    expect(await store.deleteAgent(agent.id)).toBe(true);
    expect((await store.getDepartment(dept.id))!.agentIds).toEqual([]);
  });

  it("cascade delete: hapus company → floor/dept/agent ikut terhapus", async () => {
    const c = await store.createCompany({ name: "X" });
    const f = await store.createFloor(c.id, { name: "L1" });
    const d = await store.createDepartment(c.id, f.id, { name: "D", purpose: "p" });
    const a = await store.createAgent(d.id, {
      name: "A", role: "R", deskPos: { x: 1, y: 1 }, spriteKey: "default",
      description: "", skillScope: [], guardrails: [],
    });
    expect(await store.deleteCompany(c.id)).toBe(true);
    expect(await store.getFloor(f.id)).toBeUndefined();
    expect(await store.getDepartment(d.id)).toBeUndefined();
    expect(await store.getAgent(a.id)).toBeUndefined();
  });

  it("persistensi: store baru terhadap DB sama → data tetap ada (DoD: ter-load ulang)", async () => {
    const c = await store.createCompany({ name: "Persisted Co" });
    const f = await store.createFloor(c.id, { name: "L1" });
    const d = await store.createDepartment(c.id, f.id, { name: "Pemasaran", purpose: "iklan" });
    await store.createAgent(d.id, {
      name: "Budi", role: "Manager", deskPos: { x: 3, y: 4 }, spriteKey: "manager",
      description: "x", skillScope: ["web_search"], guardrails: [],
    });

    // Koneksi/instance store baru ke database yang sama → data persisten di MySQL.
    const s2 = await createTestStore();
    try {
      const got = await s2.getCompany(c.id);
      expect(got?.name).toBe("Persisted Co");
      const snap = (await s2.getWorldSnapshot(c.id))!;
      expect(snap.floors).toHaveLength(1);
      expect(snap.departments).toHaveLength(1);
      expect(snap.agents).toHaveLength(1);
      expect(snap.agents[0]!.name).toBe("Budi");
    } finally {
      await s2.close();
    }
  });

  it("Phase 2: directive → task → artifact tersimpan & ter-scope per company", async () => {
    const c = await store.createCompany({ name: "Runtime Co" });
    const f = await store.createFloor(c.id, { name: "L1" });
    const d = await store.createDepartment(c.id, f.id, { name: "Mkt", purpose: "p" });
    const a = await store.createAgent(d.id, {
      name: "Penulis", role: "Script Maker", deskPos: { x: 2, y: 2 }, spriteKey: "default",
      description: "", skillScope: ["write_content"], guardrails: [],
    });

    const dir = await store.createDirective(c.id, { text: "buat caption", source: "ui", departmentId: d.id });
    expect(dir.id).toMatch(/^dir_/);
    expect(dir.status).toBe("received");

    const task = await store.createTask({
      companyId: c.id, directiveId: dir.id, departmentId: d.id,
      title: "buat caption", assignee: a.id, status: "in_progress",
    });
    expect(task.status).toBe("in_progress");
    expect(await store.listTasksByCompany(c.id)).toHaveLength(1);

    const art = await store.addArtifact({ taskId: task.id, kind: "content", content: "Halo dunia!" });
    const doneTask = await store.updateTask(task.id, { status: "done", outputRef: art.id });
    expect(doneTask!.status).toBe("done");
    expect(doneTask!.outputRef).toBe(art.id);

    expect(await store.listArtifactsByCompany(c.id)).toHaveLength(1);
    expect((await store.listArtifactsByTask(task.id))[0]!.content).toBe("Halo dunia!");

    const doneDir = await store.updateDirectiveStatus(dir.id, "done");
    expect(doneDir!.status).toBe("done");
    expect(await store.listDirectivesByCompany(c.id)).toHaveLength(1);

    // cascade: hapus company → directive/task/artifact ikut hilang
    await store.deleteCompany(c.id);
    expect(await store.getTask(task.id)).toBeUndefined();
    expect(await store.getArtifact(art.id)).toBeUndefined();
    expect(await store.getDirective(dir.id)).toBeUndefined();
  });
});
