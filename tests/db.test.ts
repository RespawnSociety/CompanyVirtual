import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { ConfigStore } from "@vc/server";

describe("ConfigStore (SQLite, Phase 1.2)", () => {
  it("CRUD company/floor/department/agent + relasi turunan", () => {
    const store = new ConfigStore(":memory:");
    const company = store.createCompany({ name: "PT Maju Jaya", branding: { primaryColor: "#fff" } });
    expect(company.id).toMatch(/^co_/);
    expect(company.floorIds).toEqual([]);
    expect(company.branding).toEqual({ primaryColor: "#fff" });

    const f0 = store.createFloor(company.id, { name: "Lantai 1" });
    const f1 = store.createFloor(company.id, { name: "Lantai 2" });
    expect(f0.index).toBe(0);
    expect(f1.index).toBe(1);
    expect(store.getCompany(company.id)!.floorIds).toEqual([f0.id, f1.id]);

    const dept = store.createDepartment(company.id, f0.id, {
      name: "Pemasaran",
      purpose: "iklan",
      skillPool: ["web_search", "write_content"],
    });
    expect(store.getFloor(f0.id)!.departmentIds).toEqual([dept.id]);
    expect(dept.skillPool).toEqual(["web_search", "write_content"]);

    const agent = store.createAgent(dept.id, {
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
    expect(store.getDepartment(dept.id)!.agentIds).toEqual([agent.id]);

    // update
    const updated = store.updateAgent(agent.id, { name: "Andi B", status: "working" });
    expect(updated!.name).toBe("Andi B");
    expect(updated!.status).toBe("working");
    expect(updated!.deskPos).toEqual({ x: 3, y: 4 }); // tak berubah

    // world snapshot
    const snap = store.getWorldSnapshot(company.id)!;
    expect(snap.company.id).toBe(company.id);
    expect(snap.floors).toHaveLength(2);
    expect(snap.departments).toHaveLength(1);
    expect(snap.agents).toHaveLength(1);

    // delete agent → hilang dari relasi
    expect(store.deleteAgent(agent.id)).toBe(true);
    expect(store.getDepartment(dept.id)!.agentIds).toEqual([]);
    store.close();
  });

  it("cascade delete: hapus company → floor/dept/agent ikut terhapus", () => {
    const store = new ConfigStore(":memory:");
    const c = store.createCompany({ name: "X" });
    const f = store.createFloor(c.id, { name: "L1" });
    const d = store.createDepartment(c.id, f.id, { name: "D", purpose: "p" });
    const a = store.createAgent(d.id, {
      name: "A", role: "R", deskPos: { x: 1, y: 1 }, spriteKey: "default",
      description: "", skillScope: [], guardrails: [],
    });
    expect(store.deleteCompany(c.id)).toBe(true);
    expect(store.getFloor(f.id)).toBeUndefined();
    expect(store.getDepartment(d.id)).toBeUndefined();
    expect(store.getAgent(a.id)).toBeUndefined();
    store.close();
  });

  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* abaikan */
      }
    }
  });

  it("persistensi: tutup & buka ulang file DB → data tetap ada (DoD: ter-load ulang)", () => {
    const file = join(tmpdir(), `vc-test-${randomUUID()}.db`);
    tmpFiles.push(file);

    const s1 = new ConfigStore(file);
    const c = s1.createCompany({ name: "Persisted Co" });
    const f = s1.createFloor(c.id, { name: "L1" });
    const d = s1.createDepartment(c.id, f.id, { name: "Pemasaran", purpose: "iklan" });
    s1.createAgent(d.id, {
      name: "Budi", role: "Manager", deskPos: { x: 3, y: 4 }, spriteKey: "manager",
      description: "x", skillScope: ["web_search"], guardrails: [],
    });
    s1.close();

    const s2 = new ConfigStore(file);
    const got = s2.getCompany(c.id);
    expect(got?.name).toBe("Persisted Co");
    const snap = s2.getWorldSnapshot(c.id)!;
    expect(snap.floors).toHaveLength(1);
    expect(snap.departments).toHaveLength(1);
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0]!.name).toBe("Budi");
    s2.close();
  });
});
