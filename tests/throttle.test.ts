/**
 * Phase 5.5 — optimasi router:
 *  - ThrottledRouterClient: batasi panggilan bersamaan (maxConcurrency) + jarak min (minIntervalMs).
 *  - NineRouterClient tier cooldown: tier yang baru GAGAL dilewati selama cooldown (hemat panggilan),
 *    lalu dicoba lagi setelah cooldown habis; pulih saat berhasil.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChatRequest, ChatResponse, RouterClient } from "@vc/shared";
import { NineRouterClient, ThrottledRouterClient } from "@vc/agent-runtime";

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}
const completion = (content: string, model: string) => ({
  model,
  choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
});

/** Inner router yang menahan resolve sampai kita memicunya — untuk uji konkurensi. */
class GatedRouter implements RouterClient {
  active = 0;
  maxActive = 0;
  private resolvers: ((r: ChatResponse) => void)[] = [];
  chat(_req: ChatRequest): Promise<ChatResponse> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<ChatResponse>((resolve) => {
      this.resolvers.push((r) => {
        this.active -= 1;
        resolve(r);
      });
    });
  }
  get pending(): number {
    return this.resolvers.length;
  }
  releaseOne(): void {
    const r = this.resolvers.shift();
    r?.({ message: { role: "assistant", content: "ok" }, finishReason: "stop", model: "m" });
  }
}

describe("ThrottledRouterClient — batas konkurensi", () => {
  it("tidak menjalankan lebih dari maxConcurrency bersamaan", async () => {
    const inner = new GatedRouter();
    const throttled = new ThrottledRouterClient(inner, { maxConcurrency: 2 });
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    const p = [0, 1, 2, 3].map(() => throttled.chat({ messages: [] }));
    await flush();

    // Hanya 2 yang aktif walau 4 diminta; sisanya mengantri di throttle.
    expect(inner.active).toBe(2);
    expect(inner.pending).toBe(2);

    // Tiriskan satu per satu; tiap pelepasan memicu job antrian berikut dispatch (≤ 2 aktif).
    for (let i = 0; i < 4; i++) {
      expect(inner.active).toBeLessThanOrEqual(2);
      inner.releaseOne();
      await flush();
    }
    await Promise.all(p);
    expect(inner.maxActive).toBe(2);
  });
});

describe("NineRouterClient — tier cooldown (Phase 5.5)", () => {
  it("melewati tier yang baru gagal selama cooldown, lalu mencoba lagi setelah habis", async () => {
    let clock = 1_000_000;
    const now = (): number => clock;
    const seen: string[] = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      seen.push(body.model);
      if (body.model === "m-sub") return Promise.reject(new Error("ECONNREFUSED"));
      return Promise.resolve(okResponse(completion("ok", body.model)));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new NineRouterClient({
      baseUrl: "http://x/v1",
      models: { subscription: "m-sub", cheap: "m-cheap" },
      tierCooldownMs: 60_000,
      now,
    });

    // Call 1: subscription gagal → fallback cheap. Tercoba: m-sub, m-cheap.
    const r1 = await client.chat({ messages: [] });
    expect(r1.tierUsed).toBe("cheap");
    expect(seen).toEqual(["m-sub", "m-cheap"]);

    // Call 2 (masih dalam cooldown): subscription DILEWATI → langsung cheap (tak ada m-sub baru).
    seen.length = 0;
    const r2 = await client.chat({ messages: [] });
    expect(r2.tierUsed).toBe("cheap");
    expect(seen).toEqual(["m-cheap"]);

    // Setelah cooldown habis: subscription dicoba lagi (masih gagal) → cheap.
    clock += 60_001;
    seen.length = 0;
    const r3 = await client.chat({ messages: [] });
    expect(r3.tierUsed).toBe("cheap");
    expect(seen).toEqual(["m-sub", "m-cheap"]);

    vi.unstubAllGlobals();
  });

  it("default (tanpa tierCooldownMs) → tidak melewati tier (perilaku lama)", async () => {
    let calls = 0;
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init.body)) as { model: string };
        seen.push(body.model);
        if (body.model === "m-sub") return Promise.reject(new Error("down"));
        return Promise.resolve(okResponse(completion("ok", body.model)));
      }),
    );
    const client = new NineRouterClient({
      baseUrl: "http://x/v1",
      models: { subscription: "m-sub", cheap: "m-cheap" },
    });
    await client.chat({ messages: [] });
    await client.chat({ messages: [] });
    // Tanpa cooldown, subscription dicoba di KEDUA panggilan.
    expect(seen.filter((m) => m === "m-sub")).toHaveLength(2);
    expect(calls).toBe(4);
    vi.unstubAllGlobals();
  });
});
