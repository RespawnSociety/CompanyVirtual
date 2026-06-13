/**
 * ConfigStore — penyimpanan Configuration layer + runtime di MySQL/MariaDB (XAMPP).
 *
 * Memetakan baris DB ↔ tipe kontrak `@vc/shared` (sumber kebenaran tipe). Relasi turunan
 * (floorIds/departmentIds/agentIds) dihitung saat baca dari tabel anak (hindari drift);
 * cascade ditegakkan InnoDB FOREIGN KEY.
 *
 * Driver: `mysql2/promise` (pure-JS, tanpa native build). API store ini ASYNC — semua
 * method mengembalikan Promise. Buat instance via `ConfigStore.create(config)` (async:
 * membuat pool + memastikan skema). Koneksi default = XAMPP (127.0.0.1:3306, root, no-pass).
 */

import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { defaultGenId } from "@vc/agent-runtime";
import type {
  AgentProfile,
  Artifact,
  Company,
  Department,
  Directive,
  DirectiveSource,
  DirectiveStatus,
  Floor,
  Guardrail,
  Id,
  ModelPolicy,
  Vec2,
  WorkflowDef,
  WorkflowRun,
  WorkflowRunStatus,
  WorldSnapshot,
  Task,
  TaskStatus,
  CommsMessage,
} from "@vc/shared";
import { SCHEMA_STATEMENTS } from "./schema.js";
import { MysqlMemoryStore } from "./memoryStore.js";

/** Konfigurasi koneksi MySQL (default XAMPP). */
export interface MysqlConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

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

/** Input pembuatan directive (id & createdAt diisi store; status default "received"). */
export interface NewDirective {
  text: string;
  source: DirectiveSource;
  /** Departemen yang menangani (opsional; scoping/observability). */
  departmentId?: Id;
  status?: DirectiveStatus;
}

/** Input pembuatan task (id & createdAt diisi store; status default "todo"). */
export interface NewTask {
  companyId: Id;
  directiveId: Id;
  departmentId: Id;
  title: string;
  assignee: Id;
  status?: TaskStatus;
  inputs?: Record<string, unknown>;
  dependsOn?: Id[];
}

/** Input pembuatan artifact (id & createdAt diisi store). */
export interface NewArtifact {
  taskId: Id;
  kind: string;
  content: string;
  meta?: Record<string, unknown>;
}

/** Input pembuatan workflow run (Phase 3). */
export interface NewWorkflowRun {
  companyId: Id;
  directiveId: Id;
  departmentId: Id;
  workflowId: Id;
  currentStepId?: Id;
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

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Baca konfigurasi MySQL dari environment (default XAMPP). */
export function mysqlConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MysqlConfig {
  return {
    host: env.DB_MYSQL_HOST?.trim() || "127.0.0.1",
    port: Number(env.DB_MYSQL_PORT ?? 3306),
    user: env.DB_MYSQL_USER?.trim() || "root",
    password: env.DB_MYSQL_PASSWORD ?? "",
    database: env.DB_MYSQL_DATABASE?.trim() || "virtual_company",
  };
}

/** Wrapper MySQL + CRUD seluruh entitas Configuration layer + runtime. */
export class ConfigStore {
  private constructor(private readonly pool: Pool) {}

  /**
   * Buat store: bangun connection pool lalu pastikan skema ada (idempoten).
   * Database harus sudah dibuat (mis. `CREATE DATABASE virtual_company`).
   */
  static async create(config: MysqlConfig = {}): Promise<ConfigStore> {
    const pool = mysql.createPool({
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 3306,
      user: config.user ?? "root",
      password: config.password ?? "",
      database: config.database ?? "virtual_company",
      connectionLimit: 10,
      charset: "utf8mb4_unicode_ci",
      // BIGINT epoch ms aman di Number JS; biarkan default, lalu Number() saat map.
    });
    const store = new ConfigStore(pool);
    await store.init();
    return store;
  }

