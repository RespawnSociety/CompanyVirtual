/**
 * Agent loop minimal (plan §3.1) — DoD Phase 0 §0.4:
 * 1 agent, pesan → LLM via 9Router → boleh panggil skill (mis. web_search) → balas;
 * memory tersimpan.
 *
 * Loop ini GENERIK: tidak tahu departemen/role spesifik. Ia membaca persona dari
 * AgentProfile.description, tools dari skillScope, dan menjalankan apa pun yang
 * diminta model — selama skill ada di scope. Aksi berisiko ditahan approval gate.
 */

import type {
  AgentProfile,
  ApprovalDraft,
  ApprovalRequest,
  ChatMessage,
  EmitFn,
  MemoryItem,
  RouterClient,
  SkillContext,
  ToolCall,
  VaultReader,
} from "@vc/shared";
import type { SkillRegistry } from "./skills/registry.js";
import type { MemoryStore } from "./memory/store.js";
import { defaultGenId } from "./util/id.js";

/** Dependensi yang di-inject ke loop (semua testable/mock-able). */
export interface RunAgentLoopDeps {
  router: RouterClient;
  skills: SkillRegistry;
  memory: MemoryStore;
  /** Pembaca Vault; bila tidak diberi, dipakai vault kosong (no secrets). */
  vault?: VaultReader;
  emit?: EmitFn;
  /** Penengah approval untuk aksi berisiko. Tanpa ini, aksi berisiko → blocked. */
  requestApproval?: SkillContext["requestApproval"];
  now?: () => number;
  genId?: (prefix: string) => string;
  /** Batas iterasi think→act. Default 6. */
  maxSteps?: number;
  /** Batas panjang teks per memory item (saat disimpan & saat dimasukkan ke prompt). Default 500. */
  memoryItemMaxChars?: number;
  signal?: AbortSignal;
}

export interface ToolRun {
  skill: string;
  ok: boolean;
  error?: string;
}

export interface AgentLoopResult {
  status: "done" | "blocked" | "max_steps";
  /** Teks balasan final agent (null bila blocked/max_steps tanpa teks). */
  finalText: string | null;
  steps: number;
  toolRuns: ToolRun[];
  memoryWritten: MemoryItem[];
  /** Transkrip lengkap percakapan LLM (untuk inspeksi/observability). */
  messages: ChatMessage[];
  /** Diisi saat status "blocked" karena menunggu approval. */
  pendingApproval?: ApprovalRequest;
}

const EMPTY_VAULT: VaultReader = {
  get: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
};

