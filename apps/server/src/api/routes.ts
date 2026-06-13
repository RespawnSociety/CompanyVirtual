/**
 * REST API Configuration layer (plan §4) + runtime directive (Phase 2). FACE (web) memanggil
 * ini untuk CRUD Company/Floor/Department/Agent, listing template & skill, dan mengirim arahan.
 *
 * Setelah mutasi yang mengubah world sebuah company, handler memanggil `opts.onMutate(companyId)`
 * agar RealtimeHub mem-broadcast snapshot terbaru (decoupling: routes tak tahu socket.io).
 *
 * Store ber-API async (MySQL) → seluruh handler async/await.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { AgentStatus, Guardrail, Id, ModelPolicy, Vec2 } from "@vc/shared";
import {
  getDepartmentTemplate,
  listDepartmentTemplates,
} from "@vc/templates";
import type { ConfigStore, NewAgent } from "../db/store.js";
import { seedDepartmentFromTemplate } from "../config/seed.js";
import { KNOWN_SKILLS } from "../config/skills.js";
import type { DirectiveDispatcher } from "../registry/dispatcher.js";
import type { WorkflowEngine } from "../workflow/engine.js";

export interface ConfigRoutesOptions {
  /** Dipanggil dengan companyId terdampak setelah mutasi sukses (untuk broadcast realtime). */
  onMutate?: (companyId: Id) => void;
  /** Dispatcher directive → task → agent (Phase 2). Bila absent, endpoint directive 503. */
  dispatcher?: DirectiveDispatcher;
  /** Workflow engine (Phase 3). Bila absent, endpoint directive departemen + approval 503. */
  workflowEngine?: WorkflowEngine;
}

function bad(reply: FastifyReply, msg: string): FastifyReply {
  return reply.code(400).send({ error: msg });
}
function notFound(reply: FastifyReply, msg: string): FastifyReply {
  return reply.code(404).send({ error: msg });
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function asStrArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}
function asVec2(v: unknown): Vec2 | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o["x"] !== "number" || typeof o["y"] !== "number") return undefined;
  return { x: o["x"], y: o["y"] };
}
/** BUG-106: hanya terima nilai dalam union AgentStatus (`@vc/shared`); selain itu undefined. */
const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "talking", "blocked"];
function asAgentStatus(v: unknown): AgentStatus | undefined {
  return typeof v === "string" && (AGENT_STATUSES as readonly string[]).includes(v)
    ? (v as AgentStatus)
    : undefined;
}

/**
 * BUG-115: rule guardrail berparameter WAJIB punya params valid — cegah `rate_limit`/`posting_hours`
 * nonaktif diam-diam (mis. UI lama yang membuang `params`). Kembalikan pesan error atau undefined.
 */
function guardrailParamError(guardrails: unknown): string | undefined {
  if (!Array.isArray(guardrails)) return undefined;
  const isHour = (x: unknown): boolean =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 23;
  for (const g of guardrails) {
    if (typeof g !== "object" || g === null) return "Setiap guardrail harus objek { rule, params? }.";
    const rule = (g as Record<string, unknown>)["rule"];
    if (typeof rule !== "string" || rule.trim() === "") return "Guardrail 'rule' wajib string non-kosong.";
    const params = (g as Record<string, unknown>)["params"] as Record<string, unknown> | undefined;
    if (rule === "rate_limit") {
      const v = params?.["maxPostsPerDay"];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return "Guardrail 'rate_limit' wajib params.maxPostsPerDay (number ≥ 0).";
      }
    }
    if (rule === "posting_hours" && !(isHour(params?.["from"]) && isHour(params?.["to"]))) {
      return "Guardrail 'posting_hours' wajib params.from & params.to (jam 0..23).";
    }
  }
  return undefined;
}