  private async init(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.pool.query(stmt);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Memory store persisten (Phase 2.5) yang berbagi pool & database dengan ConfigStore.
   * Tabel `memory_items` sudah dibuat oleh `init()`.
   */
  createMemoryStore(): MysqlMemoryStore {
    return new MysqlMemoryStore(this.pool);
  }

  // ---------------- query helpers ----------------

  /** Nilai parameter yang didukung mysql2 untuk prepared statement kita. */
  // (semua kolom kita skalar: string/number/null — JSON sudah di-stringify saat tulis)

  private async all(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<Record<string, unknown>[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, params);
    return rows as Record<string, unknown>[];
  }

  private async one(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<Record<string, unknown> | undefined> {
    const rows = await this.all(sql, params);
    return rows[0];
  }

  private async run(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<ResultSetHeader> {
    const [res] = await this.pool.execute<ResultSetHeader>(sql, params);
    return res;
  }

  // ---------------- Company ----------------

  async createCompany(input: NewCompany, now = Date.now()): Promise<Company> {
    const id = defaultGenId("co");
    await this.run("INSERT INTO companies (id, name, branding, created_at) VALUES (?, ?, ?, ?)", [
      id,
      input.name,
      input.branding ? JSON.stringify(input.branding) : null,
      now,
    ]);
    return (await this.getCompany(id))!;
  }

  async listCompanies(): Promise<Company[]> {
    const rows = await this.all("SELECT * FROM companies ORDER BY created_at, id");
    const byCompany = await this.childIdsByParent(
      "floors",
      "company_id",
      rows.map((r) => r["id"] as Id),
      "idx, id",
    );
    return rows.map((r) => this.rowToCompany(r, byCompany.get(r["id"] as Id) ?? []));
  }

  async getCompany(id: Id): Promise<Company | undefined> {
    const row = await this.one("SELECT * FROM companies WHERE id = ?", [id]);
    return row ? this.rowToCompany(row, await this.floorIdsOf(id)) : undefined;
  }

  async deleteCompany(id: Id): Promise<boolean> {
    const res = await this.run("DELETE FROM companies WHERE id = ?", [id]);
    return res.affectedRows > 0;
  }

  private rowToCompany(r: Record<string, unknown>, floorIds: Id[]): Company {
    const company: Company = {
      id: r["id"] as Id,
      name: r["name"] as string,
      createdAt: Number(r["created_at"]),
      floorIds,
    };
    const branding = parseJson<Record<string, unknown> | null>(r["branding"], null);
    if (branding) company.branding = branding;
    return company;
  }

  private async floorIdsOf(companyId: Id): Promise<Id[]> {
    const rows = await this.all(
      "SELECT id FROM floors WHERE company_id = ? ORDER BY idx, id",
      [companyId],
    );
    return rows.map((r) => r["id"] as Id);
  }

  /**
   * Ambil id anak untuk BANYAK parent sekaligus (`WHERE parent IN (...)`) lalu bucket
   * per-parent dalam satu Map — hindari N+1 di jalur list/getWorldSnapshot (hot path).
   * `table`/`parentCol`/`orderBy` adalah konstanta internal (bukan input pengguna).
   */
  private async childIdsByParent(
    table: string,
    parentCol: string,
    parentIds: Id[],
    orderBy: string,
  ): Promise<Map<Id, Id[]>> {
    const buckets = new Map<Id, Id[]>();
    for (const id of parentIds) buckets.set(id, []);
    if (parentIds.length === 0) return buckets;
    const placeholders = parentIds.map(() => "?").join(", ");
    const rows = await this.all(
      `SELECT id, ${parentCol} AS parent FROM ${table} ` +
        `WHERE ${parentCol} IN (${placeholders}) ORDER BY ${parentCol}, ${orderBy}`,
      parentIds,
    );
    for (const r of rows) buckets.get(r["parent"] as Id)?.push(r["id"] as Id);
    return buckets;
  }

  // ---------------- Floor ----------------

  async createFloor(companyId: Id, input: NewFloor): Promise<Floor> {
    if (!(await this.getCompany(companyId))) {
      throw new Error(`Company tidak ditemukan: ${companyId}`);
    }
    const id = defaultGenId("fl");
    const index = input.index ?? (await this.nextFloorIndex(companyId));
    const mapKey = input.mapKey ?? "office-default";
    await this.run(
      "INSERT INTO floors (id, company_id, name, idx, map_key) VALUES (?, ?, ?, ?, ?)",
      [id, companyId, input.name, index, mapKey],
    );
    return (await this.getFloor(id))!;
  }

  private async nextFloorIndex(companyId: Id): Promise<number> {
    const row = await this.one(
      "SELECT MAX(idx) AS maxIdx FROM floors WHERE company_id = ?",
      [companyId],
    );
    const maxIdx = row?.["maxIdx"];
    return maxIdx == null ? 0 : Number(maxIdx) + 1;
  }

  async listFloors(companyId: Id): Promise<Floor[]> {
    const rows = await this.all(
      "SELECT * FROM floors WHERE company_id = ? ORDER BY idx, id",
      [companyId],
    );
    const byFloor = await this.childIdsByParent(
      "departments",
      "floor_id",
      rows.map((r) => r["id"] as Id),
      "created_at, id",
    );
    return rows.map((r) => this.rowToFloor(r, byFloor.get(r["id"] as Id) ?? []));
  }

  async getFloor(id: Id): Promise<Floor | undefined> {
    const row = await this.one("SELECT * FROM floors WHERE id = ?", [id]);
    return row ? this.rowToFloor(row, await this.departmentIdsOf(id)) : undefined;
  }

  async deleteFloor(id: Id): Promise<boolean> {
    const res = await this.run("DELETE FROM floors WHERE id = ?", [id]);
    return res.affectedRows > 0;
  }

  private rowToFloor(r: Record<string, unknown>, departmentIds: Id[]): Floor {
    return {
      id: r["id"] as Id,
      companyId: r["company_id"] as Id,
      name: r["name"] as string,
      index: Number(r["idx"]),
      mapKey: r["map_key"] as string,
      departmentIds,
    };
  }

  private async departmentIdsOf(floorId: Id): Promise<Id[]> {
    const rows = await this.all(
      "SELECT id FROM departments WHERE floor_id = ? ORDER BY created_at, id",
      [floorId],
    );
    return rows.map((r) => r["id"] as Id);
  }

  // ---------------- Workflow ----------------

  async upsertWorkflow(wf: WorkflowDef): Promise<WorkflowDef> {
    await this.run(
      "INSERT INTO workflows (id, name, steps) VALUES (?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE name = VALUES(name), steps = VALUES(steps)",
      [wf.id, wf.name, JSON.stringify(wf.steps)],
    );
    return (await this.getWorkflow(wf.id))!;
  }

  async getWorkflow(id: Id): Promise<WorkflowDef | undefined> {
    const row = await this.one("SELECT * FROM workflows WHERE id = ?", [id]);
    if (!row) return undefined;
    return {
      id: row["id"] as Id,
      name: row["name"] as string,
      steps: parseJson(row["steps"], []),
    };
  }

  // ---------------- Department ----------------

  async createDepartment(
    companyId: Id,
    floorId: Id,
    input: NewDepartment,
    now = Date.now(),
  ): Promise<Department> {
    const floor = await this.getFloor(floorId);
    if (!floor) throw new Error(`Floor tidak ditemukan: ${floorId}`);
    if (floor.companyId !== companyId) {
      throw new Error(`Floor ${floorId} bukan milik company ${companyId}`);
    }
    const id = defaultGenId("dp");
    await this.run(
      "INSERT INTO departments (id, company_id, floor_id, name, template_id, purpose, skill_pool, workflow_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        companyId,
        floorId,
        input.name,
        input.templateId ?? null,
        input.purpose,
        JSON.stringify(input.skillPool ?? []),
        input.workflowId ?? null,
        now,
      ],
    );
    return (await this.getDepartment(id))!;
  }

  async getDepartment(id: Id): Promise<Department | undefined> {
    const row = await this.one("SELECT * FROM departments WHERE id = ?", [id]);
    return row ? this.rowToDepartment(row, await this.agentIdsOf(id)) : undefined;
  }

  async listDepartmentsByFloor(floorId: Id): Promise<Department[]> {
    const rows = await this.all(
      "SELECT * FROM departments WHERE floor_id = ? ORDER BY created_at, id",
      [floorId],
    );
    return this.rowsToDepartments(rows);
  }

  async listDepartmentsByCompany(companyId: Id): Promise<Department[]> {
    const rows = await this.all(
      "SELECT * FROM departments WHERE company_id = ? ORDER BY created_at, id",
      [companyId],
    );
    return this.rowsToDepartments(rows);
  }

  /** Map baris department → Department dengan agentIds di-batch (hindari N+1). */
  private async rowsToDepartments(rows: Record<string, unknown>[]): Promise<Department[]> {
    const byDept = await this.childIdsByParent(
      "agents",
      "department_id",
      rows.map((r) => r["id"] as Id),
      "created_at, id",
    );
    return rows.map((r) => this.rowToDepartment(r, byDept.get(r["id"] as Id) ?? []));
  }

  async updateDepartment(
    id: Id,
    patch: Partial<Pick<Department, "name" | "purpose" | "skillPool" | "workflowId">>,
  ): Promise<Department | undefined> {
    const cur = await this.getDepartment(id);
    if (!cur) return undefined;
    const next = {
      name: patch.name ?? cur.name,
      purpose: patch.purpose ?? cur.purpose,
      skillPool: patch.skillPool ?? cur.skillPool,
      // CR-102: workflowId opsional & bisa dikosongkan. patch hadir (mis. "") → clear (null);
      // absent (undefined) → pertahankan nilai lama.
      workflowId: patch.workflowId !== undefined ? patch.workflowId || null : cur.workflowId ?? null,
    };
    await this.run(
      "UPDATE departments SET name = ?, purpose = ?, skill_pool = ?, workflow_id = ? WHERE id = ?",
      [next.name, next.purpose, JSON.stringify(next.skillPool), next.workflowId, id],
    );
    return this.getDepartment(id);
  }

  async deleteDepartment(id: Id): Promise<boolean> {
    const res = await this.run("DELETE FROM departments WHERE id = ?", [id]);
    return res.affectedRows > 0;
  }

  private rowToDepartment(r: Record<string, unknown>, agentIds: Id[]): Department {
    const dept: Department = {
      id: r["id"] as Id,
      companyId: r["company_id"] as Id,
      floorId: r["floor_id"] as Id,
      name: r["name"] as string,
      purpose: r["purpose"] as string,
      skillPool: parseJson<string[]>(r["skill_pool"], []),
      agentIds,
    };
    const templateId = r["template_id"] as string | null;
    if (templateId) dept.templateId = templateId;
    const workflowId = r["workflow_id"] as string | null;
    if (workflowId) dept.workflowId = workflowId;
    return dept;
  }

  private async agentIdsOf(departmentId: Id): Promise<Id[]> {
    const rows = await this.all(
      "SELECT id FROM agents WHERE department_id = ? ORDER BY created_at, id",
      [departmentId],
    );
    return rows.map((r) => r["id"] as Id);
  }

  // ---------------- Agent (AgentProfile) ----------------

  async createAgent(departmentId: Id, input: NewAgent, now = Date.now()): Promise<AgentProfile> {
    if (!(await this.getDepartment(departmentId))) {
      throw new Error(`Department tidak ditemukan: ${departmentId}`);
    }
    const id = input.id ?? defaultGenId("ag");
    const memoryNamespace = input.memoryNamespace ?? `agent:${id}`;
    const status = input.status ?? "idle";
    await this.run(
      "INSERT INTO agents (id, department_id, name, role, desk_pos, sprite_key, description, " +
        "skill_scope, guardrails, comms_handle, model_policy, memory_namespace, status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
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
      ],
    );
    return (await this.getAgent(id))!;
  }

  async getAgent(id: Id): Promise<AgentProfile | undefined> {
    const row = await this.one("SELECT * FROM agents WHERE id = ?", [id]);
    return row ? this.rowToAgent(row) : undefined;
  }

  async listAgentsByDepartment(departmentId: Id): Promise<AgentProfile[]> {
    const rows = await this.all(
      "SELECT * FROM agents WHERE department_id = ? ORDER BY created_at, id",
      [departmentId],
    );
    return rows.map((r) => this.rowToAgent(r));
  }

  async listAgentsByCompany(companyId: Id): Promise<AgentProfile[]> {
    const rows = await this.all(
      "SELECT a.* FROM agents a JOIN departments d ON a.department_id = d.id " +
        "WHERE d.company_id = ? ORDER BY a.created_at, a.id",
      [companyId],
    );
    return rows.map((r) => this.rowToAgent(r));
  }

  async updateAgent(id: Id, patch: Partial<NewAgent>): Promise<AgentProfile | undefined> {
    const cur = await this.getAgent(id);
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
    await this.run(
      "UPDATE agents SET name = ?, role = ?, desk_pos = ?, sprite_key = ?, description = ?, " +
        "skill_scope = ?, guardrails = ?, comms_handle = ?, model_policy = ?, memory_namespace = ?, status = ? " +
        "WHERE id = ?",
      [
        next.name,
        next.role,
        JSON.stringify(next.deskPos),
        next.spriteKey,
        next.description,
        JSON.stringify(next.skillScope),
        JSON.stringify(next.guardrails),
        // CR-102: commsHandle "" (clear via PATCH) → simpan NULL, konsisten dgn createAgent.
        next.commsHandle || null,
        next.modelPolicy ? JSON.stringify(next.modelPolicy) : null,
        next.memoryNamespace,
        next.status,
        id,
      ],
    );
    return this.getAgent(id);
  }

  async deleteAgent(id: Id): Promise<boolean> {
    const res = await this.run("DELETE FROM agents WHERE id = ?", [id]);
    return res.affectedRows > 0;
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

  // ---------------- Directive (Phase 2) ----------------

  async createDirective(companyId: Id, input: NewDirective, now = Date.now()): Promise<Directive> {
    if (!(await this.getCompany(companyId))) throw new Error(`Company tidak ditemukan: ${companyId}`);
    const id = defaultGenId("dir");
    const status: DirectiveStatus = input.status ?? "received";
    await this.run(
      "INSERT INTO directives (id, company_id, department_id, `text`, source, status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, companyId, input.departmentId ?? null, input.text, input.source, status, now],
    );
    return (await this.getDirective(id))!;
  }

  async getDirective(id: Id): Promise<Directive | undefined> {
    const row = await this.one("SELECT * FROM directives WHERE id = ?", [id]);
    return row ? this.rowToDirective(row) : undefined;
  }

  async updateDirectiveStatus(id: Id, status: DirectiveStatus): Promise<Directive | undefined> {
    const res = await this.run("UPDATE directives SET status = ? WHERE id = ?", [status, id]);
    return res.affectedRows > 0 ? this.getDirective(id) : undefined;
  }

  async listDirectivesByCompany(companyId: Id): Promise<Directive[]> {
    const rows = await this.all(
      "SELECT * FROM directives WHERE company_id = ? ORDER BY created_at, id",
      [companyId],
    );
    return rows.map((r) => this.rowToDirective(r));
  }

  private rowToDirective(r: Record<string, unknown>): Directive {
    return {
      id: r["id"] as Id,
      text: r["text"] as string,
      source: r["source"] as DirectiveSource,
      createdAt: Number(r["created_at"]),
      status: r["status"] as DirectiveStatus,
    };
  }

  // ---------------- Task (Phase 2) ----------------

  async createTask(input: NewTask, now = Date.now()): Promise<Task> {
    const id = defaultGenId("task");
    const status: TaskStatus = input.status ?? "todo";
    await this.run(
      "INSERT INTO tasks (id, company_id, directive_id, department_id, title, assignee, status, inputs, output_ref, depends_on, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.companyId,
        input.directiveId,
        input.departmentId,
        input.title,
        input.assignee,
        status,
        input.inputs ? JSON.stringify(input.inputs) : null,
        null,
        JSON.stringify(input.dependsOn ?? []),
        now,
      ],
    );
    return (await this.getTask(id))!;
  }

  async getTask(id: Id): Promise<Task | undefined> {
    const row = await this.one("SELECT * FROM tasks WHERE id = ?", [id]);
    return row ? this.rowToTask(row) : undefined;
  }

  /** Update sebagian field task (status / outputRef / inputs). */
  async updateTask(
    id: Id,
    patch: { status?: TaskStatus; outputRef?: Id | null; inputs?: Record<string, unknown> },
  ): Promise<Task | undefined> {
    const cur = await this.getTask(id);
    if (!cur) return undefined;
    const status = patch.status ?? cur.status;
    const outputRef =
      patch.outputRef !== undefined ? patch.outputRef || null : cur.outputRef ?? null;
    const inputs = patch.inputs !== undefined ? patch.inputs : cur.inputs;
    await this.run("UPDATE tasks SET status = ?, output_ref = ?, inputs = ? WHERE id = ?", [
      status,
      outputRef,
      inputs ? JSON.stringify(inputs) : null,
      id,
    ]);
    return this.getTask(id);
  }

  async listTasksByCompany(companyId: Id): Promise<Task[]> {
    const rows = await this.all(
      "SELECT * FROM tasks WHERE company_id = ? ORDER BY created_at, id",
      [companyId],
    );
    return rows.map((r) => this.rowToTask(r));
  }

  async listTasksByDirective(directiveId: Id): Promise<Task[]> {
    const rows = await this.all(
      "SELECT * FROM tasks WHERE directive_id = ? ORDER BY created_at, id",
      [directiveId],
    );
    return rows.map((r) => this.rowToTask(r));
  }

  private rowToTask(r: Record<string, unknown>): Task {
    return {
      id: r["id"] as Id,
      directiveId: r["directive_id"] as Id,
      departmentId: r["department_id"] as Id,
      title: r["title"] as string,
      assignee: r["assignee"] as Id,
      status: r["status"] as TaskStatus,
      ...(r["inputs"] ? { inputs: parseJson<Record<string, unknown>>(r["inputs"], {}) } : {}),
      ...(r["output_ref"] ? { outputRef: r["output_ref"] as Id } : {}),
      dependsOn: parseJson<Id[]>(r["depends_on"], []),
    };
  }

  // ---------------- Artifact (Phase 2) ----------------

  async addArtifact(input: NewArtifact, now = Date.now()): Promise<Artifact> {
    const id = defaultGenId("art");
    await this.run(
      "INSERT INTO artifacts (id, task_id, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.taskId, input.kind, input.content, input.meta ? JSON.stringify(input.meta) : null, now],
    );
    return (await this.getArtifact(id))!;
  }

  async getArtifact(id: Id): Promise<Artifact | undefined> {
    const row = await this.one("SELECT * FROM artifacts WHERE id = ?", [id]);
    return row ? this.rowToArtifact(row) : undefined;
  }

  async listArtifactsByTask(taskId: Id): Promise<Artifact[]> {
    const rows = await this.all(
      "SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at, id",
      [taskId],
    );
    return rows.map((r) => this.rowToArtifact(r));
  }

  async listArtifactsByCompany(companyId: Id): Promise<Artifact[]> {
    const rows = await this.all(
      "SELECT ar.* FROM artifacts ar JOIN tasks t ON ar.task_id = t.id " +
        "WHERE t.company_id = ? ORDER BY ar.created_at, ar.id",
      [companyId],
    );
    return rows.map((r) => this.rowToArtifact(r));
  }

  private rowToArtifact(r: Record<string, unknown>): Artifact {
    const artifact: Artifact = {
      id: r["id"] as Id,
      kind: r["kind"] as string,
      taskId: r["task_id"] as Id,
      content: r["content"] as string,
    };
    const meta = parseJson<Record<string, unknown> | null>(r["meta"], null);
    if (meta) artifact.meta = meta;
    return artifact;
  }

  // ---------------- WorkflowRun (Phase 3) ----------------

  async createWorkflowRun(input: NewWorkflowRun, now = Date.now()): Promise<WorkflowRun> {
    const id = defaultGenId("run");
    await this.run(
      "INSERT INTO workflow_runs (id, company_id, directive_id, department_id, workflow_id, status, current_step_id, step_artifacts, approval_id, review_rounds, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.companyId,
        input.directiveId,
        input.departmentId,
        input.workflowId,
        "running",
        input.currentStepId ?? null,
        JSON.stringify({}),
        null,
        0,
        now,
        now,
      ],
    );
    return (await this.getWorkflowRun(id))!;
  }

