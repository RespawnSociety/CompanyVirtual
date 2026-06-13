/**
 * Tarif estimasi biaya LLM per tier (Phase 5.4). Token NYATA (dari 9Router `usage`) dikalikan
 * tarif per-1.000-token untuk perkiraan biaya "hari kerja". Bisa diatur lewat env.
 *
 * Catatan: tier `subscription` umumnya berlangganan FLAT (biaya marginal per-token ≈ 0) → default 0.
 * `cheap`/`free` dapat diberi tarif placeholder agar dashboard menampilkan perkiraan. Owner
 * menyetel angka nyata di `.env`. Token tetap ditampilkan apa adanya sebagai sinyal utama.
 */

import type { CostRates, ModelTier } from "@vc/shared";

/** Default: mata uang IDR, subscription/free = 0 (flat/gratis), cheap = placeholder kecil. */
export const DEFAULT_COST_RATES: CostRates = {
  currency: "IDR",
  perThousandTokens: { subscription: 0, cheap: 50, free: 0 },
};

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v.trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Baca tarif dari env:
 *  - COST_CURRENCY (default IDR)
 *  - COST_PER_1K_SUBSCRIPTION | _CHEAP | _FREE (number ≥ 0, per 1.000 token)
 */
export function costRatesFromEnv(env: NodeJS.ProcessEnv = process.env): CostRates {
  const d = DEFAULT_COST_RATES.perThousandTokens;
  const perThousandTokens: Record<ModelTier, number> = {
    subscription: num(env.COST_PER_1K_SUBSCRIPTION, d.subscription),
    cheap: num(env.COST_PER_1K_CHEAP, d.cheap),
    free: num(env.COST_PER_1K_FREE, d.free),
  };
  return {
    currency: env.COST_CURRENCY?.trim() || DEFAULT_COST_RATES.currency,
    perThousandTokens,
  };
}
