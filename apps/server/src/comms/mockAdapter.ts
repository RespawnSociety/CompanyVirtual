/**
 * MockWhatsAppAdapter — adapter uji lokal tanpa WhatsApp nyata.
 * Menyimpan pesan keluar (untuk assertion) & bisa mensimulasikan pesan masuk.
 * Inilah yang membuat DoD §0.5 bisa diverifikasi deterministik tanpa Meta/Baileys.
 */

import type { ChannelAdapter, InboundMessage, OutboundMessage } from "./types.js";

export class MockWhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  /** Semua pesan keluar yang "terkirim" (untuk inspeksi/test). */
  readonly sent: OutboundMessage[] = [];

  send(msg: OutboundMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }

  /** Buat objek InboundMessage seperti yang akan diterima dari kanal nyata. */
  makeInbound(from: string, text: string, now: number, to = "company-number"): InboundMessage {
    return {
      from,
      to,
      text,
      messageId: `mock_${this.sent.length}_${from}`,
      timestamp: now,
      raw: { provider: "mock" },
    };
  }

  /** Ambil pesan terakhir yang dikirim (atau undefined). */
  lastSent(): OutboundMessage | undefined {
    return this.sent.at(-1);
  }
}