export async function runAgentLoop(
  agent: AgentProfile,
  userMessage: string,
  deps: RunAgentLoopDeps,
): Promise<AgentLoopResult> {
  const now = deps.now ?? Date.now;
  const genId = deps.genId ?? defaultGenId;
  const emit: EmitFn = deps.emit ?? (() => {});
  const maxSteps = deps.maxSteps ?? 6;
  const memoryItemMaxChars = deps.memoryItemMaxChars ?? 500;
  const vault = deps.vault ?? EMPTY_VAULT;

  emit({ type: "status", agentId: agent.id, at: now(), status: "working" });

  // Seluruh kerja dibungkus try/catch agar status tidak tersangkut "working" bila
  // router/memory melempar (BUG-003). Saat error: emit error + status pemulihan,
  // lalu rethrow agar caller (front desk) tetap bisa membalas graceful.
  try {
    // Retrieve memory relevan sebagai konteks.
    const recalled = await deps.memory.retrieve(agent.memoryNamespace, userMessage, {
      limit: 5,
      now: now(),
    });

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(agent, recalled, memoryItemMaxChars) },
      { role: "user", content: userMessage },
    ];

    const tools = deps.skills.toToolDefinitions(agent.skillScope);

    const ctx: SkillContext = {
      agentId: agent.id,
      router: deps.router,
      vault,
      emit,
      requestApproval: deps.requestApproval ?? defaultDenyApproval(genId),
      ...(deps.signal ? { signal: deps.signal } : {}),
    };

    const toolRuns: ToolRun[] = [];
    let status: AgentLoopResult["status"] = "max_steps";
    let finalText: string | null = null;
    let pendingApproval: ApprovalRequest | undefined;
    let steps = 0;

    while (steps < maxSteps) {
      if (deps.signal?.aborted) {
        status = "blocked";
        break;
      }
      steps += 1;

      const res = await deps.router.chat({
        messages,
        ...(tools.length > 0 ? { tools, toolChoice: "auto" } : {}),
        ...(agent.modelPolicy?.tier ? { tier: agent.modelPolicy.tier } : {}),
      });

      messages.push(res.message);

      const calls = res.message.tool_calls ?? [];
      if (calls.length === 0) {
        // Tidak ada tool → selesai; ini balasan final.
        finalText = res.message.content;
        status = "done";
        if (finalText) {
          emit({ type: "message", agentId: agent.id, at: now(), to: "user", text: finalText });
        }
        break;
      }

      // Eksekusi tiap tool call.
      let blocked = false;
      for (const call of calls) {
        const outcome = await handleToolCall(call, {
          agent,
          skills: deps.skills,
          ctx,
          emit,
          now,
          genId,
        });
        toolRuns.push(outcome.run);
        messages.push(outcome.toolMessage);
        if (outcome.blockedApproval) {
          // Approval gate = titik PAUSE (plan §8 / BUG-002): begitu satu aksi
          // berisiko tertahan, JANGAN eksekusi tool berikutnya dalam batch yang
          // sama. Owner memutuskan dulu, baru loop boleh lanjut.
          blocked = true;
          pendingApproval = outcome.blockedApproval;
          break;
        }
      }

      if (blocked) {
        status = "blocked";
        break;
      }
      // Lanjut loop: model melihat hasil tool dan memutuskan langkah berikut.
    }

    // Simpan memory (observation arahan + result balasan).
    const memoryWritten = await persistMemory(agent, userMessage, finalText, deps.memory, {
      now,
      genId,
      emit,
      maxChars: memoryItemMaxChars,
    });

    emit({
      type: "status",
      agentId: agent.id,
      at: now(),
      status: status === "blocked" ? "blocked" : "idle",
    });

    return {
      status,
      finalText,
      steps,
      toolRuns,
      memoryWritten,
      messages,
      ...(pendingApproval ? { pendingApproval } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", agentId: agent.id, at: now(), message });
    emit({ type: "status", agentId: agent.id, at: now(), status: "idle" });
    throw err;
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

interface ToolCallOutcome {
  run: ToolRun;
  toolMessage: ChatMessage;
  /** Diisi bila tool berisiko & tidak di-approve → loop harus berhenti. */
  blockedApproval?: ApprovalRequest;
}

async function handleToolCall(
  call: ToolCall,
  env: {
    agent: AgentProfile;
    skills: SkillRegistry;
    ctx: SkillContext;
    emit: EmitFn;
    now: () => number;
    genId: (p: string) => string;
  },
): Promise<ToolCallOutcome> {
  const { agent, skills, ctx, emit, now } = env;
  const name = call.function.name;

  // Defense-in-depth: tool harus ada di scope agent (selain difilter saat ekspos).
  if (!agent.skillScope.includes(name)) {
    return errorOutcome(call, `Skill "${name}" di luar skillScope agent.`);
  }
  const skill = skills.get(name);
  if (!skill) {
    return errorOutcome(call, `Skill "${name}" tidak terdaftar di registry.`);
  }

  let args: Record<string, unknown>;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return errorOutcome(call, `Argumen tool bukan JSON valid: ${call.function.arguments}`);
  }

  // Approval gate (plan §8): aksi berisiko WAJIB di-approve dulu.
  if (skill.risky) {
    const draft: ApprovalDraft = {
      summary: `Aksi berisiko "${name}" dengan argumen: ${truncate(call.function.arguments, 200)}`,
    };
    const approval = await ctx.requestApproval(draft);
    if (approval.status !== "approved") {
      emit({
        type: "approval_requested",
        agentId: agent.id,
        at: now(),
        approvalId: approval.id,
        summary: draft.summary,
      });
      // Beri tahu model bahwa aksi tertahan (agar transkrip konsisten).
      return {
        run: { skill: name, ok: false, error: "menunggu approval" },
        toolMessage: toolMsg(call, `BLOCKED: menunggu approval (id=${approval.id}).`),
        blockedApproval: approval,
      };
    }
  }

  emit({ type: "skill_start", agentId: agent.id, at: now(), skill: name, args: summarizeArgs(args) });
  try {
    const result = await skill.handler(args, ctx);
    const content = JSON.stringify(result);
    emit({
      type: "skill_end",
      agentId: agent.id,
      at: now(),
      skill: name,
      ok: true,
      summary: truncate(content, 120),
    });
    return { run: { skill: name, ok: true }, toolMessage: toolMsg(call, content) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "skill_end", agentId: agent.id, at: now(), skill: name, ok: false, summary: msg });
    return errorOutcome(call, `Eror menjalankan "${name}": ${msg}`);
  }
}

