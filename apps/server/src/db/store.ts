/**
 * ConfigStore — penyimpanan Configuration layer di SQLite (node:sqlite, tanpa native build).
 *
 * Memetakan baris DB ↔ tipe kontrak `@vc/shared` (sumber kebenaran tipe). Relasi turunan
 * (floorIds/departmentIds/agentIds) dihitung saat baca dari tabel anak.
 *
 * Catatan: node:sqlite masih "experimental" (Node ≥ 22) tapi stabil untuk pemakaian ini;
 * dipilih agar tidak perlu kompilasi native (penting di Windows + Node terbaru).
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  Company,
  Department,
  Floor,
  Guardrail,
  Id,
  ModelPolicy,
  Vec2,
  WorkflowDef,
  WorldSnapshot,
  Task,
  CommsMessage,
} from "@vc/shared";
import { SCHEMA_SQL } from "./schema.js";

/** Input pembuatan company (id & createdAt diisi store). */
export interface NewCompany {
  name: string;
  branding?: Record<string, unknown>;
}

/** Input pembuatan floor (index auto bila tak diberi). */
export interface NewFloor {
  name: string;
  mapKey?: string;
  index?: number;
}

/** Input pembuatan department. */
export interface NewDepartment {
  name: string;
  purpose: string;
  templateId?: Id;
  skillPool?: string[];
  workflowId?: Id;
}

/** Input pembuatan/replace agent (id auto bila tak diberi). */
export interface NewAgent {
  id?: Id;
  name: string;
  role: string;
  deskPos: Vec2;
  spriteKey: string;
  description: string;
  skillScope: string[];
  guardrails: Guardrail[];
  commsHandle?: string;
  modelPolicy?: ModelPolicy;
  memoryNamespace?: string;
  status?: AgentProfile["status"];
}

