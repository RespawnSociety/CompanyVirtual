/**
 * Pintu masuk router. SEMUA panggilan LLM platform lewat sini → 9Router.
 */

import type { ModelTier, RouterClient } from "@vc/shared";
import { NineRouterClient } from "./nineRouter.js";
import { ThrottledRouterClient } from "./throttle.js";
import type { NineRouterConfig, TierModelMap } from "./types.js";

export { NineRouterClient, RouterError } from "./nineRouter.js";
export { DEFAULT_FALLBACK_ORDER } from "./types.js";
export type { NineRouterConfig, TierModelMap } from "./types.js";
export { MockRouterClient, textResponse, toolCallResponse } from "./mock.js";
export type { MockResponder } from "./mock.js";
export { ThrottledRouterClient } from "./throttle.js";
export type { ThrottleOptions } from "./throttle.js";

/** Sumber env yang dibaca factory (default: process.env). */
export type EnvSource = Record<string, string | undefined>;

/**
 * Bangun RouterClient dari environment.
 *
 * Variabel:
 *  - NINEROUTER_BASE_URL (default http://localhost:20128/v1)
 *  - NINEROUTER_API_KEY (opsional)
 *  - NINEROUTER_MODEL_SUBSCRIPTION | _CHEAP | _FREE (model per tier)
 *  - NINEROUTER_TIER_COOLDOWN_MS (Phase 5.5; default 30000 — lewati tier yang baru gagal)
 *  - LLM_MAX_CONCURRENCY (Phase 5.5; default 4 — batas panggilan bersamaan)
 *  - LLM_MIN_INTERVAL_MS (Phase 5.5; default 0 — jarak min antar-awal panggilan)
 *
 * Bila throttle aktif (concurrency < ∞ atau interval > 0), klien dibungkus ThrottledRouterClient.
 */
export function createRouterFromEnv(env: EnvSource = process.env): RouterClient {
  const models: TierModelMap = {};
  const sub = env.NINEROUTER_MODEL_SUBSCRIPTION?.trim();
  const cheap = env.NINEROUTER_MODEL_CHEAP?.trim();
  const free = env.NINEROUTER_MODEL_FREE?.trim();
  if (sub) models.subscription = sub;
  if (cheap) models.cheap = cheap;
  if (free) models.free = free;

  const num = (v: string | undefined, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = Number(v.trim());
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const config: NineRouterConfig = {
    baseUrl: env.NINEROUTER_BASE_URL?.trim() || "http://localhost:20128/v1",
    models,
    tierCooldownMs: num(env.NINEROUTER_TIER_COOLDOWN_MS, 30_000),
    ...(env.NINEROUTER_API_KEY?.trim()
      ? { apiKey: env.NINEROUTER_API_KEY.trim() }
      : {}),
  };
  const base = new NineRouterClient(config);

  const maxConcurrency = num(env.LLM_MAX_CONCURRENCY, 4);
  const minIntervalMs = num(env.LLM_MIN_INTERVAL_MS, 0);
  // Escape hatch: LLM_MAX_CONCURRENCY=0 DAN LLM_MIN_INTERVAL_MS=0 → tanpa throttle (klien apa adanya).
  if (maxConcurrency <= 0 && minIntervalMs <= 0) return base;
  return new ThrottledRouterClient(base, {
    // maxConcurrency=0 (dengan interval>0) → konkurensi tak dibatasi, hanya jarak antar-awal.
    maxConcurrency: maxConcurrency > 0 ? maxConcurrency : Number.MAX_SAFE_INTEGER,
    minIntervalMs,
  });
}

/** Tier valid (untuk validasi input dari konfigurasi). */
export const MODEL_TIERS: readonly ModelTier[] = ["subscription", "cheap", "free"];
