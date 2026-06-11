/**
 * Entry orchestrator (Phase 0) — start HTTP server dengan WhatsApp relay + owner auth.
 *
 * Membaca konfigurasi dari env (lihat .env.example). Adapter dipilih via WA_ADAPTER:
 *   - "mock"  : tidak kirim ke WhatsApp nyata (pesan keluar dicatat di log). Untuk uji lokal.
 *   - "cloud" : WhatsApp Cloud API resmi (butuh kredensial).
 *
 * Jalankan: `npm run -w @vc/server dev`  (atau lewat infra/scripts).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Id, VaultReader } from "@vc/shared";
import {
  InMemoryMemoryStore,
  SkillRegistry,
  createRouterFromEnv,
  createWebSearchSkill,
} from "@vc/agent-runtime";
import { CloudApiAdapter } from "./comms/cloudAdapter.js";
import { MockWhatsAppAdapter } from "./comms/mockAdapter.js";
import { ownerAuthFromEnv } from "./comms/ownerAuth.js";
import { WaRelay } from "./comms/relay.js";
import type { ChannelAdapter } from "./comms/types.js";
import { createAgentReplyHandler, makeFrontDeskManager } from "./comms/frontDesk.js";
import { ConfigStore } from "./db/store.js";
import { RealtimeHub } from "./realtime.js";
import { buildServer } from "./server.js";

// Vault placeholder (Vault asli = Phase 4). Tidak menyimpan secret apa pun.
const NOOP_VAULT: VaultReader = {
  get: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
};

function tryLoadEnvFile(): void {
  // Node >=20.12 punya process.loadEnvFile; muat .env bila ada (abaikan bila tidak).
  const loader = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader === "function") {
    try {
      loader(".env");
    } catch {
      /* .env tidak ada — abaikan, pakai env proses. */
    }
  }
}

