/**
 * CloudApiAdapter — WhatsApp Cloud API resmi (Meta Graph API).
 * Jalur produksi (plan §7.1, §7.4: utamakan API resmi).
 *
 * Inbound datang lewat webhook POST (di-parse di server, bukan di-push adapter).
 * Outbound dikirim via Graph API. Verifikasi webhook (GET) di sini juga.
 *
 * Catatan: kredensial (access token) HARUS dari env/Vault, JANGAN di-hardcode/di-log.
 */

import type { ChannelAdapter, InboundMessage, OutboundMessage } from "./types.js";

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  /** Token verifikasi webhook (cocokkan dengan yang didaftarkan di Meta). */
  verifyToken: string;
  /** Versi Graph API, mis. "v21.0". */
  graphVersion?: string;
  /** Override base URL (untuk test). Default https://graph.facebook.com */
  baseUrl?: string;
}

export class CloudApiAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  private readonly cfg: Required<CloudApiConfig>;

  constructor(config: CloudApiConfig) {
    this.cfg = {
      graphVersion: "v21.0",
      baseUrl: "https://graph.facebook.com",
      ...config,
    };
  }

  async send(msg: OutboundMessage): Promise<void> {
    const url = `${this.cfg.baseUrl}/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: msg.to,
        type: "text",
        text: { preview_url: false, body: msg.text },
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* abaikan */
      }
      throw new Error(`WhatsApp Cloud send gagal: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
  }

  /**
   * Verifikasi webhook (GET). Meta mengirim hub.mode, hub.verify_token, hub.challenge.
   * @returns challenge string bila valid, atau null bila ditolak.
   */
  verifyWebhook(query: Record<string, unknown>): string | null {
    const mode = String(query["hub.mode"] ?? "");
    const token = String(query["hub.verify_token"] ?? "");
    const challenge = query["hub.challenge"];
    if (mode === "subscribe" && token === this.cfg.verifyToken && challenge != null) {
      return String(challenge);
    }
    return null;
  }
}

/**
 * Parse payload webhook WhatsApp Cloud API → daftar InboundMessage.
 * Hanya mengambil pesan teks; pesan non-teks/status diabaikan (Phase 0).
 * Pure function (mudah di-test).
 */
export function parseCloudWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = asArray((body as Record<string, unknown> | undefined)?.entry);
  for (const entry of entries) {
    const changes = asArray((entry as Record<string, unknown>).changes);
    for (const change of changes) {
      const value = (change as Record<string, unknown>).value as Record<string, unknown> | undefined;
      if (!value) continue;
      const metadata = value.metadata as Record<string, unknown> | undefined;
      const to =
        (metadata?.display_phone_number as string | undefined) ??
        (metadata?.phone_number_id as string | undefined);
      const messages = asArray(value.messages);
      for (const m of messages) {
        const msg = m as Record<string, unknown>;
        if (msg.type !== "text") continue;
        const text = (msg.text as Record<string, unknown> | undefined)?.body;
        if (typeof text !== "string") continue;
        const tsSec = Number(msg.timestamp);
        out.push({
          from: String(msg.from ?? ""),
          ...(to ? { to } : {}),
          text,
          ...(msg.id ? { messageId: String(msg.id) } : {}),
          timestamp: Number.isFinite(tsSec) ? tsSec * 1000 : Date.now(),
          raw: msg,
        });
      }
    }
  }
  return out;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
