import { describe, it, expect } from "vitest";
import { parseCloudWebhook } from "@vc/server";

// Payload mirip yang dikirim WhatsApp Cloud API.
const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550009999", phone_number_id: "PNID" },
            messages: [
              {
                from: "6281234567890",
                id: "wamid.ABC",
                timestamp: "1700000000",
                type: "text",
                text: { body: "Halo tim" },
              },
              {
                from: "6281234567890",
                id: "wamid.DEF",
                timestamp: "1700000005",
                type: "image",
                image: { id: "media123" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parseCloudWebhook", () => {
  it("mengekstrak pesan teks, abaikan non-teks", () => {
    const msgs = parseCloudWebhook(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      from: "6281234567890",
      text: "Halo tim",
      to: "15550009999",
      messageId: "wamid.ABC",
    });
    // timestamp detik → ms.
    expect(msgs[0]!.timestamp).toBe(1700000000 * 1000);
  });

  it("payload kosong/aneh → array kosong (tidak melempar)", () => {
    expect(parseCloudWebhook(undefined)).toEqual([]);
    expect(parseCloudWebhook({})).toEqual([]);
    expect(parseCloudWebhook({ entry: "bukan-array" })).toEqual([]);
  });
});