export function registerConfigRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  opts: ConfigRoutesOptions = {},
): void {
  const notify = (companyId: Id | undefined): void => {
    if (companyId) opts.onMutate?.(companyId);
  };

  // ---------------- Templates & skills (read-only katalog) ----------------

  app.get("/api/templates", () => listDepartmentTemplates());
  app.get("/api/templates/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const tmpl = getDepartmentTemplate(id);
    return tmpl ?? notFound(reply, `Template tidak ditemukan: ${id}`);
  });
  app.get("/api/skills", () => KNOWN_SKILLS);

  // ---------------- Company ----------------

  app.get("/api/companies", () => store.listCompanies());

  app.post("/api/companies", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    if (!name) return bad(reply, "Field 'name' wajib diisi.");
    const branding =
      typeof body["branding"] === "object" && body["branding"] !== null
        ? (body["branding"] as Record<string, unknown>)
        : undefined;
    const company = await store.createCompany(branding ? { name, branding } : { name });
    return reply.code(201).send(company);
  });

  app.get("/api/companies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const company = await store.getCompany(id);
    return company ?? notFound(reply, `Company tidak ditemukan: ${id}`);
  });

  app.delete("/api/companies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await store.deleteCompany(id);
    if (!deleted) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return reply.send({ deleted: true });
  });

  app.get("/api/companies/:id/world", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = await store.getWorldSnapshot(id);
    return snap ?? notFound(reply, `Company tidak ditemukan: ${id}`);
  });

  app.get("/api/companies/:id/tasks", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listTasksByCompany(id);
  });

  app.get("/api/companies/:id/artifacts", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listArtifactsByCompany(id);
  });

  app.get("/api/companies/:id/directives", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listDirectivesByCompany(id);
  });

  app.get("/api/companies/:id/comms", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listCommsByCompany(id);
  });

  // Audit log (Phase 4.3) — jejak aksi & approval per company (observability/keamanan).
  app.get("/api/companies/:id/audit", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listAuditByCompany(id);
  });

  // ---------------- Floor ----------------

  app.get("/api/companies/:companyId/floors", async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!(await store.getCompany(companyId))) return notFound(reply, `Company tidak ditemukan: ${companyId}`);
    return store.listFloors(companyId);
  });

  app.post("/api/companies/:companyId/floors", async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!(await store.getCompany(companyId))) return notFound(reply, `Company tidak ditemukan: ${companyId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    if (!name) return bad(reply, "Field 'name' wajib diisi.");
    const mapKey = asStr(body["mapKey"]);
    const floor = await store.createFloor(companyId, mapKey ? { name, mapKey } : { name });
    notify(companyId);
    return reply.code(201).send(floor);
  });

  app.delete("/api/floors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const floor = await store.getFloor(id);
    if (!floor) return notFound(reply, `Floor tidak ditemukan: ${id}`);
    await store.deleteFloor(id);
    notify(floor.companyId);
    return reply.send({ deleted: true });
  });

  // ---------------- Department ----------------

  app.get("/api/floors/:floorId/departments", async (req, reply) => {
    const { floorId } = req.params as { floorId: string };
    if (!(await store.getFloor(floorId))) return notFound(reply, `Floor tidak ditemukan: ${floorId}`);
    return store.listDepartmentsByFloor(floorId);
  });

  // Buat departemen: dari template (templateId) ATAU custom (name+purpose).
  app.post("/api/floors/:floorId/departments", async (req, reply) => {
    const { floorId } = req.params as { floorId: string };
    const floor = await store.getFloor(floorId);
    if (!floor) return notFound(reply, `Floor tidak ditemukan: ${floorId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const templateId = asStr(body["templateId"]);
    const name = asStr(body["name"]);
    const purpose = asStr(body["purpose"]);

    if (templateId) {
      const template = getDepartmentTemplate(templateId);
      if (!template) return bad(reply, `Template tidak dikenal: ${templateId}`);
      const seeded = await seedDepartmentFromTemplate(store, {
        companyId: floor.companyId,
        floorId,
        template,
        ...(name ? { name } : {}),
        ...(purpose ? { purpose } : {}),
      });
      notify(floor.companyId);
      return reply.code(201).send(seeded);
    }

    // Custom (tanpa template).
    if (!name || !purpose) {
      return bad(reply, "Departemen custom butuh 'name' dan 'purpose' (atau beri 'templateId').");
    }
    const skillPool = asStrArray(body["skillPool"]) ?? [];
    const workflowId = asStr(body["workflowId"]);
    const department = await store.createDepartment(floor.companyId, floorId, {
      name,
      purpose,
      skillPool,
      ...(workflowId ? { workflowId } : {}),
    });
    notify(floor.companyId);
    return reply.code(201).send({ department, agents: [], workflow: null });
  });

  app.get("/api/departments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = await store.getDepartment(id);
    return dept ?? notFound(reply, `Department tidak ditemukan: ${id}`);
  });

  app.patch("/api/departments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await store.getDepartment(id);
    if (!cur) return notFound(reply, `Department tidak ditemukan: ${id}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<ConfigStore["updateDepartment"]>[1] = {};
    const name = asStr(body["name"]);
    if (name) patch.name = name;
    const purpose = asStr(body["purpose"]);
    if (purpose) patch.purpose = purpose;
    const skillPool = asStrArray(body["skillPool"]);
    if (skillPool) patch.skillPool = skillPool;
    // CR-102: workflowId opsional & bisa dikosongkan — kirim apa adanya bila key hadir
    // (string kosong → store meng-clear jadi null); absent → tak diubah.
    if ("workflowId" in body) patch.workflowId = asStr(body["workflowId"]) ?? "";
    const updated = await store.updateDepartment(id, patch);
    notify(cur.companyId);
    return updated;
  });

  app.delete("/api/departments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = await store.getDepartment(id);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${id}`);
    await store.deleteDepartment(id);
    notify(dept.companyId);
    return reply.send({ deleted: true });
  });

  app.get("/api/departments/:id/workflow", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = await store.getDepartment(id);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${id}`);
    if (!dept.workflowId) return reply.send(null);
    return (await store.getWorkflow(dept.workflowId)) ?? null;
  });

  // ---------------- Agent (AgentProfile) ----------------

  app.get("/api/departments/:departmentId/agents", async (req, reply) => {
    const { departmentId } = req.params as { departmentId: string };
    if (!(await store.getDepartment(departmentId))) {
      return notFound(reply, `Department tidak ditemukan: ${departmentId}`);
    }
    return store.listAgentsByDepartment(departmentId);
  });

  app.post("/api/departments/:departmentId/agents", async (req, reply) => {
    const { departmentId } = req.params as { departmentId: string };
    const dept = await store.getDepartment(departmentId);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${departmentId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    const role = asStr(body["role"]);
    if (!name || !role) return bad(reply, "Agent butuh 'name' dan 'role'.");
    const gErr = guardrailParamError(body["guardrails"]);
    if (gErr) return bad(reply, gErr);
    const commsHandle = asStr(body["commsHandle"]);
    const input: NewAgent = {
      name,
      role,
      deskPos: asVec2(body["deskPos"]) ?? { x: 0, y: 0 },
      spriteKey: asStr(body["spriteKey"]) ?? "default",
      description: asStr(body["description"]) ?? "",
      skillScope: asStrArray(body["skillScope"]) ?? [],
      guardrails: Array.isArray(body["guardrails"]) ? (body["guardrails"] as Guardrail[]) : [],
      ...(commsHandle ? { commsHandle } : {}),
      ...(typeof body["modelPolicy"] === "object" && body["modelPolicy"] !== null
        ? { modelPolicy: body["modelPolicy"] as ModelPolicy }
        : {}),
    };
    const agent = await store.createAgent(departmentId, input);
    notify(dept.companyId);
    return reply.code(201).send(agent);
  });

  app.patch("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await store.getAgent(id);
    if (!cur) return notFound(reply, `Agent tidak ditemukan: ${id}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<NewAgent> = {};
    const name = asStr(body["name"]);
    if (name) patch.name = name;
    const role = asStr(body["role"]);
    if (role) patch.role = role;
    const deskPos = asVec2(body["deskPos"]);
    if (deskPos) patch.deskPos = deskPos;
    const spriteKey = asStr(body["spriteKey"]);
    if (spriteKey) patch.spriteKey = spriteKey;
    if (typeof body["description"] === "string") patch.description = body["description"];
    const skillScope = asStrArray(body["skillScope"]);
    if (skillScope) patch.skillScope = skillScope;
    if ("guardrails" in body) {
      const gErr = guardrailParamError(body["guardrails"]);
      if (gErr) return bad(reply, gErr);
      if (Array.isArray(body["guardrails"])) patch.guardrails = body["guardrails"] as Guardrail[];
    }
    // CR-102: commsHandle opsional & bisa dikosongkan — key hadir (mis. "") → clear; absent → tetap.
    if ("commsHandle" in body) patch.commsHandle = asStr(body["commsHandle"]) ?? "";
    if (typeof body["modelPolicy"] === "object" && body["modelPolicy"] !== null) {
      patch.modelPolicy = body["modelPolicy"] as ModelPolicy;
    }
    // BUG-106: validasi enum — key hadir tapi nilai di luar AgentStatus → 400 (jangan simpan).
    if ("status" in body) {
      const status = asAgentStatus(body["status"]);
      if (!status) return bad(reply, "Field 'status' harus salah satu: idle|working|talking|blocked.");
      patch.status = status;
    }
    const updated = await store.updateAgent(id, patch);
    const dept = await store.getDepartment(cur.departmentId);
    notify(dept?.companyId);
    return updated;
  });

  app.delete("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await store.getAgent(id);
    if (!agent) return notFound(reply, `Agent tidak ditemukan: ${id}`);
    const dept = await store.getDepartment(agent.departmentId);
    await store.deleteAgent(id);
    notify(dept?.companyId);
    return reply.send({ deleted: true });
  });

  // ---------------- Directive → Task → Agent (Phase 2.3) ----------------

  // Kirim arahan ke SATU agent (karakter). Buat Directive + Task, dispatch ke agent loop
  // (latar belakang: emit agent:event utk animasi, simpan Artifact saat selesai). Balas 202
  // dengan directive+task agar UI bisa langsung menampilkan & menganimasikan.
  app.post("/api/agents/:agentId/directives", async (req, reply) => {
    if (!opts.dispatcher) {
      return reply.code(503).send({ error: "dispatcher tidak aktif (runtime Phase 2 belum dipasang)" });
    }
    const { agentId } = req.params as { agentId: string };
    const agent = await store.getAgent(agentId);
    if (!agent) return notFound(reply, `Agent tidak ditemukan: ${agentId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = asStr(body["text"]);
    if (!text) return bad(reply, "Field 'text' (arahan) wajib diisi.");

    const dispatched = await opts.dispatcher.dispatchToAgent(agentId, text, "ui");
    notify(dispatched.companyId);
    return reply.code(202).send({ directive: dispatched.directive, task: dispatched.task });
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await store.getTask(id);
    if (!task) return notFound(reply, `Task tidak ditemukan: ${id}`);
    return task;
  });

  app.get("/api/tasks/:id/artifacts", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getTask(id))) return notFound(reply, `Task tidak ditemukan: ${id}`);
    return store.listArtifactsByTask(id);
  });

  // ---------------- Workflow (Phase 3) ----------------

  app.get("/api/companies/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getCompany(id))) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listWorkflowRunsByCompany(id);
  });

  // Kirim arahan ke DEPARTEMEN → jalankan workflow pipeline (semua role). Balas 202.
  app.post("/api/departments/:departmentId/directives", async (req, reply) => {
    if (!opts.workflowEngine) {
      return reply.code(503).send({ error: "workflow engine tidak aktif (runtime Phase 3 belum dipasang)" });
    }
    const { departmentId } = req.params as { departmentId: string };
    const dept = await store.getDepartment(departmentId);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${departmentId}`);
    if (!(await opts.workflowEngine.departmentHasWorkflow(departmentId))) {
      return bad(reply, `Department '${dept.name}' belum punya workflow. Seed dari template atau set workflowId.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = asStr(body["text"]);
    if (!text) return bad(reply, "Field 'text' (arahan) wajib diisi.");

    const started = await opts.workflowEngine.startForDepartment(departmentId, text, "ui");
    notify(dept.companyId);
    return reply.code(202).send({ directive: started.directive, run: started.run });
  });

  // Resume approval (APPROVE / REVISI) dari UI.
  app.post("/api/approvals/:approvalId", async (req, reply) => {
    if (!opts.workflowEngine) {
      return reply.code(503).send({ error: "workflow engine tidak aktif" });
    }
    const { approvalId } = req.params as { approvalId: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decisionRaw = asStr(body["decision"]);
    if (decisionRaw !== "approve" && decisionRaw !== "revise") {
      return bad(reply, "Field 'decision' harus 'approve' atau 'revise'.");
    }
    const note = asStr(body["note"]);
    const run = await opts.workflowEngine.resumeByApproval(approvalId, decisionRaw, note);
    if (!run) return notFound(reply, `Tidak ada run menunggu approval: ${approvalId}`);
    const runDept = await store.getDepartment(run.departmentId);
    notify(runDept?.companyId);
    return reply.code(202).send({ run });
  });
}
