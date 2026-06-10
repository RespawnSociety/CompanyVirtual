/**
 * Kontrak router LLM — dipakai untuk berbicara ke 9Router (OpenAI-compatible).
 * SEMUA panggilan LLM melewati kontrak ini (plan §8, §14: tidak ada provider langsung).
 *
 * Bentuk pesan/tool mengikuti spesifikasi OpenAI Chat Completions agar kompatibel
 * dengan 9Router (`localhost:20128/v1`).
 */

import type { JsonSchema } from "./skill.js";
import type { ModelTier } from "./types.js";

/** Peran pesan dalam percakapan LLM. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Definisi sebuah tool yang ditawarkan ke model (function calling). */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** Permintaan pemanggilan tool yang dikembalikan model. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** Argumen sebagai string JSON (sesuai OpenAI). */
    arguments: string;
  };
}

/** Satu pesan chat (request atau response). */
export interface ChatMessage {
  role: ChatRole;
  /** Konten teks; bisa null saat assistant hanya memanggil tool. */
  content: string | null;
  /** Diisi pada pesan assistant yang memanggil tool. */
  tool_calls?: ToolCall[];
  /** Diisi pada pesan role "tool": id tool_call yang dijawab. */
  tool_call_id?: string;
  /** Nama tool (pada pesan role "tool"). */
  name?: string;
}

/** Parameter request chat (subset OpenAI yang dipakai). */
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Tier untuk routing biaya; router memetakan ke model konkret. */
  tier?: ModelTier;
  /** Override nama model eksplisit (mem-bypass pemetaan tier). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Kontrol pemilihan tool. */
  toolChoice?: "auto" | "none" | "required";
}

/** Alasan model berhenti. */
export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | string;

/** Pemakaian token (untuk pemantauan biaya, plan §8). */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Hasil dari satu pemanggilan chat. */
export interface ChatResponse {
  message: ChatMessage;
  finishReason: FinishReason;
  /** Model konkret yang benar-benar menjawab (tier mana yang dipakai). */
  model: string;
  /** Tier yang akhirnya berhasil (berguna saat fallback terpicu). */
  tierUsed?: ModelTier;
  usage?: TokenUsage;
}

/** Klien router yang dipakai agent loop & skill. */
export interface RouterClient {
  /** Kirim percakapan + (opsional) tools → dapat balasan/tool_calls. */
  chat(req: ChatRequest): Promise<ChatResponse>;
}