function errorOutcome(call: ToolCall, message: string): ToolCallOutcome {
  return {
    run: { skill: call.function.name, ok: false, error: message },
    toolMessage: toolMsg(call, `ERROR: ${message}`),
  };
}

function toolMsg(call: ToolCall, content: string): ChatMessage {
  return {
    role: "tool",
    tool_call_id: call.id,
    name: call.function.name,
    content,
  };
}

function buildSystemPrompt(
  agent: AgentProfile,
  recalled: MemoryItem[],
  memoryItemMaxChars: number,
): string {
  const lines: string[] = [];
  lines.push(`Kamu adalah ${agent.name}, berperan sebagai ${agent.role}.`);
  if (agent.description.trim()) lines.push(agent.description.trim());

  if (agent.guardrails.length > 0) {
    lines.push("", "Batasan (guardrails) yang WAJIB dipatuhi:");
    for (const g of agent.guardrails) lines.push(`- ${g.rule}`);
  }

  if (recalled.length > 0) {
    lines.push("", "Memory relevan (konteks sebelumnya):");
    // CR-002: truncate per item agar payload prompt tidak membengkak (biaya/latency LLM).
    for (const m of recalled) lines.push(`- (${m.kind}) ${truncate(m.text, memoryItemMaxChars)}`);
  }

  lines.push(
    "",
    "Gunakan tool yang tersedia bila membantu menjawab. Untuk aksi berisiko, ajukan dulu (jangan eksekusi tanpa approval).",
    "Bila sudah cukup informasi, balas dengan jawaban final yang ringkas.",
  );
  return lines.join("\n");
}

async function persistMemory(
  agent: AgentProfile,
  userMessage: string,
  finalText: string | null,
  memory: MemoryStore,
  env: { now: () => number; genId: (p: string) => string; emit: EmitFn; maxChars: number },
): Promise<MemoryItem[]> {
  const written: MemoryItem[] = [];
  const push = async (item: MemoryItem): Promise<void> => {
    await memory.add(agent.memoryNamespace, item);
    written.push(item);
    env.emit({ type: "memory", agentId: agent.id, at: item.createdAt, memoryId: item.id, kind: item.kind });
  };

  // CR-002: simpan teks ter-truncate, bukan arahan/balasan penuh, agar memory store
  // dan prompt-injeksi berikutnya tidak tumbuh tanpa batas.
  await push({
    id: env.genId("mem"),
    agentId: agent.id,
    kind: "observation",
    text: `Arahan masuk: ${truncate(userMessage, env.maxChars)}`,
    createdAt: env.now(),
    importance: 0.5,
    tags: ["directive"],
  });

  if (finalText) {
    await push({
      id: env.genId("mem"),
      agentId: agent.id,
      kind: "result",
      text: `Balasan agent: ${truncate(finalText, env.maxChars)}`,
      createdAt: env.now(),
      importance: 0.6,
      tags: ["reply"],
    });
  }

  return written;
}

/** Approver default: selalu pending (menolak eksekusi) → loop blocked. */
function defaultDenyApproval(genId: (p: string) => string): SkillContext["requestApproval"] {
  return (draft: ApprovalDraft): Promise<ApprovalRequest> => {
    const id = genId("appr");
    return Promise.resolve({
      id,
      summary: draft.summary,
      artifactId: draft.artifactId ?? id,
      channel: "whatsapp",
      status: "pending",
    });
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Ringkas argumen tool untuk event `skill_start` (CR-004 / observability):
 * redact key yang terlihat seperti secret, truncate nilai string panjang.
 * Tujuannya cukup untuk Agent Inspector/log, bukan payload penuh.
 */
const SECRET_ARG_KEY = /(token|secret|password|api[_-]?key|authorization|credential)/i;
function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_ARG_KEY.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string") {
      out[key] = truncate(value, 120);
    } else {
      out[key] = value;
    }
  }
  return out;
}
