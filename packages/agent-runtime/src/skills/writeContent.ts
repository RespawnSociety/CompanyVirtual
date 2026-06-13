/**
 * Skill `write_content` (Phase 2.2) — menghasilkan konten nyata via 9Router.
 * Tidak risky (tidak mempublikasikan apa pun) → tanpa approval gate. Publikasi = skill
 * terpisah (ig_post/twitter_post, Phase 4) yang approval-gated.
 *
 * Skill ini memanggil LLM (lewat `ctx.router` → 9Router) untuk menulis caption/script/
 * thread/hook/CTA sesuai brief & brand voice. Outputnya jadi bahan Artifact.
 */

import type { ChatMessage, JsonSchema, Skill, SkillContext } from "@vc/shared";

export interface WriteContentInput {
  /** Apa yang harus ditulis (brief/instruksi konkret). */
  brief: string;
  /** Bentuk konten: caption | thread | script | hook | cta | artikel | … (default "caption"). */
  format?: string;
  /** Gaya / brand voice (mis. "santai", "profesional", "lucu"). */
  tone?: string;
  /** Bahasa keluaran (default "Indonesia"). */
  language?: string;
}

export interface WriteContentOutput {
  format: string;
  content: string;
}

const PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    brief: { type: "string", description: "Instruksi/brief konkret konten yang harus ditulis." },
    format: {
      type: "string",
      description: "Bentuk konten: caption, thread, script, hook, cta, artikel. Default caption.",
    },
    tone: { type: "string", description: "Gaya/brand voice (opsional)." },
    language: { type: "string", description: "Bahasa keluaran (default Indonesia)." },
  },
  required: ["brief"],
};

/** Batas token keluaran agar biaya/latency terkendali (CR-002 spirit). */
const MAX_OUTPUT_TOKENS = 800;

export function createWriteContentSkill(): Skill<WriteContentInput, WriteContentOutput> {
  return {
    name: "write_content",
    description:
      "Tulis konten (caption, script video, thread, hook, CTA) dari sebuah brief. " +
      "Kembalikan teks konten final yang siap direview.",
    paramsSchema: PARAMS_SCHEMA,
    risky: false,
    async handler(input, ctx: SkillContext) {
      const brief = (input.brief ?? "").trim();
      if (!brief) throw new Error("write_content: 'brief' wajib diisi");
      const format = (input.format ?? "caption").trim() || "caption";
      const language = (input.language ?? "Indonesia").trim() || "Indonesia";
      const tone = (input.tone ?? "").trim();

      const system =
        `Kamu penulis konten profesional. Tulis ${format} dalam bahasa ${language}` +
        (tone ? ` dengan gaya ${tone}` : "") +
        `. Keluarkan HANYA isi kontennya (tanpa basa-basi, tanpa penjelasan, tanpa label).`;

      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: brief },
      ];

      const res = await ctx.router.chat({ messages, maxTokens: MAX_OUTPUT_TOKENS });
      const content = (res.message.content ?? "").trim();
      if (!content) throw new Error("write_content: LLM tidak mengembalikan konten");
      return { format, content };
    },
  };
}
