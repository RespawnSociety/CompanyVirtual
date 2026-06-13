/**
 * Skill outreach (Phase 5.1, plan §5) — `send_outreach`: kirim pesan penjualan 1:1 ke
 * calon pembeli (email / DM / WhatsApp). `risky: true` → WAJIB lewat approval gate.
 *
 * Pola IDENTIK dengan skill sosial (`socialPost.ts`): skill generik, provider di-inject,
 * default mock/dry-run deterministik (tanpa jaringan/akun) untuk tes & dev. Tujuannya
 * membuktikan engine GENERIK: departemen Sales memakai aksi eksternal berbeda (kirim pesan,
 * bukan publish sosmed) tanpa mengubah engine/loop — hanya menambah skill + template.
 *
 * Kredensial (mis. SMTP/token) dibaca provider dari `ctx.vault` (TIDAK pernah masuk
 * prompt/log). Tiap aksi dicatat ke audit (`ctx.audit`) dengan PREVIEW, bukan secret.
 */

import type { JsonSchema, Skill, SkillContext, VaultReader } from "@vc/shared";

export type OutreachChannel = "email" | "dm" | "whatsapp";

/** Channel yang diizinkan (least-privilege §4.4). */
const ALLOWED_CHANNELS: ReadonlySet<OutreachChannel> = new Set(["email", "dm", "whatsapp"]);

export interface OutreachRequest {
  channel: OutreachChannel;
  /** Penerima: alamat email / handle DM / nomor WA. */
  recipient: string;
  /** Subjek (relevan untuk email). */
  subject?: string;
  message: string;
}

export interface OutreachContext {
  vault: VaultReader;
  signal?: AbortSignal;
}

export interface OutreachResult {
  ok: boolean;
  channel: OutreachChannel;
  /** true bila tidak benar-benar terkirim (provider mock/dry-run). */
  dryRun: boolean;
  /** Id pesan (palsu saat dry-run). */
  messageId?: string;
  note?: string;
}

/** Provider yang benar-benar (atau pura-pura) mengirim outreach. */
export interface OutreachSender {
  send(req: OutreachRequest, ctx: OutreachContext): Promise<OutreachResult>;
}

/** Hash deterministik kecil (djb2) → id pesan stabil untuk mode dry-run (tanpa clock/acak). */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Provider MOCK/dry-run: tidak menyentuh jaringan, deterministik. Mensimulasikan pengiriman
 * (mengembalikan messageId palsu) agar pipeline + approval + audit bisa diuji penuh tanpa
 * akun/kredensial. Provider nyata (SMTP/API) menyusul; aktifkan via env saat siap.
 */
export function mockOutreachSender(): OutreachSender {
  return {
    send(req: OutreachRequest): Promise<OutreachResult> {
      const tag = shortHash(`${req.channel}|${req.recipient}|${req.message}`);
      return Promise.resolve({
        ok: true,
        channel: req.channel,
        dryRun: true,
        messageId: `mock-${req.channel}-${tag}`,
        note: "DRY-RUN: tidak benar-benar terkirim (provider mock). Provider nyata menyusul.",
      });
    },
  };
}

/**
 * Normalisasi channel. BUG-116: HANYA kosong/undefined yang default ke `email`; string yang
 * TIDAK dikenal (mis. "telegram") → `undefined` agar ditolak allowlist (bukan diam-diam jadi email).
 */
function normalizeChannel(v: unknown): OutreachChannel | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return "email"; // tak diisi → default email
  if (s === "email" || s === "mail") return "email";
  if (s === "dm" || s === "directmessage" || s === "direct_message") return "dm";
  if (s === "whatsapp" || s === "wa") return "whatsapp";
  return undefined; // tidak dikenal → invalid (ditolak di handler)
}

/** Susun preview manusiawi (untuk approval & audit). Bukan secret. */
function buildPreview(req: OutreachRequest): string {
  const lines = [`Channel: ${req.channel}`, `Ke: ${req.recipient}`];
  if (req.subject) lines.push(`Subjek: ${req.subject}`);
  lines.push("Pesan:", req.message);
  return lines.join("\n");
}

interface OutreachSkillInput {
  channel?: string;
  recipient?: string;
  subject?: string;
  message?: string;
}

const OUTREACH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    channel: { type: "string", description: "Channel kirim: email | dm | whatsapp (default email)." },
    recipient: { type: "string", description: "Penerima: alamat email / handle DM / nomor WhatsApp." },
    subject: { type: "string", description: "Subjek (terutama untuk email)." },
    message: { type: "string", description: "Isi pesan outreach/penawaran." },
  },
  required: ["recipient", "message"],
};

/**
 * `send_outreach` — kirim pesan penjualan 1:1. AKSI BERISIKO (kontak pihak luar) → approval-gated.
 * Provider di-inject (default mock/dry-run). Audit aksi (sukses & gagal) tanpa secret.
 */
export function createSendOutreachSkill(
  sender: OutreachSender,
): Skill<OutreachSkillInput, OutreachResult> {
  return {
    name: "send_outreach",
    description:
      "Kirim pesan penjualan/penawaran 1:1 ke calon pembeli (email | dm | whatsapp). " +
      "AKSI BERISIKO — wajib approval. Kembalikan id pesan (atau dry-run).",
    paramsSchema: OUTREACH_SCHEMA,
    risky: true,
    handler: async (input: OutreachSkillInput, ctx: SkillContext): Promise<OutreachResult> => {
      const message = (input.message ?? "").trim();
      if (!message) throw new Error("send_outreach: 'message' wajib diisi");
      const recipient = (input.recipient ?? "").trim();
      if (!recipient) throw new Error("send_outreach: 'recipient' wajib diisi");
      const channel = normalizeChannel(input.channel);
      // BUG-116: channel tak dikenal → tolak (jangan fallback ke email). Tool run gagal → engine blokir.
      if (!channel || !ALLOWED_CHANNELS.has(channel)) {
        throw new Error(
          `send_outreach: channel '${String(input.channel)}' tidak diizinkan (email|dm|whatsapp).`,
        );
      }

      const req: OutreachRequest = {
        channel,
        recipient,
        message,
        ...(input.subject ? { subject: String(input.subject).trim() } : {}),
      };
      const preview = buildPreview(req);

      let result: OutreachResult;
      try {
        result = await sender.send(req, {
          vault: ctx.vault,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
      } catch (err) {
        // BUG-114 pattern: kegagalan kirim WAJIB ter-audit, lalu rethrow agar engine memblokir
        // run (jangan diam-diam `done`). `reason` non-secret.
        const reason = err instanceof Error ? err.message : String(err);
        await ctx.audit?.({ action: "send_outreach_failed", detail: { channel, preview, reason } });
        throw err;
      }

      // BUG-117: provider yang mengembalikan ok:false (tanpa throw) TETAP kegagalan — jangan
      // audit/return sukses. Audit failure + throw → tool run gagal → engine blokir run (bukan `done`).
      if (!result.ok) {
        const reason = result.note ?? "provider menolak (ok:false)";
        await ctx.audit?.({
          action: "send_outreach_failed",
          detail: { channel, preview, reason, dryRun: result.dryRun },
        });
        throw new Error(`send_outreach: gagal kirim — ${reason}`);
      }

      // Audit aksi eksternal (§4.3): preview + hasil (TANPA secret).
      await ctx.audit?.({
        action: "send_outreach",
        detail: {
          channel,
          dryRun: result.dryRun,
          preview,
          messageId: result.messageId,
        },
      });

      return result;
    },
  };
}
