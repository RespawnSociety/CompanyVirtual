/**
 * DirectiveDispatcher (Phase 2.1 + 2.3) — jembatan Configuration layer ↔ Agent Runtime.
 *
 * Inilah "registry karakter↔agent": ia me-resolve `AgentProfile` (dari ConfigStore, sumber
 * kebenaran — selalu fresh agar edit Character Editor langsung berlaku, tanpa cache basi),
 * lalu menjalankan agent loop generik (`runAgentLoop`) untuk arahan tertentu.
 *
 * Alur (2.3): directive → buat Directive + Task → jalankan loop (latar belakang, emit
 * `agent:event` untuk animasi 2.4) → hasil final disimpan jadi Artifact, status Task/Directive
 * diperbarui. Semua LLM lewat `router` (→ 9Router); memory lewat MemoryStore persisten (2.5).
 */

import type {
  AgentEvent,
  AgentProfile,
  Artifact,
  Directive,
  DirectiveSource,
  EmitFn,
  Id,
  RouterClient,
  SkillContext,
  Task,
  VaultReader,
} from "@vc/shared";
import {
  runAgentLoop,
  type AgentLoopResult,
  type MemoryStore,
  type SkillRegistry,
} from "@vc/agent-runtime";
import type { ConfigStore } from "../db/store.js";
import { recordLoopUsage } from "../kpi/recordUsage.js";

export interface DispatcherDeps {
  store: ConfigStore;
  router: RouterClient;
  skills: SkillRegistry;
  memory: MemoryStore;
  /** Teruskan event agent ke RealtimeHub (animasi). */
  emitAgentEvent: (companyId: Id, event: AgentEvent) => void;
  /** Vault untuk skill yang butuh kredensial. Default kosong. */
  vault?: VaultReader;
  now?: () => number;
  genId?: (prefix: string) => string;
  maxSteps?: number;
}

/** Hasil akhir setelah loop + persist selesai. */
export interface DispatchOutcome {
  status: AgentLoopResult["status"] | "error";
  finalText: string | null;
  task: Task;
  artifact?: Artifact;
  error?: string;
}

/** Dikembalikan segera setelah Directive+Task dibuat; `done` resolve saat loop selesai. */
export interface DispatchResult {
  companyId: Id;
  directive: Directive;
  task: Task;
  done: Promise<DispatchOutcome>;
}

export class DirectiveDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  /**
   * Kirim arahan ke SATU agent (karakter). Membuat Directive + Task (status in_progress),
   * lalu menjalankan loop di latar belakang. Mengembalikan entitas yang sudah dibuat +
   * `done` (promise hasil loop) untuk yang ingin menunggu (mis. test).
   */
  async dispatchToAgent(agentId: Id, text: string, source: DirectiveSource): Promise<DispatchResult> {
    const agent = await this.deps.store.getAgent(agentId);
    if (!agent) throw new Error(`Agent tidak ditemukan: ${agentId}`);
    const dept = await this.deps.store.getDepartment(agent.departmentId);
    if (!dept) throw new Error(`Department agent tidak ditemukan: ${agent.departmentId}`);
    const companyId = dept.companyId;

    const directive = await this.deps.store.createDirective(companyId, {
      text,
      source,
      departmentId: dept.id,
      status: "in_progress",
    });
    const task = await this.deps.store.createTask({
      companyId,
      directiveId: directive.id,
      departmentId: dept.id,
      title: truncate(text, 200),
      assignee: agent.id,
      status: "in_progress",
    });

    const done = this.runAndPersist(agent, companyId, directive, task).catch(
      (err): DispatchOutcome => {
        const message = err instanceof Error ? err.message : String(err);
        return { status: "error", finalText: null, task, error: message };
      },
    );

    return { companyId, directive, task, done };
  }

  /** Jalankan loop, lalu simpan Artifact + perbarui status Task/Directive. */
  private async runAndPersist(
    agent: AgentProfile,
    companyId: Id,
    directive: Directive,
    task: Task,
  ): Promise<DispatchOutcome> {
    const { store } = this.deps;
    const now = this.deps.now ?? Date.now;
    const emit: EmitFn = (e) => this.deps.emitAgentEvent(companyId, e);
    // BUG-110: sinyal POST-persist yang andal untuk UI (artifact & status sudah tersimpan).
    const emitTaskUpdate = (t: Task): void =>
      emit({ type: "task_update", agentId: agent.id, at: now(), taskId: t.id, status: t.status });

    // Audit aksi skill (§4.3): isi companyId+agentId dari konteks dispatch.
    const audit: SkillContext["audit"] = async (draft) => {
      await store.addAuditEntry({
        companyId,
        agentId: agent.id,
        action: draft.action,
        ...(draft.approvalId ? { approvalId: draft.approvalId } : {}),
        ...(draft.detail ? { detail: draft.detail } : {}),
      });
    };

    let result: AgentLoopResult;
    try {
      result = await runAgentLoop(agent, directive.text, {
        router: this.deps.router,
        skills: this.deps.skills,
        memory: this.deps.memory,
        emit,
        audit,
        ...(this.deps.vault ? { vault: this.deps.vault } : {}),
        ...(this.deps.now ? { now: this.deps.now } : {}),
        ...(this.deps.genId ? { genId: this.deps.genId } : {}),
        ...(this.deps.maxSteps !== undefined ? { maxSteps: this.deps.maxSteps } : {}),
      });
    } catch (err) {
      // Loop rethrow saat error (BUG-003: status sudah dikembalikan ke idle via event).
      const message = err instanceof Error ? err.message : String(err);
      // BUG-111: task DAN directive jadi `blocked` (jangan tinggalkan directive `in_progress`).
      const updated = (await store.updateTask(task.id, { status: "blocked" })) ?? task;
      await store.updateDirectiveStatus(directive.id, "blocked");
      emitTaskUpdate(updated);
      return { status: "error", finalText: null, task: updated, error: message };
    }

    // Phase 5.4: catat pemakaian token (biaya). Tak boleh menggagalkan kerja → catch & log saja.
    await recordLoopUsage(
      store,
      { companyId, departmentId: agent.departmentId, agentId: agent.id },
      result.usage,
      now(),
    ).catch((e) => console.error("[kpi] recordLoopUsage:", e));

    // Selesai dengan teks final → simpan Artifact, tandai done.
    if (result.status === "done" && result.finalText) {
      const artifact = await store.addArtifact({
        taskId: task.id,
        kind: "content",
        content: result.finalText,
        meta: { agentId: agent.id, directiveId: directive.id, role: agent.role },
      });
      const updated =
        (await store.updateTask(task.id, { status: "done", outputRef: artifact.id })) ?? task;
      await store.updateDirectiveStatus(directive.id, "done");
      emitTaskUpdate(updated);
      return { status: result.status, finalText: result.finalText, task: updated, artifact };
    }

    // Tertahan approval (aksi berisiko) → awaiting_approval (alur approve = Phase 3).
    if (result.status === "blocked") {
      const updated =
        (await store.updateTask(task.id, { status: "awaiting_approval" })) ?? task;
      await store.updateDirectiveStatus(directive.id, "awaiting_approval");
      emitTaskUpdate(updated);
      return { status: result.status, finalText: result.finalText, task: updated };
    }

    // max_steps / tanpa teks final → butuh perhatian (review), tanpa artifact.
    const updated = (await store.updateTask(task.id, { status: "review" })) ?? task;
    await store.updateDirectiveStatus(directive.id, "in_progress");
    emitTaskUpdate(updated);
    return { status: result.status, finalText: result.finalText, task: updated };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
