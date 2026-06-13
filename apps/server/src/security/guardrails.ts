/**
 * Guardrail enforcement (Phase 4.4, plan §8) — penegakan KODE (bukan sekadar teks prompt)
 * untuk aksi eksternal berisiko: rate limit, jam posting, least-privilege.
 *
 * Dipakai engine sebagai chokepoint sebelum mengeksekusi skill `risky` di segmen pasca-approval:
 * gate workflow = persetujuan owner, guardrail = batas teknis tambahan (mis. jangan posting >5x/hari,
 * jangan posting di luar jam). Fungsi di sini PURE → mudah diuji deterministik.
 */

import type { AgentProfile, Guardrail } from "@vc/shared";

export interface GuardrailVerdict {
  ok: boolean;
  reason?: string;
}

/** Aksi yang dihitung sebagai "posting eksternal" (untuk rate-limit). */
export const EXTERNAL_POST_ACTIONS: readonly string[] = ["ig_post", "twitter_post", "schedule_post"];

/** Jendela rate-limit default = 24 jam (ms). */
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function findRule(guardrails: Guardrail[], rule: string): Guardrail | undefined {
  return guardrails.find((g) => g.rule === rule);
}

function numParam(g: Guardrail | undefined, key: string): number | undefined {
  const v = g?.params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Jam posting: guardrail `posting_hours { from, to }` (jam lokal 0..23). Mendukung jendela
 * normal (from < to) maupun melewati tengah malam (from > to). Tanpa guardrail → selalu OK.
 */
export function checkPostingHours(guardrails: Guardrail[], nowMs: number): GuardrailVerdict {
  const g = findRule(guardrails, "posting_hours");
  if (!g) return { ok: true };
  const from = numParam(g, "from");
  const to = numParam(g, "to");
  if (from === undefined || to === undefined) return { ok: true }; // params tak lengkap → abaikan.
  const hour = new Date(nowMs).getHours();
  const inWindow = from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  if (inWindow) return { ok: true };
  return {
    ok: false,
    reason: `di luar jam posting yang diizinkan (${from}:00–${to}:00, sekarang jam ${hour}:00)`,
  };
}

/**
 * Rate limit: guardrail `rate_limit { maxPostsPerDay }`. `recentPostCount` = jumlah posting
 * agent dalam jendela 24 jam (dihitung caller dari audit). Tanpa guardrail → selalu OK.
 */
export function checkRateLimit(guardrails: Guardrail[], recentPostCount: number): GuardrailVerdict {
  const g = findRule(guardrails, "rate_limit");
  const max = numParam(g, "maxPostsPerDay");
  if (max === undefined) return { ok: true };
  if (recentPostCount >= max) {
    return {
      ok: false,
      reason: `rate limit tercapai (${recentPostCount}/${max} posting dalam 24 jam)`,
    };
  }
  return { ok: true };
}

export interface EvaluateContext {
  now: number;
  recentPostCount: number;
}

/** Evaluasi seluruh guardrail relevan untuk aksi posting. Kembalikan kegagalan PERTAMA. */
export function evaluateGuardrails(agent: AgentProfile, ctx: EvaluateContext): GuardrailVerdict {
  const hours = checkPostingHours(agent.guardrails, ctx.now);
  if (!hours.ok) return hours;
  const rate = checkRateLimit(agent.guardrails, ctx.recentPostCount);
  if (!rate.ok) return rate;
  return { ok: true };
}
