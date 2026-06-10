/**
 * Spike 0.4 — agent loop minimal.
 * DoD: pesan masuk → loop think→act → 1 skill nyata (web_search) → balas; memory tersimpan.
 *
 * Default MODE MOCK (deterministik, tanpa 9Router) agar DoD bisa dibuktikan kapan saja.
 * Pakai `--live` untuk memakai 9Router asli (butuh model terkonfigurasi).
 *
 * Jalankan: `npm run spike:loop`  atau  `npm run spike:loop -- --live`
 */

import type { AgentProfile, RouterClient } from "@vc/shared";
import {
  InMemoryMemoryStore,
  MockRouterClient,
  SkillRegistry,
  createRouterFromEnv,
  createWebSearchSkill,
  textResponse,
  toolCallResponse,
} from "@vc/agent-runtime";
import { runAgentLoop } from "@vc/agent-runtime";

const LIVE = process.argv.includes("--live");

const agent: AgentProfile = {
  id: "agent-spike",
  departmentId: "dept-spike",
  name: "Riko",
  role: "Riset",
  deskPos: { x: 1, y: 1 },
  spriteKey: "researcher",
  description: "Asisten riset. Cari info terbaru dan rangkum singkat.",
  skillScope: ["web_search"],
  guardrails: [],
  memoryNamespace: "spike:loop",
  status: "idle",
};

function buildRouter(): RouterClient {
  if (LIVE) return createRouterFromEnv();
  // Mock: panggil web_search dulu, lalu balas final.
  return new MockRouterClient([
    toolCallResponse("web_search", { query: "tren konten marketing 2026", limit: 2 }),
    textResponse(
      "Ringkasan: tren 2026 menekankan video pendek, personalisasi AI, dan konten komunitas. (mock)",
    ),
  ]);
}

async function main(): Promise<void> {
  const skills = new SkillRegistry().register(createWebSearchSkill());
  const memory = new InMemoryMemoryStore();
  const router = buildRouter();

  console.log(`→ Mode: ${LIVE ? "LIVE (9Router)" : "MOCK"}`);
  const userMessage = "Tolong cari tren konten marketing 2026 dan rangkum singkat.";
  console.log(`→ Pesan: "${userMessage}"`);

  const res = await runAgentLoop(agent, userMessage, {
    router,
    skills,
    memory,
    emit: (e) => console.log(`   [event] ${e.type}${"skill" in e ? ` ${e.skill}` : ""}`),
  });

  console.log("\n--- Hasil ---");
  console.log(`status: ${res.status} (steps=${res.steps})`);
  console.log(`tool runs: ${res.toolRuns.map((t) => `${t.skill}:${t.ok ? "ok" : "fail"}`).join(", ") || "(none)"}`);
  console.log(`balasan final: ${res.finalText}`);

  const stored = await memory.list(agent.memoryNamespace);
  console.log(`memory tersimpan: ${stored.length} item`);
  for (const m of stored) console.log(`   - (${m.kind}) ${m.text}`);

  // Cek DoD.
  const usedWebSearch = res.toolRuns.some((t) => t.skill === "web_search" && t.ok);
  const ok = res.status === "done" && usedWebSearch && stored.length >= 1 && !!res.finalText;
  console.log(`\n${ok ? "✓ DoD TERPENUHI" : "✗ DoD BELUM terpenuhi"} (web_search dipakai, balas, memory tersimpan).`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exitCode = 1;
});
