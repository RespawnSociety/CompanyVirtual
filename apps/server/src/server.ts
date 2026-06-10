/**
 * HTTP server (Fastify) — endpoint webhook WhatsApp Cloud API + health.
 * Inbound di-parse jadi InboundMessage lalu diteruskan ke WaRelay (owner auth + auto-reply).
 *
 * buildServer menerima dependensi (relay, cloud adapter) agar mudah di-test.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { WaRelay } from "./comms/relay.js";
import { type CloudApiAdapter, parseCloudWebhook } from "./comms/cloudAdapter.js";

export interface BuildServerDeps {
  relay: WaRelay;
  /** Adapter cloud untuk verifikasi webhook GET (opsional; mode mock tak perlu). */
  cloud?: CloudApiAdapter;
  /** Path webhook (default /webhook/whatsapp). */
  webhookPath?: string;
  /** Kapasitas cache dedup messageId (default 1000). 0 = nonaktifkan dedup. */
  dedupCapacity?: number;
}

export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const path = deps.webhookPath ?? "/webhook/whatsapp";
  const seen = new SeenMessageIds(deps.dedupCapacity ?? 1000);

  app.get("/health", () => ({ ok: true }));

  // Verifikasi webhook (Meta GET handshake).
  app.get(path, (req, reply) => {
    if (!deps.cloud) {
      return reply.code(404).send({ error: "verifikasi webhook hanya untuk adapter cloud" });
    }
    const challenge = deps.cloud.verifyWebhook(req.query as Record<string, unknown>);
    if (challenge == null) {
      return reply.code(403).send({ error: "verify_token tidak cocok" });
    }
    return reply.code(200).type("text/plain").send(challenge);
  });

  // Inbound pesan (Meta POST). Balas 200 SEGERA (sebelum relay/LLM/kirim WA) agar
  // Meta tidak menganggap webhook gagal lalu retry. Pemrosesan jalan di background.
  app.post(path, async (req, reply) => {
    const messages = parseCloudWebhook(req.body);

    // Dedup berbasis messageId: retry Meta atas pesan yang sama tidak boleh
    // menjalankan directive (LLM/aksi) dua kali. Pesan tanpa id diproses apa adanya.
    const fresh = messages.filter((msg) => {
      if (msg.messageId == null) return true;
      if (seen.has(msg.messageId)) return false;
      seen.add(msg.messageId);
      return true;
    });

    // Jangan di-await: relay bisa memanggil LLM/9Router (default timeout 60s) dan
    // kirim balasan WhatsApp. Menunggunya di sini akan menahan ack 200.
    for (const msg of fresh) {
      void deps.relay.handleInbound(msg).catch((err: unknown) => {
        app.log.error(err);
      });
    }

    return reply.code(200).send({ received: messages.length, accepted: fresh.length });
  });

  return app;
}

/**
 * Cache messageId yang sudah diterima, dengan kapasitas terbatas (FIFO) agar tidak
 * tumbuh tanpa batas. Cukup untuk meredam retry Meta dalam jendela waktu pendek.
 */
class SeenMessageIds {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity: number) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.capacity <= 0) return;
    if (this.ids.size >= this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    this.ids.add(id);
  }
}
