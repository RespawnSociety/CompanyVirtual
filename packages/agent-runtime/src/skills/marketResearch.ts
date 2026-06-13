/**
 * Skill `market_research` (Phase 3.2) — rangkum riset pasar (tren/kompetitor/audiens/keyword)
 * via 9Router. Non-risky. Untuk riset web mentah, agent bisa pakai web_search/web_fetch dulu
 * lalu skill ini merangkum; di sini versi ringkas: LLM merangkum topik jadi insight actionable.
 */

import type { ChatMessage, JsonSchema, Skill, SkillContext } from "@vc/shared";

export interface MarketResearchInput {
  /** Topik/produk/segmen yang diriset. */
  topic: string;
  /** Konteks tambahan (mis. hasil web_search) (opsional). */
  context?: string;
}

export interface MarketResearchOutput {
  topic: string;
  summary: string;
}

const PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Topik/produk/segmen yang diriset." },
    context: { type: "string", description: "Konteks/temuan tambahan (opsional)." },
  },
  required: ["topic"],
};

export function createMarketResearchSkill(): Skill<MarketResearchInput, MarketResearchOutput> {
  return {
    name: "market_research",
    description:
      "Rangkum riset pasar (tren, kompetitor, audiens, keyword) jadi insight actionable untuk konten.",
    paramsSchema: PARAMS_SCHEMA,
    risky: false,
    async handler(input, ctx: SkillContext) {
      const topic = (input.topic ?? "").trim();
      if (!topic) throw new Error("market_research: 'topic' wajib diisi");
      const context = (input.context ?? "").trim();

      const system =
        "Kamu periset pasar. Rangkum tren, kompetitor, audiens, dan keyword relevan jadi poin-poin " +
        "insight singkat yang actionable untuk pembuatan konten. Hindari basa-basi.";
      const user = context ? `Topik: ${topic}\n\nKonteks/temuan:\n${context}` : `Topik: ${topic}`;
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const res = await ctx.router.chat({ messages, maxTokens: 500 });
      const summary = (res.message.content ?? "").trim();
      if (!summary) throw new Error("market_research: LLM tidak mengembalikan ringkasan");
      return { topic, summary };
    },
  };
}
