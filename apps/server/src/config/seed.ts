/**
 * Seed department dari DepartmentTemplate (plan §4, §5).
 *
 * Engine GENERIK: fungsi ini membaca template sebagai DATA lalu meng-instansiasi
 * Department + Workflow + AgentProfile. Tidak ada cabang khusus "marketing".
 * Workflow di-clone dengan id baru agar tiap departemen memiliki & boleh mengedit
 * salinannya sendiri (dua dept dari template sama tidak bentrok id workflow).
 */

import { defaultGenId } from "@vc/agent-runtime";
import type { AgentProfile, Department, DepartmentTemplate, Id, WorkflowDef } from "@vc/shared";
import type { ConfigStore } from "../db/store.js";

export interface SeedDepartmentInput {
  companyId: Id;
  floorId: Id;
  template: DepartmentTemplate;
  /** Override nama departemen (default: nama template). */
  name?: string;
  /** Override purpose (default: deskripsi template). */
  purpose?: string;
}

export interface SeededDepartment {
  department: Department;
  workflow: WorkflowDef;
  agents: AgentProfile[];
}

/**
 * Clone WorkflowDef dengan id baru; remap referensi `next` antar-step.
 * `genId` memakai format id tunggal `defaultGenId(prefix)` dari agent-runtime (CR-105);
 * bisa di-override untuk test deterministik (mis. `makeSeqIdGen`).
 */
export function cloneWorkflowDef(
  def: WorkflowDef,
  genId: (prefix: string) => string = defaultGenId,
): WorkflowDef {
  const idMap = new Map<Id, Id>();
  for (const step of def.steps) idMap.set(step.id, genId("wf-step"));
  return {
    id: genId("wf"),
    name: def.name,
    steps: def.steps.map((step) => {
      const cloned = { ...step, id: idMap.get(step.id)! };
      // `next` bisa berupa id step (remap) atau token khusus (biarkan apa adanya).
      if (cloned.next && idMap.has(cloned.next)) {
        cloned.next = idMap.get(cloned.next)!;
      }
      return cloned;
    }),
  };
}

/**
 * Tata letak meja: tiap departemen menempati satu "baris" di lantai (berdasarkan
 * jumlah departemen yang sudah ada di lantai itu), agent disusun kiri→kanan.
 * Koordinat dalam satuan tile (diinterpretasi Phaser scene).
 */
function deskLayout(deptIndexOnFloor: number, roleIndex: number): { x: number; y: number } {
  return { x: 3 + roleIndex * 2, y: 4 + deptIndexOnFloor * 3 };
}

export function seedDepartmentFromTemplate(
  store: ConfigStore,
  input: SeedDepartmentInput,
  now = Date.now(),
): SeededDepartment {
  const { companyId, floorId, template } = input;

  // Baris ke berapa di lantai ini (untuk tata letak meja non-tumpang-tindih).
  const deptIndexOnFloor = store.listDepartmentsByFloor(floorId).length;

  // 1) Clone & simpan workflow default template.
  const workflow = store.upsertWorkflow(cloneWorkflowDef(template.defaultWorkflow));

  // 2) Buat department (menunjuk template asal + workflow hasil clone).
  const department = store.createDepartment(
    companyId,
    floorId,
    {
      name: input.name ?? template.name,
      purpose: input.purpose ?? template.description,
      templateId: template.id,
      skillPool: [...template.defaultSkills],
      workflowId: workflow.id,
    },
    now,
  );

  // 3) Buat satu AgentProfile per role template.
  // `now + i` agar created_at tiap agent berbeda → urutan agentIds deterministik
  // (sesuai urutan role di template), bukan acak karena tie-break pada id.
  const agents = template.roleTemplates.map((role, i) =>
    store.createAgent(
      department.id,
      {
        name: role.role,
        role: role.role,
        deskPos: deskLayout(deptIndexOnFloor, i),
        spriteKey: role.spriteKey ?? "default",
        description: role.description,
        skillScope: [...role.skillScope],
        guardrails: role.guardrails.map((g) => ({ ...g })),
      },
      now + i,
    ),
  );

  return { department, workflow, agents };
}