async function main(): Promise<void> {
  tryLoadEnvFile();
  const env = process.env;

  const ownerAuth = ownerAuthFromEnv(env.WA_OWNER_NUMBERS);
  if (ownerAuth.size === 0) {
    console.warn(
      "[server] PERINGATAN: WA_OWNER_NUMBERS kosong — SEMUA nomor akan ditolak. Set owner di .env.",
    );
  }

  // Runtime deps untuk handler auto-reply.
  // CR-003: pilih provider web_search via env (default mock). Provider nyata = Phase 4+;
  // bila diminta sekarang, gagal start dengan pesan jelas (jangan diam-diam pakai mock).
  const searchMode = (env.WEB_SEARCH_MODE ?? "mock").toLowerCase();
  if (searchMode !== "mock") {
    throw new Error(
      `WEB_SEARCH_MODE='${searchMode}' belum didukung (provider nyata = Phase 4+). Pakai 'mock' atau biarkan kosong.`,
    );
  }
  const skills = new SkillRegistry().register(createWebSearchSkill());
  const memory = new InMemoryMemoryStore();
  const router = createRouterFromEnv(env);
  const manager = makeFrontDeskManager();
  const handler = createAgentReplyHandler(manager, {
    router,
    skills,
    memory,
    vault: NOOP_VAULT,
    emit: (e) => console.log(`[event] ${e.type} agent=${e.agentId}`),
  });

  // Pilih adapter.
  const adapterMode = (env.WA_ADAPTER ?? "mock").toLowerCase();
  let adapter: ChannelAdapter;
  let cloud: CloudApiAdapter | undefined;
  if (adapterMode === "cloud") {
    cloud = new CloudApiAdapter({
      phoneNumberId: required(env.WA_CLOUD_PHONE_NUMBER_ID, "WA_CLOUD_PHONE_NUMBER_ID"),
      accessToken: required(env.WA_CLOUD_ACCESS_TOKEN, "WA_CLOUD_ACCESS_TOKEN"),
      verifyToken: required(env.WA_CLOUD_VERIFY_TOKEN, "WA_CLOUD_VERIFY_TOKEN"),
      ...(env.WA_CLOUD_GRAPH_VERSION ? { graphVersion: env.WA_CLOUD_GRAPH_VERSION } : {}),
    });
    adapter = cloud;
    // CR-003: di mode cloud owner bisa menerima "hasil pencarian" yang sebenarnya mock.
    console.warn(
      "[server] PERHATIAN: skill web_search masih MOCK (hasil contoh, bukan pencarian nyata). " +
        "Provider nyata = Phase 4+.",
    );
  } else {
    adapter = new MockWhatsAppAdapter();
  }

  const relay = new WaRelay({
    adapter,
    ownerAuth,
    handler,
    unknownReply: "Maaf, nomor Anda tidak terdaftar untuk mengakses asisten perusahaan ini.",
  });

  // Configuration layer (Phase 1): SQLite + REST + realtime.
  const dbPath = env.DB_PATH ?? "data/vc.db";
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const store = new ConfigStore(dbPath);

  // onMutate menutup atas hub realtime (hub di-set sebelum listen — lihat CR-108 di bawah).
  const realtimeRef: { hub?: RealtimeHub } = {};
  const onMutate = (companyId: Id): void => realtimeRef.hub?.broadcastWorld(companyId);

  const host = env.SERVER_HOST ?? "127.0.0.1";
  const port = Number(env.SERVER_PORT ?? 8787);

  // CR-101: REST `/api/*` tak punya auth sendiri. Token bearer (API_AUTH_TOKEN) menutupnya.
  // Bila server di-bind ke alamat non-loopback (terjangkau jaringan) TANPA token → tolak start
  // (least-privilege, plan §8). Lokal (127.0.0.1/::1) tanpa token tetap boleh untuk dev.
  const apiAuthToken = env.API_AUTH_TOKEN?.trim() || undefined;
  if (!apiAuthToken && !isLoopbackHost(host)) {
    throw new Error(
      `Server bind ke host non-loopback '${host}' tanpa API_AUTH_TOKEN. ` +
        "REST /api/* akan terbuka tanpa auth. Set API_AUTH_TOKEN di .env sebelum expose ke jaringan.",
    );
  }
  if (!apiAuthToken) {
    console.warn(
      "[server] PERINGATAN: API_AUTH_TOKEN kosong — REST /api/* TERBUKA (tanpa auth). " +
        "Aman hanya untuk dev lokal (bind loopback). Set token sebelum hosting non-lokal.",
    );
  }

  const app = buildServer({
    relay,
    configStore: store,
    onMutate,
    ...(cloud ? { cloud } : {}),
    ...(env.WEB_ORIGIN ? { corsOrigin: env.WEB_ORIGIN } : {}),
    ...(apiAuthToken ? { apiAuthToken } : {}),
  });

  // CR-108: buat hub SEBELUM listen agar tidak ada celah di mana mutasi → broadcast no-op
  // (app.server sudah ada sejak Fastify dibangun; socket.io boleh attach sebelum listen).
  realtimeRef.hub = new RealtimeHub(app.server, store, env.WEB_ORIGIN ?? true);

  await app.listen({ host, port });
  console.log(`[server] listening http://${host}:${port}`);
  console.log(
    `[server] adapter=${adapterMode} owners=${ownerAuth.size} db=${dbPath} apiAuth=${apiAuthToken ? "on" : "off"}`,
  );
  console.log(`[server] webhook: ${host}:${port}/webhook/whatsapp`);
  console.log(`[server] REST config: ${host}:${port}/api/*  · realtime: socket.io`);
  if (adapterMode === "mock") {
    console.log(
      "[server] mode mock: balasan tidak dikirim ke WhatsApp nyata. " +
        "Uji dengan POST payload cloud ke /webhook/whatsapp, atau jalankan `npm run spike:wa`.",
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`Env ${name} wajib diisi untuk WA_ADAPTER=cloud`);
  }
  return value.trim();
}

/** True bila host hanya terjangkau dari mesin lokal (tak terekspos ke jaringan). */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

main().catch((err) => {
  console.error("[server] gagal start:", err);
  process.exitCode = 1;
});
