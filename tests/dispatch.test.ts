import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { AgentEvent, AgentProfile, ApprovalRequest, SkillContext } from "@vc/shared";
import { DirectiveDispatcher, type ConfigStore } from "@vc/server";
import {
  SkillRegistry,
  createWriteContentSkill,
  createWebSearchSkill,
  MockRouterClient,
  textResponse,
  toolCallResponse,
} from "@vc/agent-runtime";
import { createTestStore, resetTestDb } from "./helpers/mysql.js";

const EMPTY_VAULT = { get: () => Promise.resolve(undefined), has: () => Promise.resolve(false) };
const pendingApproval = (): Promise<ApprovalRequest> =>
  Promise.resolve({ id: "appr", summary: "", artifactId: "appr", channel: "whatsapp", status: "pending" });

/** Buat company → floor → dept → 1 agent (Script Maker, scope write_content). */
async function seedAgent(store: ConfigStore, skillScope = ["write_content", "web_search"]): Promise<AgentProfile> {
  const c = await store.createCompany({ name: "Runtime Co" });
  const f = await store.createFloor(c.id, { name: "L1" });
  const d = await store.createDepartment(c.id, f.id, { name: "Mkt", purpose: "p" });
  return store.createAgent(d.id, {
    name: "Penulis",
    role: "Script Maker",
    deskPos: { x: 2, y: 2 },
    spriteKey: "default",
    description: "Penulis konten.",
    skillScope,
    guardrails: [],
  });
}

describe("Phase 2.2 — skill write_content (via 9Router/mock)", () => {
  it("menghasilkan konten dari brief; LLM dipanggil sekali", async () => {
    const router = new MockRouterClient([textResponse("Diskon 50% hari ini, jangan sampai kelewat!")]);
    const ctx: SkillContext = {
      agentId: "a1",
      router,
      vault: EMPTY_VAULT,
      emit: () => {},
      requestApproval: pendingApproval,
    };
    const skill = createWriteContentSkill();
    const out = await skill.handler({ brief: "tulis caption promo diskon", format: "caption" }, ctx);
    expect(out.format).toBe("caption");
    expect(out.content).toBe("Diskon 50% hari ini, jangan sampai kelewat!");
    expect(router.callCount).toBe(1);
    // skill non-risky
    expect(skill.risky).toBe(false);
  });

  it("brief kosong → error", async () => {
    const router = new MockRouterClient([textResponse("x")]);
    const ctx: SkillContext = { agentId: "a1", router, vault: EMPTY_VAULT, emit: () => {}, requestApproval: pendingApproval };
    await expect(createWriteContentSkill().handler({ brief: "  " }, ctx)).rejects.toThrow(/brief/);
  });
});

describe("Phase 2.1+2.3+2.5 — DirectiveDispatcher (directive → task → artifact)", () => {
  let store: ConfigStore;

  beforeAll(async () => {
    store = await createTestStore();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await store.close();
  });

  it("balasan langsung → Artifact tersimpan, task & directive done, memory persisten, event teremit", async () => {
    const agent = await seedAgent(store);
    const router = new MockRouterClient([textResponse("Caption final: Promo spesial hari ini!")]);
    const memory = store.createMemoryStore();
    const events: AgentEvent[] = [];

    const dispatcher = new DirectiveDispatcher({
      store,
      router,
      skills: new SkillRegistry().registerAll([createWriteContentSkill(), createWebSearchSkill()]),
      memory,
      emitAgentEvent: (_companyId, e) => events.push(e),
    });

    const { directive, task, done } = await dispatcher.dispatchToAgent(agent.id, "buatkan caption promo", "ui");
    expect(directive.status).toBe("in_progress");
    expect(task.status).toBe("in_progress");

    const outcome = await done;
    expect(outcome.status).toBe("done");
    expect(outcome.artifact?.content).toBe("Caption final: Promo spesial hari ini!");

    // Task & directive ter-update di DB.
    const storedTask = (await store.getTask(task.id))!;
    expect(storedTask.status).toBe("done");
    expect(storedTask.outputRef).toBe(outcome.artifact!.id);
    expect((await store.getDirective(directive.id))!.status).toBe("done");

    // Artifact muncul di listing company & task.
    const arts = await store.listArtifactsByTask(task.id);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe("content");

    // Memory persisten: minimal observation arahan tersimpan untuk namespace agent.
    const mem = await memory.list(agent.memoryNamespace);
    expect(mem.length).toBeGreaterThanOrEqual(1);
    expect(mem.some((m) => m.kind === "observation")).toBe(true);

    // Event animasi: status working lalu idle teremit (2.4).
    const statuses = events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status);
    expect(statuses).toContain("working");
    expect(statuses).toContain("idle");

    // BUG-110: event task_update POST-persist teremit dengan status `done` (sinyal andal UI).
    expect(events.some((e) => e.type === "task_update" && e.status === "done")).toBe(true);
  });

  it("BUG-111: router error → task & directive sama-sama `blocked`", async () => {
    const agent = await seedAgent(store);
    const router = new MockRouterClient([
      () => {
        throw new Error("router down");
      },
    ]);
    const dispatcher = new DirectiveDispatcher({
      store,
      router,
      skills: new SkillRegistry().registerAll([createWriteContentSkill()]),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });
    const { directive, task, done } = await dispatcher.dispatchToAgent(agent.id, "halo", "ui");
    const outcome = await done;
    expect(outcome.status).toBe("error");
    expect((await store.getTask(task.id))!.status).toBe("blocked");
    expect((await store.getDirective(directive.id))!.status).toBe("blocked");
  });

  it("agent memanggil write_content → konten masuk transkrip, artifact dari balasan final", async () => {
    const agent = await seedAgent(store);
    // 1) model minta tool write_content → 2) skill panggil LLM (isi konten) → 3) balasan final.
    const router = new MockRouterClient([
      toolCallResponse("write_content", { brief: "caption diskon", format: "caption" }),
      textResponse("Diskon 50% hari ini!"),
      textResponse("Berikut caption final: Diskon 50% hari ini!"),
    ]);
    const dispatcher = new DirectiveDispatcher({
      store,
      router,
      skills: new SkillRegistry().registerAll([createWriteContentSkill(), createWebSearchSkill()]),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });

    const { task, done } = await dispatcher.dispatchToAgent(agent.id, "tulis caption diskon", "ui");
    const outcome = await done;
    expect(outcome.status).toBe("done");
    expect(outcome.finalText).toContain("Diskon 50%");
    const arts = await store.listArtifactsByTask(task.id);
    expect(arts).toHaveLength(1);
  });

  it("agent tak ditemukan → throw", async () => {
    const dispatcher = new DirectiveDispatcher({
      store,
      router: new MockRouterClient([textResponse("x")]),
      skills: new SkillRegistry(),
      memory: store.createMemoryStore(),
      emitAgentEvent: () => {},
    });
    await expect(dispatcher.dispatchToAgent("ag_tidakada", "halo", "ui")).rejects.toThrow(/tidak ditemukan/);
  });
});
