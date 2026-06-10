/**
 * Skill `web_search` — skill nyata pertama (DoD Phase 0 §0.4).
 * Tidak risky (read-only) → tidak butuh approval gate.
 *
 * Pluggable provider: default "mock" (deterministik, tanpa jaringan) agar spike bisa
 * dijalankan tanpa API eksternal. Provider nyata (SerpAPI/Brave/dll) bisa dipasang nanti
 * tanpa mengubah loop.
 */

import type { JsonSchema, Skill, SkillContext } from "@vc/shared";

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  results: WebSearchResult[];
}

/** Fungsi penyedia hasil pencarian. */
export type WebSearchProvider = (
  query: string,
  limit: number,
  ctx: SkillContext,
) => Promise<WebSearchResult[]>;

const PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Kata kunci pencarian." },
    limit: {
      type: "integer",
      description: "Jumlah hasil maksimum (default 3).",
    },
  },
  required: ["query"],
};

/** Provider mock deterministik untuk spike/test. */
export const mockWebSearchProvider: WebSearchProvider = (query, limit) => {
  const results: WebSearchResult[] = Array.from({ length: limit }, (_, i) => ({
    title: `[mock] Hasil ${i + 1} untuk "${query}"`,
    url: `https://example.com/search?q=${encodeURIComponent(query)}&r=${i + 1}`,
    snippet: `Ringkasan mock #${i + 1} terkait "${query}". (provider=mock, ganti dengan API nyata di Phase 4+.)`,
  }));
  return Promise.resolve(results);
};

/** Buat skill web_search dengan provider tertentu (default mock). */
export function createWebSearchSkill(
  provider: WebSearchProvider = mockWebSearchProvider,
): Skill<WebSearchInput, WebSearchOutput> {
  return {
    name: "web_search",
    description:
      "Cari informasi di web berdasarkan kata kunci. Kembalikan daftar judul, URL, dan ringkasan.",
    paramsSchema: PARAMS_SCHEMA,
    risky: false,
    async handler(input, ctx) {
      const query = (input.query ?? "").trim();
      if (!query) throw new Error("web_search: 'query' wajib diisi");
      const limit = clampLimit(input.limit);
      const results = await provider(query, limit, ctx);
      return { query, results };
    },
  };
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return 3;
  return Math.max(1, Math.min(10, Math.trunc(limit)));
}
