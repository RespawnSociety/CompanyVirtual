/**
 * REST API Configuration layer (plan §4). FACE (web) memanggil ini untuk CRUD
 * Company/Floor/Department/Agent + listing template & skill.
 *
 * Setelah mutasi yang mengubah world sebuah company, handler memanggil `opts.onMutate(companyId)`
 * agar RealtimeHub mem-broadcast snapshot terbaru (decoupling: routes tak tahu socket.io).
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { Guardrail, Id, ModelPolicy, Vec2 } from "@vc/shared";
import {
  getDepartmentTemplate,
  listDepartmentTemplates,
} from "@vc/templates";
import type { ConfigStore, NewAgent } from "../db/store.js";
import { seedDepartmentFromTemplate } from "../config/seed.js";
import { KNOWN_SKILLS } from "../config/skills.js";

export interface ConfigRoutesOptions {
  /** Dipanggil dengan companyId terdampak setelah mutasi sukses (untuk broadcast realtime). */
  onMutate?: (companyId: Id) => void;
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

  app.post("/api/companies", (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    if (!name) return bad(reply, "Field 'name' wajib diisi.");
    const branding =
      typeof body["branding"] === "object" && body["branding"] !== null
        ? (body["branding"] as Record<string, unknown>)
        : undefined;
    const company = store.createCompany(branding ? { name, branding } : { name });
    return reply.code(201).send(company);
  });

  app.get("/api/companies/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const company = store.getCompany(id);
    return company ?? notFound(reply, `Company tidak ditemukan: ${id}`);
  });

  app.delete("/api/companies/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = store.deleteCompany(id);
    if (!deleted) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return reply.send({ deleted: true });
  });

  app.get("/api/companies/:id/world", (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = store.getWorldSnapshot(id);
    return snap ?? notFound(reply, `Company tidak ditemukan: ${id}`);
  });

  app.get("/api/companies/:id/tasks", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getCompany(id)) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listTasksByCompany(id);
  });

  app.get("/api/companies/:id/comms", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getCompany(id)) return notFound(reply, `Company tidak ditemukan: ${id}`);
    return store.listCommsByCompany(id);
  });

  // ---------------- Floor ----------------

  app.get("/api/companies/:companyId/floors", (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!store.getCompany(companyId)) return notFound(reply, `Company tidak ditemukan: ${companyId}`);
    return store.listFloors(companyId);
  });

  app.post("/api/companies/:companyId/floors", (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!store.getCompany(companyId)) return notFound(reply, `Company tidak ditemukan: ${companyId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    if (!name) return bad(reply, "Field 'name' wajib diisi.");
    const mapKey = asStr(body["mapKey"]);
    const floor = store.createFloor(companyId, mapKey ? { name, mapKey } : { name });
    notify(companyId);
    return reply.code(201).send(floor);
  });

  app.delete("/api/floors/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const floor = store.getFloor(id);
    if (!floor) return notFound(reply, `Floor tidak ditemukan: ${id}`);
    store.deleteFloor(id);
    notify(floor.companyId);
    return reply.send({ deleted: true });
  });

  // ---------------- Department ----------------

  app.get("/api/floors/:floorId/departments", (req, reply) => {
    const { floorId } = req.params as { floorId: string };
    if (!store.getFloor(floorId)) return notFound(reply, `Floor tidak ditemukan: ${floorId}`);
    return store.listDepartmentsByFloor(floorId);
  });

  // Buat departemen: dari template (templateId) ATAU custom (name+purpose).
  app.post("/api/floors/:floorId/departments", (req, reply) => {
    const { floorId } = req.params as { floorId: string };
    const floor = store.getFloor(floorId);
    if (!floor) return notFound(reply, `Floor tidak ditemukan: ${floorId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const templateId = asStr(body["templateId"]);

    if (templateId) {
      const template = getDepartmentTemplate(templateId);
      if (!template) return bad(reply, `Template tidak dikenal: ${templateId}`);
      const seeded = seedDepartmentFromTemplate(store, {
        companyId: floor.companyId,
        floorId,
        template,
        ...(asStr(body["name"]) ? { name: asStr(body["name"])! } : {}),
        ...(asStr(body["purpose"]) ? { purpose: asStr(body["purpose"])! } : {}),
      });
      notify(floor.companyId);
      return reply.code(201).send(seeded);
    }

    // Custom (tanpa template).
    const name = asStr(body["name"]);
    const purpose = asStr(body["purpose"]);
    if (!name || !purpose) {
      return bad(reply, "Departemen custom butuh 'name' dan 'purpose' (atau beri 'templateId').");
    }
    const skillPool = asStrArray(body["skillPool"]) ?? [];
    const workflowId = asStr(body["workflowId"]);
    const department = store.createDepartment(floor.companyId, floorId, {
      name,
      purpose,
      skillPool,
      ...(workflowId ? { workflowId } : {}),
    });
    notify(floor.companyId);
    return reply.code(201).send({ department, agents: [], workflow: null });
  });

  app.get("/api/departments/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = store.getDepartment(id);
    return dept ?? notFound(reply, `Department tidak ditemukan: ${id}`);
  });

  app.patch("/api/departments/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = store.getDepartment(id);
    if (!cur) return notFound(reply, `Department tidak ditemukan: ${id}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<ConfigStore["updateDepartment"]>[1] = {};
    if (asStr(body["name"])) patch.name = asStr(body["name"])!;
    if (asStr(body["purpose"])) patch.purpose = asStr(body["purpose"])!;
    if (asStrArray(body["skillPool"])) patch.skillPool = asStrArray(body["skillPool"])!;
    if (asStr(body["workflowId"])) patch.workflowId = asStr(body["workflowId"])!;
    const updated = store.updateDepartment(id, patch);
    notify(cur.companyId);
    return updated;
  });

  app.delete("/api/departments/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = store.getDepartment(id);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${id}`);
    store.deleteDepartment(id);
    notify(dept.companyId);
    return reply.send({ deleted: true });
  });

  app.get("/api/departments/:id/workflow", (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = store.getDepartment(id);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${id}`);
    if (!dept.workflowId) return reply.send(null);
    return store.getWorkflow(dept.workflowId) ?? null;
  });

  // ---------------- Agent (AgentProfile) ----------------

  app.get("/api/departments/:departmentId/agents", (req, reply) => {
    const { departmentId } = req.params as { departmentId: string };
    if (!store.getDepartment(departmentId)) {
      return notFound(reply, `Department tidak ditemukan: ${departmentId}`);
    }
    return store.listAgentsByDepartment(departmentId);
  });

  app.post("/api/departments/:departmentId/agents", (req, reply) => {
    const { departmentId } = req.params as { departmentId: string };
    const dept = store.getDepartment(departmentId);
    if (!dept) return notFound(reply, `Department tidak ditemukan: ${departmentId}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asStr(body["name"]);
    const role = asStr(body["role"]);
    if (!name || !role) return bad(reply, "Agent butuh 'name' dan 'role'.");
    const input: NewAgent = {
      name,
      role,
      deskPos: asVec2(body["deskPos"]) ?? { x: 0, y: 0 },
      spriteKey: asStr(body["spriteKey"]) ?? "default",
      description: asStr(body["description"]) ?? "",
      skillScope: asStrArray(body["skillScope"]) ?? [],
      guardrails: Array.isArray(body["guardrails"]) ? (body["guardrails"] as Guardrail[]) : [],
      ...(asStr(body["commsHandle"]) ? { commsHandle: asStr(body["commsHandle"])! } : {}),
      ...(typeof body["modelPolicy"] === "object" && body["modelPolicy"] !== null
        ? { modelPolicy: body["modelPolicy"] as ModelPolicy }
        : {}),
    };
    const agent = store.createAgent(departmentId, input);
    notify(dept.companyId);
    return reply.code(201).send(agent);
  });

  app.patch("/api/agents/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = store.getAgent(id);
    if (!cur) return notFound(reply, `Agent tidak ditemukan: ${id}`);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<NewAgent> = {};
    if (asStr(body["name"])) patch.name = asStr(body["name"])!;
    if (asStr(body["role"])) patch.role = asStr(body["role"])!;
    if (asVec2(body["deskPos"])) patch.deskPos = asVec2(body["deskPos"])!;
    if (asStr(body["spriteKey"])) patch.spriteKey = asStr(body["spriteKey"])!;
    if (typeof body["description"] === "string") patch.description = body["description"];
    if (asStrArray(body["skillScope"])) patch.skillScope = asStrArray(body["skillScope"])!;
    if (Array.isArray(body["guardrails"])) patch.guardrails = body["guardrails"] as Guardrail[];
    if (asStr(body["commsHandle"])) patch.commsHandle = asStr(body["commsHandle"])!;
    if (typeof body["modelPolicy"] === "object" && body["modelPolicy"] !== null) {
      patch.modelPolicy = body["modelPolicy"] as ModelPolicy;
    }
    if (asStr(body["status"])) patch.status = asStr(body["status"]) as NewAgent["status"];
    const updated = store.updateAgent(id, patch);
    const dept = store.getDepartment(cur.departmentId);
    notify(dept?.companyId);
    return updated;
  });

  app.delete("/api/agents/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = store.getAgent(id);
    if (!agent) return notFound(reply, `Agent tidak ditemukan: ${id}`);
    const dept = store.getDepartment(agent.departmentId);
    store.deleteAgent(id);
    notify(dept?.companyId);
    return reply.send({ deleted: true });
  });
}
