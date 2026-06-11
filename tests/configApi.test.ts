import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, ConfigStore } from "@vc/server";
import { MARKETING_TEMPLATE_ID } from "@vc/templates";

describe("REST config API via inject (Phase 1.3–1.7)", () => {
  let app: FastifyInstance;
  let store: ConfigStore;
  const mutated: string[] = [];

  beforeAll(async () => {
    store = new ConfigStore(":memory:");
    app = buildServer({ configStore: store, onMutate: (id) => mutated.push(id) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    store.close();
  });

  it("katalog: templates & skills", async () => {
    const t = await app.inject({ method: "GET", url: "/api/templates" });
    expect(t.statusCode).toBe(200);
    expect(Array.isArray(t.json())).toBe(true);
    const s = await app.inject({ method: "GET", url: "/api/skills" });
    expect(s.statusCode).toBe(200);
    expect((s.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it("alur: company → floor → dept(template) → world → agent → patch → delete", async () => {
    // create company
    const cRes = await app.inject({ method: "POST", url: "/api/companies", payload: { name: "PT Uji" } });
    expect(cRes.statusCode).toBe(201);
    const companyId = (cRes.json() as { id: string }).id;

    // create floor → onMutate dipanggil
    const fRes = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/floors`,
      payload: { name: "Lantai 1" },
    });
    expect(fRes.statusCode).toBe(201);
    const floorId = (fRes.json() as { id: string }).id;
    expect(mutated).toContain(companyId);

    // create department from marketing template
    const dRes = await app.inject({
      method: "POST",
      url: `/api/floors/${floorId}/departments`,
      payload: { templateId: MARKETING_TEMPLATE_ID },
    });
    expect(dRes.statusCode).toBe(201);
    const seeded = dRes.json() as { department: { id: string }; agents: unknown[] };
    expect(seeded.agents).toHaveLength(5);

    // world snapshot
    const wRes = await app.inject({ method: "GET", url: `/api/companies/${companyId}/world` });
    expect(wRes.statusCode).toBe(200);
    const world = wRes.json() as { floors: unknown[]; agents: unknown[] };
    expect(world.floors).toHaveLength(1);
    expect(world.agents).toHaveLength(5);

    // create custom agent
    const aRes = await app.inject({
      method: "POST",
      url: `/api/departments/${seeded.department.id}/agents`,
      payload: { name: "Custom", role: "Helper", deskPos: { x: 9, y: 9 }, skillScope: ["web_search"] },
    });
    expect(aRes.statusCode).toBe(201);
    const agentId = (aRes.json() as { id: string }).id;

    // patch agent
    const pRes = await app.inject({
      method: "PATCH",
      url: `/api/agents/${agentId}`,
      payload: { name: "Custom 2", status: "working" },
    });
    expect(pRes.statusCode).toBe(200);
    expect((pRes.json() as { name: string }).name).toBe("Custom 2");

    // delete agent
    const delRes = await app.inject({ method: "DELETE", url: `/api/agents/${agentId}` });
    expect(delRes.statusCode).toBe(200);

    // placeholder data nyata kosong
    const tasks = await app.inject({ method: "GET", url: `/api/companies/${companyId}/tasks` });
    expect(tasks.json()).toEqual([]);
    const comms = await app.inject({ method: "GET", url: `/api/companies/${companyId}/comms` });
    expect(comms.json()).toEqual([]);
  });

  it("validasi: body kurang → 400; resource tak ada → 404", async () => {
    const badCompany = await app.inject({ method: "POST", url: "/api/companies", payload: {} });
    expect(badCompany.statusCode).toBe(400);

    const noWorld = await app.inject({ method: "GET", url: "/api/companies/co_tidakada/world" });
    expect(noWorld.statusCode).toBe(404);

    const badTemplate = await app.inject({ method: "GET", url: "/api/templates/ngawur" });
    expect(badTemplate.statusCode).toBe(404);
  });
});
