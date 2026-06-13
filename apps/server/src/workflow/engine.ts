/**
 * WorkflowEngine (Phase 3.3) — engine GENERIK & data-driven. Membaca `WorkflowDef` (DATA)
 * lalu menjalankan pipeline departemen: tiap step di-dispatch ke agent dengan `role` yang cocok
 * (3.1), output mengalir antar-step sebagai konteks (3.4: Manager/koordinasi lewat urutan engine).
 *
 * TIDAK ada cabang "marketing": perilaku ditentukan token `next` di WorkflowDef:
 *  - `<stepId>`        → lompat ke step itu.
 *  - `loop_until_pass` → step review; bila reviewer minta REVISI → ulang ke step konten sebelum
 *                        review (sampai `maxReviewRounds`), bila PASS → lanjut step berikutnya.
 *  - `approval_gate`   → setelah step ini, buat ApprovalRequest & PAUSE (run `awaiting_approval`);
 *                        di-resume lewat `resumeByApproval` (APPROVE → lanjut; REVISI → ulang konten).
 *  - tanpa `next`      → step terakhir; run `done`.
 *
 * State run dipersist (`workflow_runs`) agar bisa pause di approval lalu resume (3.5). Konteks
 * antar-step direkonstruksi dari `stepArtifacts` (tahan restart). Semua LLM lewat `router` → 9Router.
 */

import type {
  AgentEvent,
  AgentProfile,
  Department,
  Directive,
  DirectiveSource,
  EmitFn,
  Id,
  RouterClient,
  WorkflowRun,
  WorkflowStep,
} from "@vc/shared";
import { defaultGenId, runAgentLoop, type MemoryStore, type SkillRegistry } from "@vc/agent-runtime";
import type { ConfigStore } from "../db/store.js";

export interface WorkflowEngineDeps {
  store: ConfigStore;
  router: RouterClient;
  skills: SkillRegistry;
  memory: MemoryStore;
  emitAgentEvent: (companyId: Id, event: AgentEvent) => void;
  now?: () => number;
  genId?: (prefix: string) => string;
  /** Maksimum putaran revisi pada loop_until_pass (default 2). */
  maxReviewRounds?: number;
  /** Batas step total (jaga-jaga anti loop tak henti). Default 24. */
  maxSteps?: number;
}

export type ApprovalDecision = "approve" | "revise";

export interface StartWorkflowResult {
  directive: Directive;
  run: WorkflowRun;
  /** Resolve saat run selesai/pause (untuk test/menunggu). */
  done: Promise<WorkflowRun>;
}

export class WorkflowEngine {
  constructor(private readonly deps: WorkflowEngineDeps) {}

  /** True bila department punya workflow → boleh dijalankan engine. */
  async departmentHasWorkflow(departmentId: Id): Promise<boolean> {
    const dept = await this.deps.store.getDepartment(departmentId);
    return !!dept?.workflowId && !!(await this.deps.store.getWorkflow(dept.workflowId));
  }

