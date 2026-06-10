/**
 * MockRouterClient — router palsu untuk uji deterministik & spike tanpa 9Router hidup.
 * Tidak menyentuh jaringan. Berguna untuk membuktikan logika loop/skill secara unit.
 */

import type { ChatRequest, ChatResponse, RouterClient } from "@vc/shared";

/** Penghasil respons: balasan tetap atau fungsi atas request. */
export type MockResponder =
  | ChatResponse
  | ((req: ChatRequest, callIndex: number) => ChatResponse);

export class MockRouterClient implements RouterClient {
  private calls = 0;
  /** Rekam semua request yang masuk (untuk assertion di test). */
  readonly requests: ChatRequest[] = [];

  /**
   * @param script Antrian responder; dipakai berurutan tiap `chat()`.
   *               Bila habis, responder terakhir dipakai ulang.
   */
  constructor(private readonly script: MockResponder[]) {
    if (script.length === 0) {
      throw new Error("MockRouterClient butuh minimal satu responder");
    }
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const idx = Math.min(this.calls, this.script.length - 1);
    const responder = this.script[idx]!;
    this.calls += 1;
    const res = typeof responder === "function" ? responder(req, this.calls - 1) : responder;
    return Promise.resolve(res);
  }

  /** Jumlah pemanggilan chat sejauh ini. */
  get callCount(): number {
    return this.calls;
  }
}

/** Helper: respons assistant teks biasa (selesai). */
export function textResponse(text: string, model = "mock-model"): ChatResponse {
  return {
    message: { role: "assistant", content: text },
    finishReason: "stop",
    model,
    tierUsed: "free",
  };
}

/** Helper: respons assistant yang memanggil satu tool. */
export function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  callId = "call_1",
  model = "mock-model",
): ChatResponse {
  return {
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        },
      ],
    },
    finishReason: "tool_calls",
    model,
    tierUsed: "free",
  };
}
