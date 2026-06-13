/**
 * Skill sosial (Phase 4.2, plan §5/§7.4) — `ig_post`, `twitter_post`, `schedule_post`.
 * SEMUA `risky: true` → WAJIB lewat approval gate (loop/engine). Posting NYATA lewat
 * provider yang bisa di-plug (keputusan owner: Playwright browser; default mock/dry-run
 * deterministik untuk tes & dev tanpa akun/browser).
 *
 * Pola sama dgn web_search/web_fetch: skill generik, provider di-inject. Kredensial dibaca
 * provider dari `ctx.vault` (TIDAK pernah masuk prompt/log). Tiap aksi dicatat ke audit
 * (`ctx.audit`) dengan PREVIEW (apa yang akan diposting), bukan secret.
 */

import type { JsonSchema, Skill, SkillContext, VaultReader } from "@vc/shared";

export type SocialPlatform = "instagram" | "twitter";

/** Platform yang diizinkan (least-privilege §4.4): hanya IG & Twitter/X. */
const ALLOWED_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(["instagram", "twitter"]);

export interface PublishRequest {
  platform: SocialPlatform;
  content: string;
  mediaUrl?: string;
  /** Epoch ms bila dijadwalkan (schedule_post); absent = posting segera. */
  scheduledFor?: number;
}

export interface PublishContext {
  vault: VaultReader;
  signal?: AbortSignal;
}

export interface SocialPostResult {
  ok: boolean;
  platform: SocialPlatform;
  /** true bila tidak benar-benar terbit (provider mock/dry-run). */
  dryRun: boolean;
  postId?: string;
  url?: string;
  /** Epoch ms jadwal terbit (bila schedule_post). */
  scheduledFor?: number;
  note?: string;
}

/** Provider yang benar-benar (atau pura-pura) memposting. */
export interface PostPublisher {
  publish(req: PublishRequest, ctx: PublishContext): Promise<SocialPostResult>;
}

/** Hash deterministik kecil (djb2) → id post stabil untuk mode dry-run (tanpa clock/acak). */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Provider MOCK/dry-run: tidak menyentuh jaringan, deterministik. Mensimulasikan posting
 * (mengembalikan post-id & url palsu) agar pipeline + approval + audit bisa diuji penuh
 * tanpa akun/kredensial. Aktifkan provider nyata via env saat siap (lihat createPostPublisherFromEnv).
 */
export function mockPostPublisher(): PostPublisher {
  return {
    publish(req: PublishRequest): Promise<SocialPostResult> {
      const tag = shortHash(`${req.platform}|${req.content}|${req.scheduledFor ?? ""}`);
      const result: SocialPostResult = {
        ok: true,
        platform: req.platform,
        dryRun: true,
        postId: `mock-${req.platform}-${tag}`,
        url: `https://dry-run.local/${req.platform}/${tag}`,
        note: "DRY-RUN: tidak benar-benar terbit (provider mock). Set POST_PROVIDER=playwright untuk posting nyata.",
        ...(req.scheduledFor !== undefined ? { scheduledFor: req.scheduledFor } : {}),
      };
      return Promise.resolve(result);
    },
  };
}

function normalizePlatform(v: unknown): SocialPlatform {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "x" || s === "twitter") return "twitter";
  if (s === "ig" || s === "instagram") return "instagram";
  return "instagram";
}

/** Parse `scheduleAt` (ISO atau epoch ms) → epoch ms; lempar bila tak valid. */
function parseScheduleAt(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s) throw new Error("schedule_post: 'scheduleAt' wajib diisi (ISO datetime atau epoch ms).");
  const asNum = Number(s);
  const ms = Number.isFinite(asNum) && /^\d+$/.test(s) ? asNum : Date.parse(s);
  if (!Number.isFinite(ms)) throw new Error(`schedule_post: 'scheduleAt' tak bisa diparse: ${s}`);
  return ms;
}

/** Susun preview manusiawi (untuk approval & audit). Bukan secret. */
function buildPreview(req: PublishRequest): string {
  const lines = [`Platform: ${req.platform}`];
  if (req.scheduledFor !== undefined) lines.push(`Jadwal: ${new Date(req.scheduledFor).toISOString()}`);
  if (req.mediaUrl) lines.push(`Media: ${req.mediaUrl}`);
  lines.push("Konten:", req.content);
  return lines.join("\n");
}

