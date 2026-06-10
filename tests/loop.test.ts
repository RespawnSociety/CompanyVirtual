import { describe, it, expect } from "vitest";
import type {
  AgentEvent,
  AgentProfile,
  ChatResponse,
  MemoryItem,
  RouterClient,
  Skill,
} from "@vc/shared";
import {
  InMemoryMemoryStore,
  MockRouterClient,
  SkillRegistry,
  createWebSearchSkill,
  makeSeqIdGen,
  runAgentLoop,
  textResponse,
  toolCallResponse,
} from "@vc/agent-runtime";

function agentWith(skillScope: string[]): AgentProfile {
  return {
    id: "a1",
    departmentId: "d1",
    name: "Tester",
    role: "QA",
    deskPos: { x: 0, y: 0 },
    spriteKey: "x",
    description: "Agent uji.",
    skillScope,
    guardrails: [],
    memoryNamespace: "test",
    status: "idle",
  };
}

const fixedDeps = () => ({
  now: () => 1000,
  genId: makeSeqIdGen(),
});

describe("runAgentLoop", () => {
  it("think→act: panggil web_search lalu balas; memory tersimpan", async () => {
    const skills = new SkillRegistry().register(createWebSearchSkill());
    const memory = new InMemoryMemoryStore();
    const router = new MockRouterClient([
      toolCallResponse("web_search", { query: "tren 2026", limit: 2 }),
      textResponse("Ringkasan selesai."),
    ]);

    const res = await runAgentLoop(agentWith(["web_search"]), "cari tren 2026", {
      router,
      skills,
      memory,
      ...fixedDeps(),
    });

    expect(res.status).toBe("done");
    expect(res.finalText).toBe("Ringkasan selesai.");
    expect(res.steps).toBe(2);
    expect(res.toolRuns).toEqual([{ skill: "web_search", ok: true }]);
    // observation + result.
    expect(res.memoryWritten).toHaveLength(2);
    expect(await memory.list("test")).toHaveLength(2);
  });

  it("aksi berisiko tanpa approval → blocked, handler tidak dijalankan", async () => {
    let executed = false;
    const riskySkill: Skill = {
      name: "publish",
      description: "Publikasikan konten (berisiko).",
      paramsSchema: { type: "object", properties: {} },
      risky: true,
      handler: () => {
        executed = true;
        return Promise.resolve({ ok: true });
      },
    };
    const skills = new SkillRegistry().register(riskySkill);
    const memory = new InMemoryMemoryStore();
    const router = new MockRouterClient([toolCallResponse("publish", { text: "halo dunia" })]);

    const res = await runAgentLoop(agentWith(["publish"]), "publish sekarang", {
      router,
      skills,
      memory,
      ...fixedDeps(),
    });

    expect(res.status).toBe("blocked");
    expect(executed).toBe(false);
    expect(res.pendingApproval?.status).toBe("pending");
    expect(res.toolRuns[0]).toMatchObject({ skill: "publish", ok: false });
  });

  it("tool di luar skillScope ditolak (defense-in-depth)", async () => {
    const skills = new SkillRegistry().register(createWebSearchSkill());
    const memory = new InMemoryMemoryStore();
    // Model mencoba panggil web_search, tapi agent tidak punya skill itu di scope.
    const router = new MockRouterClient([
      toolCallResponse("web_search", { query: "x" }),
      textResponse("oke."),
    ]);

    const res = await runAgentLoop(agentWith([]), "coba", {
      router,
      skills,
      memory,
      ...fixedDeps(),
    });

    expect(res.toolRuns[0]).toMatchObject({ skill: "web_search", ok: false });
    expect(res.status).toBe("done");
  });

  it("BUG-002: dua tool_calls dalam satu respons → risky pending PAUSE, tool berikutnya tak jalan", async () => {
    let safeExecuted = false;
    const riskySkill: Skill = {
      name: "publish",
      description: "Publikasikan konten (berisiko).",
      paramsSchema: { type: "object", properties: {} },
      risky: true,
      handler: () => Promise.resolve({ ok: true }),
    };
    const safeSkill: Skill = {
      name: "safe_note",
      description: "Catatan aman (non-risky).",
      paramsSchema: { type: "object", properties: {} },
      risky: false,
      handler: () => {
        safeExecuted = true;
        return Promise.resolve({ ok: true });
      },
    };
    const skills = new SkillRegistry().register(riskySkill).register(safeSkill);
    const memory = new InMemoryMemoryStore();
    // Satu respons assistant dengan DUA tool_calls: risky dulu, lalu safe.
    const twoCalls: ChatResponse = {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "publish", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "safe_note", arguments: "{}" } },
        ],
      },
      finishReason: "tool_calls",
      model: "mock-model",
      tierUsed: "free",
    };
    const router = new MockRouterClient([twoCalls]);

    const res = await runAgentLoop(agentWith(["publish", "safe_note"]), "lakukan dua hal", {
      router,
      skills,
      memory,
      ...fixedDeps(),
    });

    expect(res.status).toBe("blocked");
    expect(safeExecuted).toBe(false);
    // Hanya tool pertama (publish) yang sempat diproses sebelum pause.
    expect(res.toolRuns).toHaveLength(1);
    expect(res.toolRuns[0]).toMatchObject({ skill: "publish", ok: false });
  });

  it("BUG-003: router throw → tidak tersangkut 'working'; emit error lalu idle", async () => {
    const skills = new SkillRegistry();
    const memory = new InMemoryMemoryStore();
    const router: RouterClient = { chat: () => Promise.reject(new Error("router down")) };
    const events: AgentEvent[] = [];

    await expect(
      runAgentLoop(agentWith([]), "halo", {
        router,
        skills,
        memory,
        emit: (e) => events.push(e),
        ...fixedDeps(),
      }),
    ).rejects.toThrow("router down");

    const statuses = events.flatMap((e) => (e.type === "status" ? [e.status] : []));
    expect(statuses[0]).toBe("working");
    expect(statuses.at(-1)).toBe("idle");
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("CR-004: skill_start membawa args ringkas", async () => {
    const skills = new SkillRegistry().register(createWebSearchSkill());
    const memory = new InMemoryMemoryStore();
    const router = new MockRouterClient([
      toolCallResponse("web_search", { query: "tren 2026", limit: 2 }),
      textResponse("ok."),
    ]);
    const events: AgentEvent[] = [];

    await runAgentLoop(agentWith(["web_search"]), "cari", {
      router,
      skills,
      memory,
      emit: (e) => events.push(e),
      ...fixedDeps(),
    });

    const start = events.find((e) => e.type === "skill_start");
    expect(start?.type).toBe("skill_start");
    if (start?.type === "skill_start") {
      expect(start.args).toMatchObject({ query: "tren 2026", limit: 2 });
    }
  });

  it("CR-002: memory panjang di-truncate saat dimasukkan ke prompt", async () => {
    const skills = new SkillRegistry();
    const memory = new InMemoryMemoryStore();
    const long = "x".repeat(5000);
    await memory.add("test", {
      id: "m1",
      agentId: "a1",
      kind: "observation",
      text: long,
      createdAt: 1,
      importance: 1,
      tags: [],
    } satisfies MemoryItem);
    const router = new MockRouterClient([textResponse("ok.")]);

    await runAgentLoop(agentWith([]), "halo", {
      router,
      skills,
      memory,
      memoryItemMaxChars: 100,
      ...fixedDeps(),
    });

    const systemPrompt = router.requests[0]!.messages[0]!.content ?? "";
    // 5000 char tidak boleh utuh masuk prompt; budget 100 + dekorasi → jauh di bawah 5000.
    expect(systemPrompt.length).toBeLessThan(500);
    expect(systemPrompt).not.toContain(long);
  });
});
