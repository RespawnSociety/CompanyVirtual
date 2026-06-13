/**
 * Phase 4.4 — Guardrails (penegakan kode): jam posting & rate limit. Fungsi pure → deterministik.
 */

import { describe, it, expect } from "vitest";
import type { AgentProfile, Guardrail } from "@vc/shared";
import { checkPostingHours, checkRateLimit, evaluateGuardrails } from "@vc/server";

/** Epoch ms untuk jam lokal tertentu (hari tetap, agar deterministik lintas-zona via getHours). */
function atLocalHour(hour: number): number {
  return new Date(2026, 0, 1, hour, 0, 0, 0).getTime();
}

describe("Phase 4.4 — guardrails", () => {
  it("posting_hours: di dalam jendela OK, di luar diblokir", () => {
    const g: Guardrail[] = [{ rule: "posting_hours", params: { from: 8, to: 22 } }];
    expect(checkPostingHours(g, atLocalHour(10)).ok).toBe(true);
    expect(checkPostingHours(g, atLocalHour(8)).ok).toBe(true);
    const blocked = checkPostingHours(g, atLocalHour(23));
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/jam posting/);
    expect(checkPostingHours(g, atLocalHour(7)).ok).toBe(false);
  });

  it("posting_hours: jendela melewati tengah malam (22→6)", () => {
    const g: Guardrail[] = [{ rule: "posting_hours", params: { from: 22, to: 6 } }];
    expect(checkPostingHours(g, atLocalHour(23)).ok).toBe(true);
    expect(checkPostingHours(g, atLocalHour(3)).ok).toBe(true);
    expect(checkPostingHours(g, atLocalHour(12)).ok).toBe(false);
  });

  it("posting_hours: tanpa guardrail / params tak lengkap → OK", () => {
    expect(checkPostingHours([], atLocalHour(3)).ok).toBe(true);
    expect(checkPostingHours([{ rule: "posting_hours", params: { from: 8 } }], atLocalHour(3)).ok).toBe(true);
  });

  it("rate_limit: di bawah batas OK, mencapai/melebihi diblokir", () => {
    const g: Guardrail[] = [{ rule: "rate_limit", params: { maxPostsPerDay: 5 } }];
    expect(checkRateLimit(g, 4).ok).toBe(true);
    const atMax = checkRateLimit(g, 5);
    expect(atMax.ok).toBe(false);
    expect(atMax.reason).toMatch(/rate limit/);
    expect(checkRateLimit(g, 9).ok).toBe(false);
    expect(checkRateLimit([], 999).ok).toBe(true); // tanpa guardrail → OK
  });

  it("evaluateGuardrails: gabungan (jam dulu, lalu rate)", () => {
    const agent = {
      guardrails: [
        { rule: "posting_hours", params: { from: 8, to: 22 } },
        { rule: "rate_limit", params: { maxPostsPerDay: 2 } },
      ] as Guardrail[],
    } as AgentProfile;
    expect(evaluateGuardrails(agent, { now: atLocalHour(10), recentPostCount: 0 }).ok).toBe(true);
    expect(evaluateGuardrails(agent, { now: atLocalHour(23), recentPostCount: 0 }).ok).toBe(false);
    expect(evaluateGuardrails(agent, { now: atLocalHour(10), recentPostCount: 2 }).ok).toBe(false);
  });
});