  async getWorkflowRun(id: Id): Promise<WorkflowRun | undefined> {
    const row = await this.one("SELECT * FROM workflow_runs WHERE id = ?", [id]);
    return row ? this.rowToWorkflowRun(row) : undefined;
  }

  /** Cari run yang sedang menunggu approval tertentu (untuk resume APPROVE/REVISI). */
  async findWorkflowRunByApproval(approvalId: Id): Promise<WorkflowRun | undefined> {
    const row = await this.one("SELECT * FROM workflow_runs WHERE approval_id = ?", [approvalId]);
    return row ? this.rowToWorkflowRun(row) : undefined;
  }

  async updateWorkflowRun(
    id: Id,
    patch: {
      status?: WorkflowRunStatus;
      currentStepId?: Id | null;
      stepArtifacts?: Record<Id, Id>;
      approvalId?: Id | null;
      reviewRounds?: number;
    },
    now = Date.now(),
  ): Promise<WorkflowRun | undefined> {
    const cur = await this.getWorkflowRun(id);
    if (!cur) return undefined;
    const next = {
      status: patch.status ?? cur.status,
      currentStepId:
        patch.currentStepId !== undefined ? patch.currentStepId || null : cur.currentStepId ?? null,
      stepArtifacts: patch.stepArtifacts ?? cur.stepArtifacts,
      approvalId: patch.approvalId !== undefined ? patch.approvalId || null : cur.approvalId ?? null,
      reviewRounds: patch.reviewRounds ?? cur.reviewRounds,
    };
    await this.run(
      "UPDATE workflow_runs SET status = ?, current_step_id = ?, step_artifacts = ?, approval_id = ?, review_rounds = ?, updated_at = ? WHERE id = ?",
      [
        next.status,
        next.currentStepId,
        JSON.stringify(next.stepArtifacts),
        next.approvalId,
        next.reviewRounds,
        now,
        id,
      ],
    );
    return this.getWorkflowRun(id);
  }

