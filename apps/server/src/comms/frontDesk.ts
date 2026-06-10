/**
 * Front-desk handler — menghubungkan WaRelay ke agent loop runtime.
 * Manager bertindak sebagai "wajah" perusahaan (plan §7.2): semua balasan keluar
 * darinya; agent lain dipanggil internal (Phase 3).
 *
 * Catatan: persona Manager di sini adalah SEED SPIKE (Phase 0). Mulai Phase 1 ia
 * digantikan AgentProfile yang dikonfigurasi user lewat Character Editor — bukan hardcode.
 */

import type { AgentProfile } from "@vc/shared";
import { runAgentLoop, type RunAgentLoopDeps } from "@vc/agent-runtime";
import type { InboundMessage } from "./types.js";
import type { MessageHandler } from "./relay.js";

/** AgentProfile Manager front-desk untuk spike. */
export function makeFrontDeskManager(): AgentProfile {
  return {
    id: "agent-manager-frontdesk",
    departmentId: "dept-spike",
    name: "Manager",
    role: "Front Desk Manager",
    deskPos: { x: 0, y: 0 },
    spriteKey: "manager",
    description:
      "Kamu adalah Manager perusahaan virtual. Jawab pesan owner dengan sopan, ringkas, " +
      "dan membantu. Gunakan tool bila perlu informasi terkini.",
    skillScope: ["web_search"],
    guardrails: [{ rule: "Jangan melakukan aksi eksternal berisiko tanpa approval." }],
    memoryNamespace: "spike:manager",
    status: "idle",
  };
}

/**
 * Bungkus agent loop jadi MessageHandler untuk WaRelay.
 * Bila loop gagal (mis. 9Router offline), kembalikan balasan graceful — bukan crash.
 */
export function createAgentReplyHandler(
  agent: AgentProfile,
  deps: RunAgentLoopDeps,
): MessageHandler {
  return async (msg: InboundMessage): Promise<string | null> => {
    try {
      const res = await runAgentLoop(agent, msg.text, deps);
      if (res.status === "blocked" && res.pendingApproval) {
        // CR-001: Phase 0 belum punya pending-approval store / resume APPROVE-REVISI.
        // Jangan menjanjikan alur inline yang belum ada; cukup laporkan aksi tertahan.
        return (
          `Aksi ini butuh persetujuan dan sudah ditandai pending: ${res.pendingApproval.summary}. ` +
          `Aku tahan dulu — alur approve/revisi via WhatsApp menyusul.`
        );
      }
      return res.finalText ?? "(belum ada balasan dari agent)";
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return `Maaf, sistem sedang tidak bisa memproses pesanmu (otak/9Router: ${detail}). Coba lagi sebentar lagi.`;
    }
  };
}