  /**
   * Mulai workflow untuk sebuah directive di departemen. Membuat Directive + WorkflowRun,
   * lalu menjalankan pipeline di latar belakang. Mengembalikan entitas + `done`.
   */
  async startForDepartment(
    departmentId: Id,
    text: string,
    source: DirectiveSource,
  ): Promise<StartWorkflowResult> {
    const { store } = this.deps;
    const dept = await store.getDepartment(departmentId);
    if (!dept) throw new Error(`Department tidak ditemukan: ${departmentId}`);
    if (!dept.workflowId) throw new Error(`Department ${departmentId} belum punya workflow`);
    const workflow = await store.getWorkflow(dept.workflowId);
    if (!workflow) throw new Error(`Workflow tidak ditemukan: ${dept.workflowId}`);
    if (workflow.steps.length === 0) throw new Error(`Workflow ${workflow.id} tak punya step`);

    const directive = await store.createDirective(dept.companyId, {
      text,
      source,
      departmentId: dept.id,
      status: "in_progress",
    });
    const run = await store.createWorkflowRun({
      companyId: dept.companyId,
      directiveId: directive.id,
      departmentId: dept.id,
      workflowId: workflow.id,
      currentStepId: workflow.steps[0]!.id,
    });

    const done = this.runFrom(run.id, 0).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await store.updateDirectiveStatus(directive.id, "blocked").catch(() => undefined);
      const blocked =
        (await store.updateWorkflowRun(run.id, { status: "blocked" }).catch(() => undefined)) ??
        run;
      this.emit(dept.companyId, {
        type: "error",
        agentId: dept.id,
        at: (this.deps.now ?? Date.now)(),
        message: `workflow gagal: ${msg}`,
      });
      return blocked;
    });

    return { directive, run, done };
  }

  /**
   * Resume run yang `awaiting_approval`. APPROVE → lanjut dari step setelah gate.
   * REVISE → ulang dari step konten (sebelum review) dengan feedback owner.
   */
  async resumeByApproval(
    approvalId: Id,
    decision: ApprovalDecision,
    note?: string,
  ): Promise<WorkflowRun | undefined> {
    const { store } = this.deps;
    const run = await store.findWorkflowRunByApproval(approvalId);
    if (!run || run.status !== "awaiting_approval") return undefined;
    const workflow = await store.getWorkflow(run.workflowId);
    if (!workflow) return undefined;

    await store.updateDirectiveStatus(run.directiveId, "in_progress");
    const cleared =
      (await store.updateWorkflowRun(run.id, { status: "running", approvalId: null })) ?? run;

    if (decision === "approve") {
      const idx = workflow.steps.findIndex((s) => s.id === cleared.currentStepId);
      // currentStepId = step SETELAH gate; bila tak ada (gate di akhir) → langsung selesai.
      if (idx < 0) return this.finish(cleared.id, run.directiveId);
      return this.runFrom(cleared.id, idx, note);
    }
    // revise → ulang dari step konten dengan feedback.
    return this.runFrom(cleared.id, contentStepIndex(workflow.steps), note);
  }

  // ---------------- internal ----------------

  private emit(companyId: Id, event: AgentEvent): void {
    this.deps.emitAgentEvent(companyId, event);
  }

  /** Jalankan pipeline mulai indeks `startIndex`. `note` = feedback (revisi) untuk step pertama. */
  private async runFrom(runId: Id, startIndex: number, note?: string): Promise<WorkflowRun> {
    const { store } = this.deps;
    const maxReviewRounds = this.deps.maxReviewRounds ?? 2;
    const hardCap = this.deps.maxSteps ?? 24;

    let run = (await store.getWorkflowRun(runId))!;
    const dept = (await store.getDepartment(run.departmentId))!;
    const workflow = (await store.getWorkflow(run.workflowId))!;
    const steps = workflow.steps;

    // Konteks antar-step direkonstruksi dari artifact yang sudah tersimpan (tahan resume/restart).
    const context = await this.rebuildContext(run);
    let pendingNote = note;
    let i = startIndex;
    let guard = 0;

    while (i >= 0 && i < steps.length) {
      if (guard++ > hardCap) throw new Error(`workflow melebihi batas ${hardCap} langkah (loop?)`);
      const step = steps[i]!;
      await store.updateWorkflowRun(run.id, { currentStepId: step.id });

      const out = await this.runStep(dept, step, run, context, pendingNote);
      pendingNote = undefined;
      context.set(step.role, out.finalText);
      run = out.run;

      // Tentukan langkah berikutnya dari token `next`.
      if (step.next === "approval_gate") {
        return this.pauseForApproval(dept, run, steps, i, out.finalText);
      }
      if (step.next === "loop_until_pass") {
        const revise = /revisi/i.test(out.finalText) && !/^\s*(pass|lolos|layak)\b/i.test(out.finalText);
        if (revise) {
          if (run.reviewRounds < maxReviewRounds) {
            run = (await store.updateWorkflowRun(run.id, { reviewRounds: run.reviewRounds + 1 }))!;
            pendingNote = `Revisi dari ${step.role}: ${out.finalText}`;
            i = contentStepIndex(steps); // ulang dari step konten
            continue;
          }
          // BUG-112: kuota revisi habis TAPI reviewer masih menolak → JANGAN diam-diam lanjut ke
          // approval (konten belum lolos). Tandai blocked + beri tahu owner.
          return this.blockRun(
            run,
            dept,
            `kuota revisi (${maxReviewRounds}) habis tapi ${step.role} masih minta REVISI: ${truncate(out.finalText, 300)}`,
          );
        }
        i += 1; // PASS → lanjut
        continue;
      }
      if (typeof step.next === "string") {
        const jump = steps.findIndex((s) => s.id === step.next);
        i = jump >= 0 ? jump : steps.length; // id tak dikenal → selesai
        continue;
      }
      i += 1; // tanpa next → maju; bila habis, loop berhenti → selesai
    }

    return this.finish(run.id, run.directiveId);
  }

  /** Jalankan satu step: agent loop role terkait → Task + Artifact, emit event. */
  private async runStep(
    dept: Department,
    step: WorkflowStep,
    run: WorkflowRun,
    context: Map<string, string>,
    note: string | undefined,
  ): Promise<{ finalText: string; run: WorkflowRun }> {
    const { store } = this.deps;
    const now = this.deps.now ?? Date.now;
    const agent = await this.resolveAgentForRole(dept.id, step.role);
    if (!agent) throw new Error(`Tak ada agent untuk role '${step.role}' di dept ${dept.id}`);

    const task = await store.createTask({
      companyId: dept.companyId,
      directiveId: run.directiveId,
      departmentId: dept.id,
      title: `${step.role}: ${step.action}`,
      assignee: agent.id,
      status: "in_progress",
    });

    const emit: EmitFn = (e) => this.emit(dept.companyId, e);
    const instruction = buildStepInstruction(step, await this.directiveText(run), context, note);

    let finalText = "";
    try {
      const result = await runAgentLoop(agent, instruction, {
        router: this.deps.router,
        skills: this.deps.skills,
        memory: this.deps.memory,
        emit,
        ...(this.deps.now ? { now: this.deps.now } : {}),
        ...(this.deps.genId ? { genId: this.deps.genId } : {}),
      });
      finalText = result.finalText ?? "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.updateTask(task.id, { status: "blocked" });
      emit({ type: "task_update", agentId: agent.id, at: now(), taskId: task.id, status: "blocked" });
      throw new Error(`step '${step.role}/${step.action}' gagal: ${msg}`);
    }

    const artifact = await store.addArtifact({
      taskId: task.id,
      kind: step.action,
      content: finalText,
      meta: { role: step.role, stepId: step.id, directiveId: run.directiveId },
    });
    const doneTask =
      (await store.updateTask(task.id, { status: "done", outputRef: artifact.id })) ?? task;
    const nextArtifacts = { ...run.stepArtifacts, [step.id]: artifact.id };
    const updatedRun = (await store.updateWorkflowRun(run.id, { stepArtifacts: nextArtifacts })) ?? run;
    // BUG-110: event POST-persist.
    emit({ type: "task_update", agentId: agent.id, at: now(), taskId: doneTask.id, status: "done" });
    return { finalText, run: updatedRun };
  }

  private async pauseForApproval(
    dept: Department,
    run: WorkflowRun,
    steps: WorkflowStep[],
    gateIndex: number,
    summary: string,
  ): Promise<WorkflowRun> {
    const { store } = this.deps;
    const now = this.deps.now ?? Date.now;
    // BUG-113: pakai generator id unik (uuid-based), BUKAN timestamp — dua run yang pause pada
    // milidetik sama tak boleh mendapat approvalId identik (approvalId = identity boundary keputusan owner).
    const genId = this.deps.genId ?? defaultGenId;
    const approvalId = genId("appr");
    // Step yang dijalankan SETELAH approve = step berikutnya pada array.
    const nextStep = steps[gateIndex + 1];
    const updated =
      (await store.updateWorkflowRun(run.id, {
        status: "awaiting_approval",
        approvalId,
        ...(nextStep ? { currentStepId: nextStep.id } : { currentStepId: null }),
      })) ?? run;
    await store.updateDirectiveStatus(run.directiveId, "awaiting_approval");

    const at = now();
    this.emit(dept.companyId, {
      type: "approval_requested",
      agentId: dept.id,
      at,
      approvalId,
      summary,
    });
    // Manager = "wajah": kirim ringkasan minta approval ke owner (UI/WA meneruskan).
    this.emit(dept.companyId, {
      type: "message",
      agentId: dept.id,
      at,
      to: "user",
      text:
        `Minta persetujuan (approvalId=${approvalId}):\n${summary}\n\n` +
        `Balas APPROVE untuk lanjut, atau REVISI: <alasan> untuk perbaikan.`,
    });
    return updated;
  }

  private async finish(runId: Id, directiveId: Id): Promise<WorkflowRun> {
    const { store } = this.deps;
    await store.updateDirectiveStatus(directiveId, "done");
    const done = (await store.updateWorkflowRun(runId, { status: "done", currentStepId: null }))!;
    return done;
  }

  /** Hentikan run sebagai `blocked` (perlu perhatian owner) + beri tahu lewat pesan. */
  private async blockRun(run: WorkflowRun, dept: Department, reason: string): Promise<WorkflowRun> {
    const { store } = this.deps;
    const now = this.deps.now ?? Date.now;
    await store.updateDirectiveStatus(run.directiveId, "blocked");
    const blocked =
      (await store.updateWorkflowRun(run.id, { status: "blocked", approvalId: null }))!;
    this.emit(dept.companyId, {
      type: "message",
      agentId: dept.id,
      at: now(),
      to: "user",
      text: `Workflow berhenti (perlu perhatian): ${reason}`,
    });
    return blocked;
  }

  /** Rekonstruksi konteks role→output dari artifact yang sudah tersimpan. */
  private async rebuildContext(run: WorkflowRun): Promise<Map<string, string>> {
    const ctx = new Map<string, string>();
    for (const artifactId of Object.values(run.stepArtifacts)) {
      const art = await this.deps.store.getArtifact(artifactId);
      if (!art) continue;
      const role = (art.meta?.["role"] as string) ?? art.kind;
      ctx.set(role, art.content);
    }
    return ctx;
  }

  private async directiveText(run: WorkflowRun): Promise<string> {
    const d = await this.deps.store.getDirective(run.directiveId);
    return d?.text ?? "";
  }

  /** Cari agent dengan role cocok (case-insensitive) di departemen. */
  private async resolveAgentForRole(departmentId: Id, role: string): Promise<AgentProfile | undefined> {
    const agents = await this.deps.store.listAgentsByDepartment(departmentId);
    const target = role.trim().toLowerCase();
    return agents.find((a) => a.role.trim().toLowerCase() === target);
  }
}

