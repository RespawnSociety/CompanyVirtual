/**
 * Konfigurasi internal router 9Router. Tipe kontrak publik (RouterClient, ChatRequest,
 * ChatResponse, dst) ada di `@vc/shared`.
 */

import type { ModelTier } from "@vc/shared";

/** Pemetaan tier → nama model konkret di 9Router. */
export type TierModelMap = Partial<Record<ModelTier, string>>;

/** Konfigurasi pembuatan NineRouterClient. */
export interface NineRouterConfig {
  /** Base URL OpenAI-compatible, mis. http://localhost:20128/v1 */
  baseUrl: string;
  /** API key opsional (sebagian deployment lokal tanpa auth). */
  apiKey?: string;
  /** Model per tier. Tier tanpa model akan dilewati saat fallback. */
  models: TierModelMap;
  /**
   * Urutan fallback tier. Default: subscription → cheap → free.
   * Tier yang tidak punya model di `models` otomatis dilewati.
   */
  fallbackOrder?: ModelTier[];
  /** Timeout per request (ms). Default 60_000. */
  timeoutMs?: number;
  /** Default temperature bila request tidak menyetel. */
  defaultTemperature?: number;
  /**
   * Phase 5.5 — "cache routing tier": setelah sebuah tier GAGAL, lewati tier itu selama
   * `tierCooldownMs` ms (hindari membuang panggilan ke tier yang sedang mati → hemat biaya/latency).
   * Tier yang berhasil dipulihkan dari cooldown. 0 = nonaktif (default). Tak pernah mengosongkan
   * seluruh kandidat: bila semua tier ter-cooldown, tetap dicoba.
   */
  tierCooldownMs?: number;
  /** Jam (di-inject untuk test deterministik). Default Date.now. */
  now?: () => number;
}

/** Urutan fallback default (plan §5: routing tier per-peran). */
export const DEFAULT_FALLBACK_ORDER: ModelTier[] = ["subscription", "cheap", "free"];
