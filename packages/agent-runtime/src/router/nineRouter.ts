/**
 * NineRouterClient — klien OpenAI-compatible ke 9Router (`localhost:20128/v1`).
 *
 * Tanggung jawab (plan §5, §14):
 *  - chat + tool/function calling sesuai spesifikasi OpenAI Chat Completions.
 *  - fallback 3-tier: subscription → cheap → free (tier tanpa model dilewati).
 *  - jadi SATU-SATUNYA jalur ke LLM (tidak ada panggilan provider langsung).
 *
 * Catatan spike: 9Router OpenAI-compatible, jadi format request/response mengikuti
 * OpenAI. Bila versi 9Router terbaru berbeda, sesuaikan parsing di sini saja.
 */

import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ModelTier,
  RouterClient,
  ToolCall,
} from "@vc/shared";
import {
  DEFAULT_FALLBACK_ORDER,
  type NineRouterConfig,
} from "./types.js";

/** Eror saat semua tier gagal (network/non-OK), membawa detail tiap percobaan. */
export class RouterError extends Error {
  constructor(
    message: string,
    readonly attempts: { tier: ModelTier; model: string; error: string }[],
  ) {
    super(message);
    this.name = "RouterError";
  }
}

/** Bentuk minimal respons OpenAI Chat Completions yang kita pakai. */
interface OpenAIChatCompletion {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class NineRouterClient implements RouterClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly models: NineRouterConfig["models"];
  private readonly fallbackOrder: ModelTier[];
  private readonly timeoutMs: number;
  private readonly defaultTemperature: number;
  /** Phase 5.5: tier → epoch ms sampai kapan tier itu dilewati (cooldown setelah gagal). */
  private readonly tierCooldownMs: number;
  private readonly now: () => number;
  private readonly tierCooldownUntil = new Map<ModelTier, number>();

  constructor(config: NineRouterConfig) {
    // Normalisasi: buang trailing slash agar penggabungan path konsisten.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.models = config.models;
    this.fallbackOrder = config.fallbackOrder ?? DEFAULT_FALLBACK_ORDER;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
    this.tierCooldownMs = config.tierCooldownMs ?? 0;
    this.now = config.now ?? Date.now;
  }

  /**
   * Susun urutan percobaan (tier, model). Bila request menyetel `model` eksplisit,
   * pakai itu saja (bypass tier). Bila menyetel `tier`, mulai dari tier itu lalu
   * lanjut ke tier berikut sesuai fallbackOrder.
   */
  private resolveAttempts(req: ChatRequest): { tier: ModelTier; model: string }[] {
    if (req.model) {
      const tier = req.tier ?? "subscription";
      return [{ tier, model: req.model }];
    }

    let order = this.fallbackOrder;
    if (req.tier) {
      const start = order.indexOf(req.tier);
      // Mulai dari tier yang diminta; bila tidak ada di order, pakai apa adanya.
      order = start >= 0 ? order.slice(start) : [req.tier, ...order];
    }

    const attempts: { tier: ModelTier; model: string }[] = [];
    for (const tier of order) {
      const model = this.models[tier];
      if (model) attempts.push({ tier, model });
    }
    return this.filterCooldown(attempts);
  }

  /**
   * Phase 5.5 — buang tier yang sedang cooldown (baru gagal). Tak pernah mengosongkan
   * seluruh kandidat: bila semua ter-cooldown, kembalikan apa adanya (tetap dicoba).
   */
  private filterCooldown(
    attempts: { tier: ModelTier; model: string }[],
  ): { tier: ModelTier; model: string }[] {
    if (this.tierCooldownMs <= 0) return attempts;
    const now = this.now();
    const healthy = attempts.filter((a) => (this.tierCooldownUntil.get(a.tier) ?? 0) <= now);
    return healthy.length > 0 ? healthy : attempts;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const attempts = this.resolveAttempts(req);
    if (attempts.length === 0) {
      throw new RouterError(
        "Tidak ada model terkonfigurasi untuk tier mana pun (cek NINEROUTER_MODEL_*).",
        [],
      );
    }

    const failures: { tier: ModelTier; model: string; error: string }[] = [];

    for (const { tier, model } of attempts) {
      try {
        const res = await this.callOnce(req, tier, model);
        // Sukses → pulihkan tier dari cooldown (Phase 5.5).
        if (this.tierCooldownMs > 0) this.tierCooldownUntil.delete(tier);
        return res;
      } catch (err) {
        failures.push({ tier, model, error: errorMessage(err) });
        // Tandai tier cooldown agar panggilan berikut melewatinya sementara (Phase 5.5).
        if (this.tierCooldownMs > 0) {
          this.tierCooldownUntil.set(tier, this.now() + this.tierCooldownMs);
        }
        // Lanjut ke tier berikutnya (fallback).
      }
    }

    throw new RouterError(
      `Semua tier gagal (${failures.length} percobaan). Terakhir: ${
        failures.at(-1)?.error ?? "?"
      }`,
      failures,
    );
  }

  private async callOnce(
    req: ChatRequest,
    tier: ModelTier,
    model: string,
  ): Promise<ChatResponse> {
    const body = {
      model,
      messages: req.messages,
      // PENTING (temuan spike): 9Router default-nya mengembalikan SSE streaming untuk
      // sebagian provider, bahkan tanpa stream:true. Kirim stream:false eksplisit agar
      // dapat satu objek JSON utuh (res.json()). Streaming menyusul bila perlu (Phase 2+).
      stream: false,
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      temperature: req.temperature ?? this.defaultTemperature,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${truncate(text, 300)}`);
    }

    const json = (await res.json()) as OpenAIChatCompletion;
    const choice = json.choices?.[0];
    if (!choice?.message) {
      throw new Error("Respons 9Router tanpa choices[0].message");
    }

    const message: ChatMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      ...(choice.message.tool_calls && choice.message.tool_calls.length > 0
        ? { tool_calls: choice.message.tool_calls }
        : {}),
    };

    return {
      message,
      finishReason: choice.finish_reason ?? "stop",
      model: json.model ?? model,
      tierUsed: tier,
      ...(json.usage
        ? {
            usage: {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            },
          }
        : {}),
    };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError" ? "timeout" : err.message;
  }
  return String(err);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