  async listWorkflowRunsByCompany(companyId: Id): Promise<WorkflowRun[]> {
    const rows = await this.all(
      "SELECT * FROM workflow_runs WHERE company_id = ? ORDER BY created_at, id",
      [companyId],
    );
    return rows.map((r) => this.rowToWorkflowRun(r));
  }

  private rowToWorkflowRun(r: Record<string, unknown>): WorkflowRun {
    const run: WorkflowRun = {
      id: r["id"] as Id,
      directiveId: r["directive_id"] as Id,
      departmentId: r["department_id"] as Id,
      workflowId: r["workflow_id"] as Id,
      status: r["status"] as WorkflowRunStatus,
      stepArtifacts: parseJson<Record<Id, Id>>(r["step_artifacts"], {}),
      reviewRounds: Number(r["review_rounds"]),
      createdAt: Number(r["created_at"]),
      updatedAt: Number(r["updated_at"]),
    };
    const currentStepId = r["current_step_id"] as string | null;
    if (currentStepId) run.currentStepId = currentStepId;
    const approvalId = r["approval_id"] as string | null;
    if (approvalId) run.approvalId = approvalId;
    return run;
  }

  // ---------------- Comms ----------------

  async listCommsByCompany(_companyId: Id): Promise<CommsMessage[]> {
    // Phase 1–2: belum ada pemetaan thread→company dan belum ada produsen comms.
    // Sengaja kembalikan kosong: mengembalikan SEMUA pesan akan membocorkan percakapan
    // lintas-company begitu tabel terisi. Comms ter-scope per company menyusul di Phase 3.
    return [];
  }

  // ---------------- World snapshot ----------------

  async getWorldSnapshot(companyId: Id): Promise<WorldSnapshot | undefined> {
    const company = await this.getCompany(companyId);
    if (!company) return undefined;
    const [floors, departments, agents] = await Promise.all([
      this.listFloors(companyId),
      this.listDepartmentsByCompany(companyId),
      this.listAgentsByCompany(companyId),
    ]);
    return { company, floors, departments, agents };
  }
}
