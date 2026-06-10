/**
 * WaRelay — inti spike §0.5 (plan §7.2/§7.3).
 *
 * Alur auto-reply:
 *   pesan masuk → cek pengirim ∈ owner/whitelist?
 *     ya  → handler (Manager "front desk") menghasilkan balasan → kirim balik
 *     tdk → balasan default sopan ATAU diabaikan (configurable); TIDAK menyetir agent
 *
 * Relay agnostik terhadap adapter (mock/cloud/baileys) dan terhadap handler
 * (handler bisa membungkus agent loop runtime).
 */

import type { ChannelAdapter, InboundMessage } from "./types.js";
import type { OwnerAuth } from "./ownerAuth.js";

/** Penghasil balasan untuk pesan owner. Return null = tidak membalas. */
export type MessageHandler = (msg: InboundMessage) => Promise<string | null>;

export type RelayAction =
  | "replied"
  | "no_reply"
  | "rejected_unknown_ignored"
  | "rejected_unknown_default_reply";

export interface RelayOutcome {
  authorized: boolean;
  action: RelayAction;
  reply?: string;
}

export interface WaRelayOptions {
  adapter: ChannelAdapter;
  ownerAuth: OwnerAuth;
  handler: MessageHandler;
  /**
   * Balasan default untuk nomor tak dikenal. Bila null/undefined → diabaikan diam-diam
   * (tidak ada balasan). Bila string → kirim balasan sopan itu.
   */
  unknownReply?: string | null;
  /** Logger opsional (default: console). Berguna untuk observability/audit ringan. */
  log?: (line: string) => void;
}

export class WaRelay {
  private readonly adapter: ChannelAdapter;
  private readonly ownerAuth: OwnerAuth;
  private readonly handler: MessageHandler;
  private readonly unknownReply: string | null;
  private readonly log: (line: string) => void;

  constructor(opts: WaRelayOptions) {
    this.adapter = opts.adapter;
    this.ownerAuth = opts.ownerAuth;
    this.handler = opts.handler;
    this.unknownReply = opts.unknownReply ?? null;
    this.log = opts.log ?? ((l) => console.log(l));
  }

  /** Proses satu pesan masuk; kembalikan ringkasan apa yang dilakukan. */
  async handleInbound(msg: InboundMessage): Promise<RelayOutcome> {
    if (!this.ownerAuth.isAllowed(msg.from)) {
      // OWNER AUTH: nomor tak dikenal tidak boleh menyetir agent.
      if (this.unknownReply) {
        await this.adapter.send({ to: msg.from, text: this.unknownReply });
        this.log(`[relay] DITOLAK (unknown) ${mask(msg.from)} → balasan default`);
        return { authorized: false, action: "rejected_unknown_default_reply", reply: this.unknownReply };
      }
      this.log(`[relay] DITOLAK (unknown) ${mask(msg.from)} → diabaikan`);
      return { authorized: false, action: "rejected_unknown_ignored" };
    }

    // Owner → jalankan handler (auto-reply, mis. via agent loop).
    const reply = await this.handler(msg);
    if (reply == null || reply.trim() === "") {
      this.log(`[relay] OWNER ${mask(msg.from)} → handler tanpa balasan`);
      return { authorized: true, action: "no_reply" };
    }
    await this.adapter.send({ to: msg.from, text: reply });
    this.log(`[relay] OWNER ${mask(msg.from)} → dibalas (${reply.length} char)`);
    return { authorized: true, action: "replied", reply };
  }
}

/** Samar sebagian nomor di log (jangan bocorkan nomor lengkap). */
function mask(num: string): string {
  const d = num.replace(/\D+/g, "");
  if (d.length <= 4) return "***";
  return `${d.slice(0, 2)}***${d.slice(-2)}`;
}
