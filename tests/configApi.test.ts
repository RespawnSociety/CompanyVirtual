import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type ConfigStore } from "@vc/server";
import { MARKETING_TEMPLATE_ID } from "@vc/templates";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

describe("REST config API via inject (Phase 1.3–1.7)", () => {
  let app: FastifyInstance;
  let store: ConfigStore;
  const mutated: string[] = [];

  beforeAll(async () => {
    store = await createTestStore();
    app = buildServer({ configStore: store, onMutate: (id) => mutated.push(id) });
    await app.ready();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await app.close();
    await store.close();
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

    // BUG-106: status di luar AgentStatus → 400 & status lama tak berubah.
    const badStatus = await app.inject({
      method: "PATCH",
      url: `/api/agents/${agentId}`,
      payload: { status: "banana" },
    });
    expect(badStatus.statusCode).toBe(400);
    const stillWorking = await app.inject({ method: "GET", url: `/api/departments/${seeded.department.id}/agents` });
    const found = (stillWorking.json() as { id: string; status: string }[]).find((a) => a.id === agentId);
    expect(found?.status).toBe("working");

    // delete agent
    const delRes = await app.inject({ method: "DELETE", url: `/api/agents/${agentId}` });
    expect(delRes.statusCode).toBe(200);

    // data runtime (tasks/comms) masih kosong sampai ada directive.
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

  it("directive tanpa dispatcher → 503 (runtime belum dipasang)", async () => {
    const co = (
      await app.inject({ method: "POST", url: "/api/companies", payload: { name: "NoDispatch" } })
    ).json() as { id: string };
    const fl = (
      await app.inject({ method: "POST", url: `/api/companies/${co.id}/floors`, payload: { name: "L1" } })
    ).json() as { id: string };
    const seeded = (
      await app.inject({
        method: "POST",
        url: `/api/floors/${fl.id}/departments`,
        payload: { templateId: MARKETING_TEMPLATE_ID },
      })
    ).json() as { agents: { id: string }[] };
    const agentId = seeded.agents[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/directives`,
      payload: { text: "halo" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("BUG-115: guardrail rate_limit/posting_hours tanpa params valid → 400 (tak bisa nonaktifkan)", async () => {
    const co = (
      await app.inject({ method: "POST", url: "/api/companies", payload: { name: "Guard Co" } })
    ).json() as { id: string };
    const fl = (
      await app.inject({ method: "POST", url: `/api/companies/${co.id}/floors`, payload: { name: "L1" } })
    ).json() as { id: string };
    const seeded = (
      await app.inject({
        method: "POST",
        url: `/api/floors/${fl.id}/departments`,
        payload: { templateId: MARKETING_TEMPLATE_ID },
      })
    ).json() as { department: { id: string }; agents: { id: string; role: string }[] };
    const social = seeded.agents.find((a) => a.role === "Social Media")!;

    // PATCH yang membuang params rate_limit (bug UI lama) → DITOLAK 400.
    const stripped = await app.inject({
      method: "PATCH",
      url: `/api/agents/${social.id}`,
      payload: { guardrails: [{ rule: "rate_limit" }, { rule: "approval_required_for_external_actions" }] },
    });
    expect(stripped.statusCode).toBe(400);

    // PATCH dgn params lengkap → OK 200, params tersimpan.
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/agents/${social.id}`,
      payload: {
        guardrails: [
          { rule: "rate_limit", params: { maxPostsPerDay: 5 } },
          { rule: "approval_required_for_external_actions" },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);
    const saved = (ok.json() as { guardrails: { rule: string; params?: { maxPostsPerDay?: number } }[] })
      .guardrails.find((g) => g.rule === "rate_limit");
    expect(saved?.params?.maxPostsPerDay).toBe(5);

    // POST agent baru dgn posting_hours tanpa jam valid → 400.
    const badPost = await app.inject({
      method: "POST",
      url: `/api/departments/${seeded.department.id}/agents`,
      payload: { name: "X", role: "Y", guardrails: [{ rule: "posting_hours", params: { from: 8 } }] },
    });
    expect(badPost.statusCode).toBe(400);
  });

  it("CR-102: PATCH bisa mengosongkan commsHandle (agent) & workflowId (department)", async () => {
    const co = (
      await app.inject({ method: "POST", url: "/api/companies", payload: { name: "Clear Co" } })
    ).json() as { id: string };
    const fl = (
      await app.inject({
        method: "POST",
        url: `/api/companies/${co.id}/floors`,
        payload: { name: "L1" },
      })
    ).json() as { id: string };
    const seeded = (
      await app.inject({
        method: "POST",
        url: `/api/floors/${fl.id}/departments`,
        payload: { templateId: MARKETING_TEMPLATE_ID },
      })
    ).json() as { department: { id: string; workflowId?: string } };

    // department dari template punya workflowId → bisa di-clear lewat PATCH workflowId:"".
    expect(seeded.department.workflowId).toBeTruthy();
    const deptCleared = (
      await app.inject({
        method: "PATCH",
        url: `/api/departments/${seeded.department.id}`,
        payload: { workflowId: "" },
      })
    ).json() as { workflowId?: string };
    expect(deptCleared.workflowId).toBeUndefined();

    // agent dgn commsHandle → bisa di-clear lewat PATCH commsHandle:"".
    const ag = (
      await app.inject({
        method: "POST",
        url: `/api/departments/${seeded.department.id}/agents`,
        payload: { name: "Hubungi", role: "CS", commsHandle: "+628111" },
      })
    ).json() as { id: string; commsHandle?: string };
    expect(ag.commsHandle).toBe("+628111");
    const agCleared = (
      await app.inject({
        method: "PATCH",
        url: `/api/agents/${ag.id}`,
        payload: { commsHandle: "" },
      })
    ).json() as { commsHandle?: string };
    expect(agCleared.commsHandle).toBeUndefined();
  });
});

describe("CR-101: bearer auth pada /api/* bila API_AUTH_TOKEN di-set", () => {
  it("tanpa/ salah token → 401; token benar → 200", async () => {
    const store = await createTestStore();
    const app = buildServer({ configStore: store, apiAuthToken: "rahasia" });
    await app.ready();

    const noAuth = await app.inject({ method: "GET", url: "/api/companies" });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "GET",
      url: "/api/companies",
      headers: { authorization: "Bearer salah" },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/api/companies",
      headers: { authorization: "Bearer rahasia" },
    });
    expect(ok.statusCode).toBe(200);

    // /health di luar /api → tetap terbuka.
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    await app.close();
    await store.close();
  });
});