/** Indeks step konten yang di-loop saat revisi = step sebelum step `loop_until_pass` (atau 0). */
function contentStepIndex(steps: WorkflowStep[]): number {
  const reviewIdx = steps.findIndex((s) => s.next === "loop_until_pass");
  return reviewIdx > 0 ? reviewIdx - 1 : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Bangun instruksi step dari directive + konteks step sebelumnya + feedback (revisi). */
function buildStepInstruction(
  step: WorkflowStep,
  directiveText: string,
  context: Map<string, string>,
  note: string | undefined,
): string {
  const lines: string[] = [`Arahan owner: ${directiveText}`];
  if (context.size > 0) {
    lines.push("", "Hasil langkah sebelumnya:");
    for (const [role, text] of context) lines.push(`- [${role}] ${truncate(text, 600)}`);
  }
  if (note) lines.push("", `Catatan/feedback yang WAJIB ditindaklanjuti: ${note}`);
  lines.push("");
  if (step.next === "loop_until_pass") {
    lines.push(
      `Tugasmu (${step.action}): review output terakhir. Akhiri balasan dengan baris 'PASS' bila layak terbit, ` +
        `atau 'REVISI: <alasan singkat>' bila perlu perbaikan.`,
    );
  } else if (step.next === "approval_gate") {
    lines.push(
      `Tugasmu (${step.action}): susun ringkasan SINGKAT konten final untuk dimintakan persetujuan owner sebelum publish.`,
    );
  } else {
    lines.push(
      `Tugasmu (${step.action}): kerjakan sesuai peranmu memakai tool yang tersedia bila perlu. ` +
        `Hasilkan output final ringkas yang siap dipakai langkah berikutnya.`,
    );
  }
  return lines.join("\n");
}
