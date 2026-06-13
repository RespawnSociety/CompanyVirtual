/**
 * Skill `web_fetch` (Phase 3.2) — ambil & baca isi sebuah URL. Non-risky (read-only).
 * Provider pluggable: default MOCK deterministik (tanpa jaringan) agar test/spike jalan tanpa
 * akses eksternal. Provider nyata (fetch HTTP + ekstraksi teks) dipasang nanti tanpa ubah loop.
 */

import type { JsonSchema, Skill, SkillContext } from "@vc/shared";

export interface WebFetchInput {
  url: string;
}

export interface WebFetchOutput {
  url: string;
  content: string;
}

/** Penyedia isi halaman dari URL. */
export type WebFetchProvider = (url: string, ctx: SkillContext) => Promise<string>;

const PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    url: { type: "string", description: "URL yang akan diambil isinya." },
  },
  required: ["url"],
};

/** Provider mock deterministik untuk test/spike. */
export const mockWebFetchProvider: WebFetchProvider = (url) =>
  Promise.resolve(
    `[mock] Isi ringkas dari ${url}. (provider=mock — ganti dengan fetch HTTP nyata di Phase 4+.)`,
  );

export function createWebFetchSkill(
  provider: WebFetchProvider = mockWebFetchProvider,
): Skill<WebFetchInput, WebFetchOutput> {
  return {
    name: "web_fetch",
    description: "Ambil & baca isi sebuah URL (kembalikan teks ringkas).",
    paramsSchema: PARAMS_SCHEMA,
    risky: false,
    async handler(input, ctx) {
      const url = (input.url ?? "").trim();
      if (!url) throw new Error("web_fetch: 'url' wajib diisi");
      const content = await provider(url, ctx);
      return { url, content };
    },
  };
}
