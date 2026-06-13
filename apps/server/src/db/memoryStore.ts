/**
 * MysqlMemoryStore — backing persisten untuk `MemoryStore` (@vc/agent-runtime), Phase 2.5.
 *
 * Long-term `MemoryItem` per agent (namespace), disimpan di tabel `memory_items` (MySQL).
 * Retrieval keyword (recency + relevance + importance) memakai skorer yang sama dengan
 * InMemoryMemoryStore — di-load per-namespace lalu di-skor di JS (volume kecil; embeddings
 * via 9Router menyusul di Phase 7). Tabel dibuat oleh `ConfigStore.init()`.
 */

import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { MemoryItem } from "@vc/shared";
import { type MemoryStore, type RetrieveOptions, relevanceScore, recencyScore, tokenize } from "@vc/agent-runtime";

export class MysqlMemoryStore implements MemoryStore {
  constructor(private readonly pool: Pool) {}

  async add(namespace: string, item: MemoryItem): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      "INSERT INTO memory_items (id, namespace, agent_id, kind, `text`, created_at, importance, tags, embedding) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        item.id,
        namespace,
        item.agentId,
        item.kind,
        item.text,
        item.createdAt,
        item.importance,
        JSON.stringify(item.tags),
        item.embedding ? JSON.stringify(item.embedding) : null,
      ],
    );
  }

  async retrieve(namespace: string, query: string, opts: RetrieveOptions = {}): Promise<MemoryItem[]> {
    const limit = opts.limit ?? 5;
    const now = opts.now ?? Date.now();
    const items = await this.loadNamespace(namespace);
    const queryTokens = tokenize(query);

    // Bobot identik dengan InMemoryMemoryStore: relevance dominan, lalu recency, importance tie-break.
    const scored = items.map((item) => {
      const rel = relevanceScore(queryTokens, item);
      const rec = recencyScore(item, now);
      return { item, score: 0.55 * rel + 0.3 * rec + 0.15 * item.importance };
    });
    scored.sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
    return scored.slice(0, limit).map((s) => s.item);
  }

  async list(namespace: string): Promise<MemoryItem[]> {
    const items = await this.loadNamespace(namespace);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items;
  }

  private async loadNamespace(namespace: string): Promise<MemoryItem[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM memory_items WHERE namespace = ?",
      [namespace],
    );
    return (rows as Record<string, unknown>[]).map((r) => this.rowToItem(r));
  }

  private rowToItem(r: Record<string, unknown>): MemoryItem {
    const item: MemoryItem = {
      id: r["id"] as string,
      agentId: r["agent_id"] as string,
      kind: r["kind"] as MemoryItem["kind"],
      text: r["text"] as string,
      createdAt: Number(r["created_at"]),
      importance: Number(r["importance"]),
      tags: parseJsonArray(r["tags"]),
    };
    const embeddingRaw = r["embedding"];
    if (typeof embeddingRaw === "string" && embeddingRaw.length > 0) {
      try {
        item.embedding = JSON.parse(embeddingRaw) as number[];
      } catch {
        /* abaikan embedding rusak */
      }
    }
    return item;
  }
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
