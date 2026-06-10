/**
 * Pintu masuk router. SEMUA panggilan LLM platform lewat sini → 9Router.
 */

import type { ModelTier } from "@vc/shared";
import { NineRouterClient } from "./nineRouter.js";
import type { NineRouterConfig, TierModelMap } from "./types.js";

export { NineRouterClient, RouterError } from "./nineRouter.js";
export { DEFAULT_FALLBACK_ORDER } from "./types.js";
export type { NineRouterConfig, TierModelMap } from "./types.js";
export { MockRouterClient, textResponse, toolCallResponse } from "./mock.js";
export type { MockResponder } from "./mock.js";

/** Sumber env yang dibaca factory (default: process.env). */
export type EnvSource = Record<string, string | undefined>;

/**
 * Bangun NineRouterClient dari environment.
 *
 * Variabel:
 *  - NINEROUTER_BASE_URL (default http://localhost:20128/v1)
 *  - NINEROUTER_API_KEY (opsional)
 *  - NINEROUTER_MODEL_SUBSCRIPTION | _CHEAP | _FREE (model per tier)
 */
export function createRouterFromEnv(env: EnvSource = process.env): NineRouterClient {
  const models: TierModelMap = {};
  const sub = env.NINEROUTER_MODEL_SUBSCRIPTION?.trim();
  const cheap = env.NINEROUTER_MODEL_CHEAP?.trim();
  const free = env.NINEROUTER_MODEL_FREE?.trim();
  if (sub) models.subscription = sub;
  if (cheap) models.cheap = cheap;
  if (free) models.free = free;

  const config: NineRouterConfig = {
    baseUrl: env.NINEROUTER_BASE_URL?.trim() || "http://localhost:20128/v1",
    models,
    ...(env.NINEROUTER_API_KEY?.trim()
      ? { apiKey: env.NINEROUTER_API_KEY.trim() }
      : {}),
  };
  return new NineRouterClient(config);
}

/** Tier valid (untuk validasi input dari konfigurasi). */
export const MODEL_TIERS: readonly ModelTier[] = ["subscription", "cheap", "free"];