interface SocialSkillInput {
  content?: string;
  mediaUrl?: string;
  scheduleAt?: string;
  platform?: string;
}

/** Bangun handler bersama untuk skill sosial (publish + audit). */
function makeHandler(
  name: string,
  resolvePlatform: (input: SocialSkillInput) => SocialPlatform,
  publisher: PostPublisher,
  opts: { scheduled?: boolean } = {},
) {
  return async (input: SocialSkillInput, ctx: SkillContext): Promise<SocialPostResult> => {
    const content = (input.content ?? "").trim();
    if (!content) throw new Error(`${name}: 'content' wajib diisi`);
    const platform = resolvePlatform(input);
    if (!ALLOWED_PLATFORMS.has(platform)) {
      throw new Error(`${name}: platform '${platform}' tidak diizinkan (hanya instagram/twitter).`);
    }

    const req: PublishRequest = {
      platform,
      content,
      ...(input.mediaUrl ? { mediaUrl: String(input.mediaUrl).trim() } : {}),
      ...(opts.scheduled ? { scheduledFor: parseScheduleAt(input.scheduleAt) } : {}),
    };

    const preview = buildPreview(req);
    let result: SocialPostResult;
    try {
      result = await publisher.publish(req, {
        vault: ctx.vault,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
    } catch (err) {
      // BUG-114: publish GAGAL (kredensial/Playwright/network) WAJIB ter-audit, lalu rethrow
      // agar engine memblokir run (jangan diam-diam `done`). `reason` non-secret.
      const reason = err instanceof Error ? err.message : String(err);
      await ctx.audit?.({
        action: `${name}_failed`,
        detail: { platform, preview, reason },
      });
      throw err;
    }

    // Audit aksi eksternal (§4.3): preview + hasil (TANPA secret).
    await ctx.audit?.({
      action: name,
      detail: {
        platform,
        dryRun: result.dryRun,
        preview,
        postId: result.postId,
        url: result.url,
        ...(result.scheduledFor !== undefined ? { scheduledFor: result.scheduledFor } : {}),
      },
    });

    return result;
  };
}

const CONTENT_SCHEMA = (extra: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: "object",
  properties: {
    content: { type: "string", description: "Teks konten yang akan diposting." },
    mediaUrl: { type: "string", description: "URL gambar/video opsional." },
    ...extra,
  },
  required,
});

export function createIgPostSkill(publisher: PostPublisher): Skill<SocialSkillInput, SocialPostResult> {
  return {
    name: "ig_post",
    description:
      "Publish konten ke Instagram. AKSI BERISIKO — wajib approval. Kembalikan id/url post (atau dry-run).",
    paramsSchema: CONTENT_SCHEMA({}, ["content"]),
    risky: true,
    handler: makeHandler("ig_post", () => "instagram", publisher),
  };
}

export function createTwitterPostSkill(
  publisher: PostPublisher,
): Skill<SocialSkillInput, SocialPostResult> {
  return {
    name: "twitter_post",
    description:
      "Publish konten ke Twitter/X. AKSI BERISIKO — wajib approval. Kembalikan id/url post (atau dry-run).",
    paramsSchema: CONTENT_SCHEMA({}, ["content"]),
    risky: true,
    handler: makeHandler("twitter_post", () => "twitter", publisher),
  };
}

export function createSchedulePostSkill(
  publisher: PostPublisher,
): Skill<SocialSkillInput, SocialPostResult> {
  return {
    name: "schedule_post",
    description:
      "Jadwalkan publish konten ke sosmed (platform: instagram|twitter) pada waktu tertentu. " +
      "AKSI BERISIKO — wajib approval.",
    paramsSchema: CONTENT_SCHEMA(
      {
        platform: { type: "string", description: "Platform: instagram | twitter (default instagram)." },
        scheduleAt: { type: "string", description: "Waktu terbit: ISO datetime atau epoch ms." },
      },
      ["content", "scheduleAt"],
    ),
    risky: true,
    handler: makeHandler(
      "schedule_post",
      (input) => normalizePlatform(input.platform),
      publisher,
      { scheduled: true },
    ),
  };
}
