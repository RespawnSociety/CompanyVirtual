/**
 * HTTP server (Fastify) — endpoint webhook WhatsApp Cloud API + health.
 * Inbound di-parse jadi InboundMessage lalu diteruskan ke WaRelay (owner auth + auto-reply).
 *
 * buildServer menerima dependensi (relay, cloud adapter) agar mudah di-test.
 */

import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { Id } from "@vc/shared";
import type { WaRelay } from "./comms/relay.js";
import { type CloudApiAdapter, parseCloudWebhook } from "./comms/cloudAdapter.js";
import type { ConfigStore } from "./db/store.js";
import { registerConfigRoutes } from "./api/routes.js";

export interface BuildServerDeps {
  /** Relay WhatsApp (Phase 0). Opsional: server config-only (Phase 1) tak butuh. */
  relay?: WaRelay;
  /** Adapter cloud untuk verifikasi webhook GET (opsional; mode mock tak perlu). */
  cloud?: CloudApiAdapter;
  /** Store Configuration layer (Phase 1). Bila ada → daftarkan REST `/api/*`. */
  configStore?: ConfigStore;
  /** Callback saat config sebuah company berubah (untuk broadcast realtime). */
  onMutate?: (companyId: Id) => void;
  /** Origin yang diizinkan CORS (default "*" untuk dev lokal). */
  corsOrigin?: string;
  /**
   * Token bearer untuk melindungi `/api/*` (CR-101). Bila di-set, tiap request `/api/*`
   * wajib menyertakan header `Authorization: Bearer <token>`; selain itu 401. Bila kosong
   * (default dev lokal) `/api/*` terbuka — lihat gating non-loopback di `main.ts`.
   */
  apiAuthToken?: string;
  /** Path webhook (default /webhook/whatsapp). */
  webhookPath?: string;
  /** Kapasitas cache dedup messageId (default 1000). 0 = nonaktifkan dedup. */
  dedupCapacity?: number;
}

export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const path = deps.webhookPath ?? "/webhook/whatsapp";
  const seen = new SeenMessageIds(deps.dedupCapacity ?? 1000);

  // CORS sederhana (dev): izinkan web (Vite) memanggil API lintas-origin.
  // Di dev kita juga sediakan Vite proxy, jadi ini sekadar fallback.
  const corsOrigin = deps.corsOrigin ?? "*";
  const apiToken = deps.apiAuthToken?.trim() || undefined;
  app.addHook("onRequest", (req, reply, done) => {
    reply.header("access-control-allow-origin", corsOrigin);
    reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");
    if (req.method === "OPTIONS") {
      void reply.code(204).send();
      return;
    }
    // CR-101: bila token di-set, lindungi seluruh `/api/*` dengan bearer auth.
    if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
      void reply.code(401).send({ error: "unauthorized: bearer token tidak valid" });
      return;
    }
    done();
  });

  app.get("/health", () => ({ ok: true }));

  // REST Configuration layer (Phase 1) — hanya bila store diberikan.
  if (deps.configStore) {
    registerConfigRoutes(app, deps.configStore, {
      ...(deps.onMutate ? { onMutate: deps.onMutate } : {}),
    });
  }

  const relay = deps.relay;
  if (!relay) return app; // server config-only (tanpa webhook WhatsApp).

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
      void relay.handleInbound(msg).catch((err: unknown) => {
        app.log.error(err);
      });
    }

    return reply.code(200).send({ received: messages.length, accepted: fresh.length });
  });

  return app;
}

/** Validasi header `Authorization: Bearer <token>` terhadap token yang dikonfigurasi (CR-101). */
function hasValidBearer(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length).trim();
  // Bandingkan waktu-konstan; timingSafeEqual butuh panjang sama, jadi cek panjang dulu.
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
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
