import { describe, it, expect } from "vitest";
import type { MemoryItem } from "@vc/shared";
import { InMemoryMemoryStore, relevanceScore, tokenize } from "@vc/agent-runtime";

function item(over: Partial<MemoryItem>): MemoryItem {
  return {
    id: over.id ?? "m",
    agentId: "a",
    kind: "observation",
    text: over.text ?? "",
    createdAt: over.createdAt ?? 0,
    importance: over.importance ?? 0.5,
    tags: over.tags ?? [],
    ...over,
  };
}

describe("tokenize & relevanceScore", () => {
  it("membuang stopword & token pendek", () => {
    expect(tokenize("ini adalah tren marketing")).toEqual(["tren", "marketing"]);
  });

  it("relevance = proporsi token query yang cocok", () => {
    const m = item({ text: "strategi konten marketing video" });
    expect(relevanceScore(["marketing", "video"], m)).toBeCloseTo(1);
    expect(relevanceScore(["marketing", "podcast"], m)).toBeCloseTo(0.5);
    expect(relevanceScore([], m)).toBe(0);
  });
});

describe("InMemoryMemoryStore.retrieve", () => {
  it("mengutamakan item paling relevan", async () => {
    const store = new InMemoryMemoryStore();
    const now = 10_000_000;
    await store.add("ns", item({ id: "rel", text: "riset kompetitor marketing", createdAt: now }));
    await store.add("ns", item({ id: "irrel", text: "jadwal rapat finance", createdAt: now }));

    const top = await store.retrieve("ns", "marketing kompetitor", { now, limit: 1 });
    expect(top).toHaveLength(1);
    expect(top[0]!.id).toBe("rel");
  });

  it("recency menjadi penentu saat relevansi setara", async () => {
    const store = new InMemoryMemoryStore();
    const now = 100 * 24 * 60 * 60 * 1000;
    await store.add("ns", item({ id: "old", text: "catatan umum", createdAt: now - 30 * 24 * 60 * 60 * 1000 }));
    await store.add("ns", item({ id: "new", text: "catatan umum", createdAt: now }));

    const top = await store.retrieve("ns", "topik tak terkait", { now, limit: 1 });
    expect(top[0]!.id).toBe("new");
  });

  it("namespace terisolasi", async () => {
    const store = new InMemoryMemoryStore();
    await store.add("ns1", item({ id: "x", text: "halo" }));
    expect(await store.list("ns2")).toEqual([]);
  });
});
