/**
 * Spike 0.5 — WhatsApp auto-reply + Owner Auth.
 * DoD: chat dari NOMORMU (owner) → agent auto-reply lewat nomor perusahaan;
 *      chat dari NOMOR LAIN → DITOLAK (tidak menyetir agent).
 *
 * Self-contained & deterministik (adapter mock + router mock) — tidak butuh
 * WhatsApp/9Router nyata. Untuk uji jalur HTTP/Cloud asli, jalankan server (`npm run -w @vc/server dev`).
 *
 * Jalankan: `npm run spike:wa`
 */

import {
  InMemoryMemoryStore,
  MockRouterClient,
  SkillRegistry,
  createWebSearchSkill,
  textResponse,
} from "@vc/agent-runtime";
import {
  MockWhatsAppAdapter,
  OwnerAuth,
  WaRelay,
  createAgentReplyHandler,
  makeFrontDeskManager,
} from "@vc/server";

const OWNER = "+62 812-3456-7890"; // "nomormu"
const STRANGER = "+1 555 000 1111"; // nomor lain

async function main(): Promise<void> {
  const adapter = new MockWhatsAppAdapter();
  const ownerAuth = new OwnerAuth([OWNER]);

  // Handler memakai agent loop dengan router mock (balas tetap, tanpa tool).
  const skills = new SkillRegistry().register(createWebSearchSkill());
  const memory = new InMemoryMemoryStore();
  const router = new MockRouterClient([textResponse("Halo! Ada yang bisa saya bantu hari ini?")]);
  const handler = createAgentReplyHandler(makeFrontDeskManager(), { router, skills, memory });

  const relay = new WaRelay({
    adapter,
    ownerAuth,
    handler,
    unknownReply: "Maaf, nomor Anda tidak terdaftar.",
    log: (l) => console.log(l),
  });

  const now = Date.now();

  console.log("\n=== Kasus 1: pesan dari OWNER ===");
  const r1 = await relay.handleInbound(adapter.makeInbound(OWNER, "Halo, apa kabar tim?", now));
  console.log("outcome:", r1);
  console.log("balasan terkirim:", adapter.lastSent());

  console.log("\n=== Kasus 2: pesan dari NOMOR LAIN ===");
  const sentBefore = adapter.sent.length;
  const r2 = await relay.handleInbound(adapter.makeInbound(STRANGER, "Saya mau kendalikan agent", now));
  console.log("outcome:", r2);

  // Verifikasi DoD.
  const ownerReplied = r1.authorized && r1.action === "replied";
  const strangerRejected = !r2.authorized && r2.action.startsWith("rejected_unknown");
  // Pastikan stranger TIDAK memicu handler (tidak ada balasan agent untuknya);
  // hanya balasan default yang boleh keluar.
  const strangerDidNotDriveAgent = r2.action !== "replied";
  console.log(`\nowner dibalas otomatis: ${ownerReplied}`);
  console.log(`nomor lain ditolak: ${strangerRejected}`);
  console.log(`nomor lain TIDAK menyetir agent: ${strangerDidNotDriveAgent}`);
  void sentBefore;

  const ok = ownerReplied && strangerRejected && strangerDidNotDriveAgent;
  console.log(`\n${ok ? "✓ DoD TERPENUHI" : "✗ DoD BELUM terpenuhi"}.`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("✗ Error:", err);
  process.exitCode = 1;
});
