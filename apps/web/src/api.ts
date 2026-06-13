/**
 * Klien REST ke orchestrator (`/api/*`, di-proxy Vite ke Fastify).
 * Tipe respons memakai kontrak `@vc/shared` (sumber kebenaran tunggal).
 */

import type {
  AgentProfile,
  Artifact,
  AuditEntry,
  CommsMessage,
  Company,
  Department,
  DepartmentTemplate,
  Directive,
  Floor,
  Guardrail,
  KpiReport,
  ModelPolicy,
  Task,
  Vec2,
  WorkflowDef,
  WorkflowRun,
  WorldSnapshot,
} from "@vc/shared";

/** Entri katalog skill (bentuk respons /api/skills; cermin SkillCatalogEntry server). */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  implemented: boolean;
  risky: boolean;
}

/** Hasil seed/create department. */
export interface CreateDepartmentResult {
  department: Department;
  agents: AgentProfile[];
  workflow: WorkflowDef | null;
}

/**
 * Origin server (Phase 6). Kosong (default browser/dev) → URL relatif: di dev di-proxy Vite
 * (same-origin), di hosting same-origin dengan server. Di-SET absolut (mis. `http://127.0.0.1:8787`)
 * untuk shell desktop **Tauri**: webview memuat aset dari custom protocol (`tauri://localhost`),
 * sehingga URL relatif tak akan menjangkau orchestrator lokal. Build-time via `VITE_API_BASE_URL`
 * (trailing slash dibuang). Server sudah kirim CORS `*` default → request lintas-origin diizinkan.
 */
export const SERVER_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "") || "";

const BASE = `${SERVER_URL}/api`;

/**
 * Token bearer opsional (BUG-107/CR-101). Bila server dilindungi `API_AUTH_TOKEN`, web HARUS
 * mengirim `Authorization: Bearer <token>`. Token build-time via `VITE_API_AUTH_TOKEN`.
 * CATATAN keamanan: token ini ter-embed di bundle web → hanya cocok untuk dev/token bersama,
 * bukan rahasia per-user. Untuk hosting publik, pakai reverse-proxy/login (lihat docs).
 */
export const AUTH_TOKEN: string | undefined =
  (import.meta.env?.VITE_API_AUTH_TOKEN as string | undefined)?.trim() || undefined;

function authHeaders(): Record<string, string> {
  return AUTH_TOKEN ? { authorization: `Bearer ${AUTH_TOKEN}` } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ?? "";
    } catch {
      /* abaikan body non-JSON */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });

export const api = {
  // Katalog
  listTemplates: () => req<DepartmentTemplate[]>("/templates"),
  listSkills: () => req<SkillCatalogEntry[]>("/skills"),

  // Company
  listCompanies: () => req<Company[]>("/companies"),
  getCompany: (id: string) => req<Company>(`/companies/${id}`),
  createCompany: (input: { name: string; branding?: Record<string, unknown> }) =>
    req<Company>("/companies", { method: "POST", ...body(input) }),
  deleteCompany: (id: string) =>
    req<{ deleted: boolean }>(`/companies/${id}`, { method: "DELETE" }),
  getWorld: (id: string) => req<WorldSnapshot>(`/companies/${id}/world`),
  listTasks: (id: string) => req<Task[]>(`/companies/${id}/tasks`),
  listArtifacts: (id: string) => req<Artifact[]>(`/companies/${id}/artifacts`),
  listDirectives: (id: string) => req<Directive[]>(`/companies/${id}/directives`),
  listComms: (id: string) => req<CommsMessage[]>(`/companies/${id}/comms`),
  // Audit log (Phase 4.3) — jejak aksi & approval.
  listAudit: (id: string) => req<AuditEntry[]>(`/companies/${id}/audit`),
  // KPI dashboard (Phase 5.4) — biaya + aktivitas + status agent.
  getKpi: (id: string) => req<KpiReport>(`/companies/${id}/kpi`),

  // Floor
  listFloors: (companyId: string) => req<Floor[]>(`/companies/${companyId}/floors`),
  createFloor: (companyId: string, input: { name: string; mapKey?: string }) =>
    req<Floor>(`/companies/${companyId}/floors`, { method: "POST", ...body(input) }),
  deleteFloor: (id: string) => req<{ deleted: boolean }>(`/floors/${id}`, { method: "DELETE" }),

  // Department
  listDepartments: (floorId: string) => req<Department[]>(`/floors/${floorId}/departments`),
  createDepartment: (
    floorId: string,
    input: {
      templateId?: string;
      name?: string;
      purpose?: string;
      skillPool?: string[];
      workflowId?: string;
    },
  ) =>
    req<CreateDepartmentResult>(`/floors/${floorId}/departments`, {
      method: "POST",
      ...body(input),
    }),
  updateDepartment: (
    id: string,
    patch: Partial<Pick<Department, "name" | "purpose" | "skillPool" | "workflowId">>,
  ) => req<Department>(`/departments/${id}`, { method: "PATCH", ...body(patch) }),
  deleteDepartment: (id: string) =>
    req<{ deleted: boolean }>(`/departments/${id}`, { method: "DELETE" }),
  getWorkflow: (departmentId: string) =>
    req<WorkflowDef | null>(`/departments/${departmentId}/workflow`),

  // Agent (AgentProfile)
  listAgents: (departmentId: string) => req<AgentProfile[]>(`/departments/${departmentId}/agents`),
  createAgent: (departmentId: string, input: NewAgentInput) =>
    req<AgentProfile>(`/departments/${departmentId}/agents`, { method: "POST", ...body(input) }),
  updateAgent: (id: string, patch: Partial<NewAgentInput & { status: AgentProfile["status"] }>) =>
    req<AgentProfile>(`/agents/${id}`, { method: "PATCH", ...body(patch) }),
  deleteAgent: (id: string) => req<{ deleted: boolean }>(`/agents/${id}`, { method: "DELETE" }),

  // Directive → Task → Agent (Phase 2.3): kirim arahan ke satu karakter.
  sendDirective: (agentId: string, text: string) =>
    req<{ directive: Directive; task: Task }>(`/agents/${agentId}/directives`, {
      method: "POST",
      ...body({ text }),
    }),

  // Workflow departemen (Phase 3): arahan ke departemen → pipeline semua role.
  sendDepartmentDirective: (departmentId: string, text: string) =>
    req<{ directive: Directive; run: WorkflowRun }>(`/departments/${departmentId}/directives`, {
      method: "POST",
      ...body({ text }),
    }),
  listRuns: (companyId: string) => req<WorkflowRun[]>(`/companies/${companyId}/runs`),
  resolveApproval: (approvalId: string, decision: "approve" | "revise", note?: string) =>
    req<{ run: WorkflowRun }>(`/approvals/${approvalId}`, {
      method: "POST",
      ...body(note ? { decision, note } : { decision }),
    }),
};

/** Field form Character Editor (kirim ke createAgent/updateAgent). */
export interface NewAgentInput {
  name: string;
  role: string;
  deskPos: Vec2;
  spriteKey: string;
  description: string;
  skillScope: string[];
  guardrails: Guardrail[];
  commsHandle?: string;
  modelPolicy?: ModelPolicy;
}
