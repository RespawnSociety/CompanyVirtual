/**
 * Klien REST ke orchestrator (`/api/*`, di-proxy Vite ke Fastify).
 * Tipe respons memakai kontrak `@vc/shared` (sumber kebenaran tunggal).
 */

import type {
  AgentProfile,
  CommsMessage,
  Company,
  Department,
  DepartmentTemplate,
  Floor,
  Guardrail,
  ModelPolicy,
  Task,
  Vec2,
  WorkflowDef,
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

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
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
  listComms: (id: string) => req<CommsMessage[]>(`/companies/${id}/comms`),

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
