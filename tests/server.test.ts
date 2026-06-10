import { describe, it, expect, vi } from "vitest";
import { MockWhatsAppAdapter, OwnerAuth, WaRelay, buildServer } from "@vc/server";
import type { MessageHandler } from "@vc/server";

const WEBHOOK = "/webhook/whatsapp";
// parseCloudWebhook mengekstrak `from` apa adanya (digit tanpa "+").
const OWNER_DIGITS = "6281234567890";

/** Payload mirip WhatsApp Cloud API dengan satu pesan teks. */
function cloudPayload(messageId: string, text = "halo", from = OWNER_DIGITS): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550009999", phone_number_id: "PNID" },
              messages: [
                { from, id: messageId, timestamp: "1700000000", type: "text", text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  });
}

function buildWith(handler: MessageHandler): ReturnType<typeof buildServer> {
  const relay = new WaRelay({
    adapter: new MockWhatsAppAdapter(),
    ownerAuth: new OwnerAuth([OWNER_DIGITS]),
    handler,
    log: () => {},
  });
  return buildServer({ relay });
}

describe("buildServer — webhook POST", () => {
  it("BUG-001: balas 200 SEGERA walau relay belum selesai (tidak menunggu LLM)", async () => {
    // Handler yang tidak pernah resolve: bila server meng-await relay, inject akan hang.
    let resolveGate: (v: string) => void = () => {};
    const gate = new Promise<string>((r) => {
      resolveGate = r;
    });
    const handler = vi.fn(() => gate);
    const app = buildWith(handler);

    const res = await app.inject({
      method: "POST",
      url: WEBHOOK,
      headers: { "content-type": "application/json" },
      payload: cloudPayload("wamid.A"),
    });

    // Response datang meski handler belum resolve → ack tidak menunggu pemrosesan.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: 1, accepted: 1 });
    // Pemrosesan tetap dipicu di background.
    expect(handler).toHaveBeenCalledOnce();

    resolveGate("done"); // cleanup
    await app.close();
  });

  it("BUG-001: dedup messageId — retry Meta atas pesan sama tidak diproses dua kali", async () => {
    const handler = vi.fn(() => Promise.resolve("ok"));
    const app = buildWith(handler);

    const first = await app.inject({
      method: "POST",
      url: WEBHOOK,
      headers: { "content-type": "application/json" },
      payload: cloudPayload("wamid.DUP"),
    });
    const second = await app.inject({
      method: "POST",
      url: WEBHOOK,
      headers: { "content-type": "application/json" },
      payload: cloudPayload("wamid.DUP"),
    });

    expect(first.json()).toEqual({ received: 1, accepted: 1 });
    expect(second.json()).toEqual({ received: 1, accepted: 0 });
    // Hanya retry pertama yang menjalankan handler.
    expect(handler).toHaveBeenCalledOnce();

    await app.close();
  });
});