function newId(prefix: string): Id {
  return `${prefix}_${randomUUID()}`;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Wrapper SQLite + CRUD seluruh entitas Configuration layer. */
export class ConfigStore {
  private readonly db: DatabaseSync;

  /** `location` = path file (mis. "data/vc.db") atau ":memory:" untuk test. */
  constructor(location = ":memory:") {
    this.db = new DatabaseSync(location);
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ---------------- Company ----------------

  createCompany(input: NewCompany, now = Date.now()): Company {
    const id = newId("co");
    this.db
      .prepare("INSERT INTO companies (id, name, branding, created_at) VALUES (?, ?, ?, ?)")
      .run(
        id,
        input.name,
        input.branding ? JSON.stringify(input.branding) : null,
        now,
      );
    return this.getCompany(id)!;
  }

  listCompanies(): Company[] {
    const rows = this.db
      .prepare("SELECT * FROM companies ORDER BY created_at, id")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCompany(r));
  }

  getCompany(id: Id): Company | undefined {
    const row = this.db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToCompany(row) : undefined;
  }

  deleteCompany(id: Id): boolean {
    const res = this.db.prepare("DELETE FROM companies WHERE id = ?").run(id);
    return res.changes > 0;
  }

  private rowToCompany(r: Record<string, unknown>): Company {
    const id = r["id"] as Id;
    const company: Company = {
      id,
      name: r["name"] as string,
      createdAt: Number(r["created_at"]),
      floorIds: this.floorIdsOf(id),
    };
    const branding = parseJson<Record<string, unknown> | null>(r["branding"], null);
    if (branding) company.branding = branding;
    return company;
  }

  private floorIdsOf(companyId: Id): Id[] {
    const rows = this.db
      .prepare("SELECT id FROM floors WHERE company_id = ? ORDER BY idx, id")
      .all(companyId) as Record<string, unknown>[];
    return rows.map((r) => r["id"] as Id);
  }

  // ---------------- Floor ----------------

  createFloor(companyId: Id, input: NewFloor): Floor {
    if (!this.getCompany(companyId)) {
      throw new Error(`Company tidak ditemukan: ${companyId}`);
    }
    const id = newId("fl");
    const index = input.index ?? this.nextFloorIndex(companyId);
    const mapKey = input.mapKey ?? "office-default";
    this.db
      .prepare(
        "INSERT INTO floors (id, company_id, name, idx, map_key) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, companyId, input.name, index, mapKey);
    return this.getFloor(id)!;
  }

  private nextFloorIndex(companyId: Id): number {
    const row = this.db
      .prepare("SELECT MAX(idx) AS maxIdx FROM floors WHERE company_id = ?")
      .get(companyId) as Record<string, unknown> | undefined;
    const maxIdx = row?.["maxIdx"];
    return maxIdx == null ? 0 : Number(maxIdx) + 1;
  }

  listFloors(companyId: Id): Floor[] {
    const rows = this.db
      .prepare("SELECT * FROM floors WHERE company_id = ? ORDER BY idx, id")
      .all(companyId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFloor(r));
  }

  getFloor(id: Id): Floor | undefined {
    const row = this.db.prepare("SELECT * FROM floors WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToFloor(row) : undefined;
  }

  deleteFloor(id: Id): boolean {
    const res = this.db.prepare("DELETE FROM floors WHERE id = ?").run(id);
    return res.changes > 0;
  }

  private rowToFloor(r: Record<string, unknown>): Floor {
    const id = r["id"] as Id;
    return {
      id,
      companyId: r["company_id"] as Id,
      name: r["name"] as string,
      index: Number(r["idx"]),
      mapKey: r["map_key"] as string,
      departmentIds: this.departmentIdsOf(id),
    };
  }

  private departmentIdsOf(floorId: Id): Id[] {
    const rows = this.db
      .prepare("SELECT id FROM departments WHERE floor_id = ? ORDER BY created_at, id")
      .all(floorId) as Record<string, unknown>[];
    return rows.map((r) => r["id"] as Id);
  }

  // ---------------- Workflow ----------------

  upsertWorkflow(wf: WorkflowDef): WorkflowDef {
    this.db
      .prepare(
        "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET name = excluded.name, steps = excluded.steps",
      )
      .run(wf.id, wf.name, JSON.stringify(wf.steps));
    return this.getWorkflow(wf.id)!;
  }

  getWorkflow(id: Id): WorkflowDef | undefined {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row["id"] as Id,
      name: row["name"] as string,
      steps: parseJson(row["steps"], []),
    };
  }

  // ---------------- Department ----------------

  createDepartment(companyId: Id, floorId: Id, input: NewDepartment, now = Date.now()): Department {
    const floor = this.getFloor(floorId);
    if (!floor) throw new Error(`Floor tidak ditemukan: ${floorId}`);
    if (floor.companyId !== companyId) {
      throw new Error(`Floor ${floorId} bukan milik company ${companyId}`);
    }
    const id = newId("dp");
    this.db
      .prepare(
        "INSERT INTO departments (id, company_id, floor_id, name, template_id, purpose, skill_pool, workflow_id, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        companyId,
        floorId,
        input.name,
        input.templateId ?? null,
        input.purpose,
        JSON.stringify(input.skillPool ?? []),
        input.workflowId ?? null,
        now,
      );
    return this.getDepartment(id)!;
  }

  getDepartment(id: Id): Department | undefined {
    const row = this.db.prepare("SELECT * FROM departments WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToDepartment(row) : undefined;
  }

  listDepartmentsByFloor(floorId: Id): Department[] {
    const rows = this.db
      .prepare("SELECT * FROM departments WHERE floor_id = ? ORDER BY created_at, id")
      .all(floorId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDepartment(r));
  }

  listDepartmentsByCompany(companyId: Id): Department[] {
    const rows = this.db
      .prepare("SELECT * FROM departments WHERE company_id = ? ORDER BY created_at, id")
      .all(companyId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDepartment(r));
  }

  updateDepartment(
    id: Id,
    patch: Partial<Pick<Department, "name" | "purpose" | "skillPool" | "workflowId">>,
  ): Department | undefined {
    const cur = this.getDepartment(id);
    if (!cur) return undefined;
    const next = {
      name: patch.name ?? cur.name,
      purpose: patch.purpose ?? cur.purpose,
      skillPool: patch.skillPool ?? cur.skillPool,
      workflowId: patch.workflowId ?? cur.workflowId ?? null,
    };
    this.db
      .prepare(
        "UPDATE departments SET name = ?, purpose = ?, skill_pool = ?, workflow_id = ? WHERE id = ?",
      )
      .run(next.name, next.purpose, JSON.stringify(next.skillPool), next.workflowId, id);
    return this.getDepartment(id);
  }

  deleteDepartment(id: Id): boolean {
    const res = this.db.prepare("DELETE FROM departments WHERE id = ?").run(id);
    return res.changes > 0;
  }

  private rowToDepartment(r: Record<string, unknown>): Department {
    const id = r["id"] as Id;
    const dept: Department = {
      id,
      companyId: r["company_id"] as Id,
      floorId: r["floor_id"] as Id,
      name: r["name"] as string,
      purpose: r["purpose"] as string,
      skillPool: parseJson<string[]>(r["skill_pool"], []),
      agentIds: this.agentIdsOf(id),
    };
    const templateId = r["template_id"] as string | null;
    if (templateId) dept.templateId = templateId;
    const workflowId = r["workflow_id"] as string | null;
    if (workflowId) dept.workflowId = workflowId;
    return dept;
  }

  private agentIdsOf(departmentId: Id): Id[] {
    const rows = this.db
      .prepare("SELECT id FROM agents WHERE department_id = ? ORDER BY created_at, id")
      .all(departmentId) as Record<string, unknown>[];
    return rows.map((r) => r["id"] as Id);
  }

  // ---------------- Agent (AgentProfile) ----------------

  createAgent(departmentId: Id, input: NewAgent, now = Date.now()): AgentProfile {
    if (!this.getDepartment(departmentId)) {
      throw new Error(`Department tidak ditemukan: ${departmentId}`);
    }
    const id = input.id ?? newId("ag");
    const memoryNamespace = input.memoryNamespace ?? `agent:${id}`;
    const status = input.status ?? "idle";
    this.db
      .prepare(
        "INSERT INTO agents (id, department_id, name, role, desk_pos, sprite_key, description, " +
          "skill_scope, guardrails, comms_handle, model_policy, memory_namespace, status, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        departmentId,
        input.name,
        input.role,
        JSON.stringify(input.deskPos),
        input.spriteKey,
        input.description,
        JSON.stringify(input.skillScope),
        JSON.stringify(input.guardrails),
        input.commsHandle ?? null,
        input.modelPolicy ? JSON.stringify(input.modelPolicy) : null,
        memoryNamespace,
        status,
        now,
      );
    return this.getAgent(id)!;
  }

  getAgent(id: Id): AgentProfile | undefined {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAgent(row) : undefined;
  }

  listAgentsByDepartment(departmentId: Id): AgentProfile[] {
    const rows = this.db
      .prepare("SELECT * FROM agents WHERE department_id = ? ORDER BY created_at, id")
      .all(departmentId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAgent(r));
  }

  listAgentsByCompany(companyId: Id): AgentProfile[] {
    const rows = this.db
      .prepare(
        "SELECT a.* FROM agents a JOIN departments d ON a.department_id = d.id " +
          "WHERE d.company_id = ? ORDER BY a.created_at, a.id",
      )
      .all(companyId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAgent(r));
  }

  updateAgent(id: Id, patch: Partial<NewAgent>): AgentProfile | undefined {
    const cur = this.getAgent(id);
    if (!cur) return undefined;
    const next: AgentProfile = {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.deskPos !== undefined ? { deskPos: patch.deskPos } : {}),
      ...(patch.spriteKey !== undefined ? { spriteKey: patch.spriteKey } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.skillScope !== undefined ? { skillScope: patch.skillScope } : {}),
      ...(patch.guardrails !== undefined ? { guardrails: patch.guardrails } : {}),
      ...(patch.commsHandle !== undefined ? { commsHandle: patch.commsHandle } : {}),
      ...(patch.modelPolicy !== undefined ? { modelPolicy: patch.modelPolicy } : {}),
      ...(patch.memoryNamespace !== undefined ? { memoryNamespace: patch.memoryNamespace } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    this.db
      .prepare(
        "UPDATE agents SET name = ?, role = ?, desk_pos = ?, sprite_key = ?, description = ?, " +
          "skill_scope = ?, guardrails = ?, comms_handle = ?, model_policy = ?, memory_namespace = ?, status = ? " +
          "WHERE id = ?",
      )
      .run(
        next.name,
        next.role,
        JSON.stringify(next.deskPos),
        next.spriteKey,
        next.description,
        JSON.stringify(next.skillScope),
        JSON.stringify(next.guardrails),
        next.commsHandle ?? null,
        next.modelPolicy ? JSON.stringify(next.modelPolicy) : null,
        next.memoryNamespace,
        next.status,
        id,
      );
    return this.getAgent(id);
  }

  deleteAgent(id: Id): boolean {
    const res = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return res.changes > 0;
  }

  private rowToAgent(r: Record<string, unknown>): AgentProfile {
    const agent: AgentProfile = {
      id: r["id"] as Id,
      departmentId: r["department_id"] as Id,
      name: r["name"] as string,
      role: r["role"] as string,
      deskPos: parseJson<Vec2>(r["desk_pos"], { x: 0, y: 0 }),
      spriteKey: r["sprite_key"] as string,
      description: r["description"] as string,
      skillScope: parseJson<string[]>(r["skill_scope"], []),
      guardrails: parseJson<Guardrail[]>(r["guardrails"], []),
      memoryNamespace: r["memory_namespace"] as string,
      status: r["status"] as AgentProfile["status"],
    };
    const commsHandle = r["comms_handle"] as string | null;
    if (commsHandle) agent.commsHandle = commsHandle;
    const modelPolicy = parseJson<ModelPolicy | null>(r["model_policy"], null);
    if (modelPolicy) agent.modelPolicy = modelPolicy;
    return agent;
  }

  // ---------------- Task / Comms (Phase 1: read-only, biasanya kosong) ----------------

  listTasksByCompany(companyId: Id): Task[] {
    const rows = this.db
      .prepare(
        "SELECT t.* FROM tasks t JOIN departments d ON t.department_id = d.id " +
          "WHERE d.company_id = ? ORDER BY t.created_at, t.id",
      )
      .all(companyId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r["id"] as Id,
      directiveId: r["directive_id"] as Id,
      departmentId: r["department_id"] as Id,
      title: r["title"] as string,
      assignee: r["assignee"] as Id,
      status: r["status"] as Task["status"],
      ...(r["inputs"] ? { inputs: parseJson<Record<string, unknown>>(r["inputs"], {}) } : {}),
      ...(r["output_ref"] ? { outputRef: r["output_ref"] as Id } : {}),
      dependsOn: parseJson<Id[]>(r["depends_on"], []),
    }));
  }

  listCommsByCompany(_companyId: Id): CommsMessage[] {
    // Phase 1: belum ada pemetaan thread→company dan belum ada produsen comms.
    // Sengaja kembalikan kosong: mengembalikan SEMUA pesan akan membocorkan percakapan
    // lintas-company begitu tabel terisi. Comms ter-scope per company menyusul di Phase 3
    // (WA relay 2 arah + tabel threads dengan companyId).
    return [];
  }

  // ---------------- World snapshot ----------------

  getWorldSnapshot(companyId: Id): WorldSnapshot | undefined {
    const company = this.getCompany(companyId);
    if (!company) return undefined;
    return {
      company,
      floors: this.listFloors(companyId),
      departments: this.listDepartmentsByCompany(companyId),
      agents: this.listAgentsByCompany(companyId),
    };
  }
}
