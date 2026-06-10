import { afterEach, describe, it, expect, vi } from "vitest";
import { NineRouterClient, RouterError, createRouterFromEnv } from "@vc/agent-runtime";

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
  usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NineRouterClient — fallback 3-tier", () => {
  it("jatuh ke tier berikutnya saat tier pertama gagal", async () => {
    let calls = 0;
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("ECONNREFUSED")); // tier cheap gagal
      return Promise.resolve(okResponse(completion("hai dari free", "m-free")));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new NineRouterClient({
      baseUrl: "http://localhost:20128/v1",
      models: { cheap: "m-cheap", free: "m-free" }, // subscription tak ada → dilewati
    });

    const res = await client.chat({ messages: [{ role: "user", content: "halo" }] });
    expect(calls).toBe(2);
    expect(res.tierUsed).toBe("free");
    expect(res.message.content).toBe("hai dari free");
    expect(res.usage?.totalTokens).toBe(12);
  });

  it("melempar RouterError bila tidak ada model terkonfigurasi", async () => {
    const client = new NineRouterClient({ baseUrl: "http://x/v1", models: {} });
    await expect(client.chat({ messages: [] })).rejects.toBeInstanceOf(RouterError);
  });

  it("meneruskan tool_calls dari respons", async () => {
    const body = {
      model: "m",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"x"}' } },
            ],
          },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(okResponse(body))));
    const client = new NineRouterClient({ baseUrl: "http://x/v1", models: { free: "m" } });
    const res = await client.chat({ messages: [{ role: "user", content: "cari" }] });
    expect(res.finishReason).toBe("tool_calls");
    expect(res.message.tool_calls?.[0]?.function.name).toBe("web_search");
  });

  it("HTTP non-OK dianggap gagal → fallback / RouterError", async () => {
    const bad = { ok: false, status: 500, statusText: "ERR", text: () => Promise.resolve("boom") } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(bad)));
    const client = new NineRouterClient({ baseUrl: "http://x/v1", models: { free: "m" } });
    await expect(client.chat({ messages: [] })).rejects.toBeInstanceOf(RouterError);
  });
});

describe("createRouterFromEnv", () => {
  it("memetakan NINEROUTER_MODEL_* ke tier", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(okResponse(completion("ok", "sub-model")))));
    const client = createRouterFromEnv({
      NINEROUTER_BASE_URL: "http://localhost:20128/v1",
      NINEROUTER_MODEL_SUBSCRIPTION: "sub-model",
    });
    const res = await client.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(res.tierUsed).toBe("subscription");
  });
});
