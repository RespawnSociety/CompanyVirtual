/**
 * Memory store — long-term `MemoryItem` per agent (namespace).
 * Phase 0: retrieval keyword (recency + relevance + importance). Embeddings menyusul
 * (plan §3.3: "keyword dulu, embeddings via 9Router nanti").
 *
 * Interface dibuat async agar kelak bisa dibacking DB (SQLite → Postgres) tanpa ubah pemanggil.
 */

import type { MemoryItem } from "@vc/shared";

/** Opsi retrieval. */
export interface RetrieveOptions {
  /** Maksimum item dikembalikan. Default 5. */
  limit?: number;
  /** Waktu acuan untuk skor recency (epoch ms). Default Date.now(). */
  now?: number;
}

/** Kontrak penyimpanan memory (in-memory sekarang, DB nanti). */
export interface MemoryStore {
  add(namespace: string, item: MemoryItem): Promise<void>;
  /** Ambil item paling relevan untuk `query` (recency+relevance+importance). */
  retrieve(namespace: string, query: string, opts?: RetrieveOptions): Promise<MemoryItem[]>;
  /** Semua item di namespace (urut terbaru dulu). */
  list(namespace: string): Promise<MemoryItem[]>;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are",
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "ini", "itu", "dengan",
  "adalah", "akan", "pada", "juga", "agar",
]);

/** Pecah teks jadi token kata (lowercase, buang stopword & token pendek). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Skor relevansi keyword: proporsi token query yang muncul di item (teks+tags).
 * 0..1. Bila query kosong → 0 (recency & importance yang menentukan).
 */
export function relevanceScore(queryTokens: string[], item: MemoryItem): number {
  if (queryTokens.length === 0) return 0;
  const haystack = new Set([...tokenize(item.text), ...item.tags.map((t) => t.toLowerCase())]);
  let hits = 0;
  for (const qt of new Set(queryTokens)) {
    if (haystack.has(qt)) hits += 1;
  }
  return hits / new Set(queryTokens).size;
}

/** Skor recency: peluruhan eksponensial dengan half-life 24 jam. 0..1. */
export function recencyScore(item: MemoryItem, now: number): number {
  const ageMs = Math.max(0, now - item.createdAt);
  const halfLifeMs = 24 * 60 * 60 * 1000;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/** Implementasi in-memory (Phase 0). Tidak persisten. */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly byNamespace = new Map<string, MemoryItem[]>();

  add(namespace: string, item: MemoryItem): Promise<void> {
    const list = this.byNamespace.get(namespace) ?? [];
    list.push(item);
    this.byNamespace.set(namespace, list);
    return Promise.resolve();
  }

  retrieve(namespace: string, query: string, opts: RetrieveOptions = {}): Promise<MemoryItem[]> {
    const limit = opts.limit ?? 5;
    const now = opts.now ?? Date.now();
    const items = this.byNamespace.get(namespace) ?? [];
    const queryTokens = tokenize(query);

    // Bobot: relevance dominan, lalu recency, importance sebagai tie-breaker.
    const scored = items.map((item) => {
      const rel = relevanceScore(queryTokens, item);
      const rec = recencyScore(item, now);
      const score = 0.55 * rel + 0.3 * rec + 0.15 * item.importance;
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
    return Promise.resolve(scored.slice(0, limit).map((s) => s.item));
  }

  list(namespace: string): Promise<MemoryItem[]> {
    const items = [...(this.byNamespace.get(namespace) ?? [])];
    items.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.resolve(items);
  }
}
