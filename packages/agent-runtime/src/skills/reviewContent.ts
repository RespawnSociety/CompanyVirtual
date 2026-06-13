/**
 * Skill `review_content` (Phase 3.2) — menilai konten via 9Router: kualitas, brand voice,
 * kepatuhan. Mengembalikan verdict terstruktur { pass, feedback } untuk dipakai engine
 * (loop_until_pass) maupun agent Reviewer. Non-risky.
 */

import type { ChatMessage, JsonSchema, Skill, SkillContext } from "@vc/shared";

export interface ReviewContentInput {
  /** Konten yang dinilai. */
  content: string;
  /** Kriteria/standar tambahan (opsional). */
  criteria?: string;
}

export interface ReviewContentOutput {
  pass: boolean;
  feedback: string;
}

const PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    content: { type: "string", description: "Konten yang akan dinilai." },
    criteria: { type: "string", description: "Kriteria/brand voice/kepatuhan (opsional)." },
  },
  required: ["content"],
};

export function createReviewContentSkill(): Skill<ReviewContentInput, ReviewContentOutput> {
  return {
    name: "review_content",
    description:
      "Nilai konten (kualitas, brand voice, kepatuhan). Kembalikan apakah LOLOS beserta alasan/feedback.",
    paramsSchema: PARAMS_SCHEMA,
    risky: false,
    async handler(input, ctx: SkillContext) {
      const content = (input.content ?? "").trim();
      if (!content) throw new Error("review_content: 'content' wajib diisi");
      const criteria = (input.criteria ?? "").trim();

      const system =
        "Kamu reviewer konten yang ketat. Nilai konten dari sisi kualitas, brand voice, dan kepatuhan." +
        (criteria ? ` Kriteria khusus: ${criteria}.` : "") +
        " Jawab pada BARIS PERTAMA tepat 'PASS' (bila layak terbit) atau 'REVISI' (bila perlu perbaikan)," +
        " lalu baris berikutnya berikan alasan/feedback singkat.";

      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content },
      ];
      const res = await ctx.router.chat({ messages, maxTokens: 300 });
      const text = (res.message.content ?? "").trim();
      const pass = /^\s*(pass|lolos|layak)\b/i.test(text);
      return { pass, feedback: text };
    },
  };
}
