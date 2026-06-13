/**
 * PostPublisher berbasis Playwright (Phase 4.2) — jalur posting NYATA via otomasi browser
 * (keputusan owner). OPT-IN: hanya dipakai bila `POST_PROVIDER=playwright`. Default platform
 * tetap mock (lihat socialPost.ts) agar tes/dev jalan tanpa browser/akun.
 *
 * Keamanan & least-privilege (§4.4):
 * - Kredensial (username/password/session) dibaca dari Vault (`ctx.vault`) — TAK pernah di-log.
 * - Navigasi DIBATASI ke domain allowlist per platform (cegah agent "nyasar" ke domain lain).
 * - `playwright` di-import dinamis (dependensi opsional). Bila belum terpasang → error jelas.
 *
 * CATATAN: selektor UI IG/Twitter berubah-ubah & rawan ToS; flow di sini sengaja defensif &
 * minimal. "Terbit di akun test" butuh: `npm i -D playwright` + `npx playwright install chromium`
 * + simpan kredensial via `npm run vault`. Lihat docs/RUNBOOK.md (Phase 4).
 */

import type { PostPublisher, PublishContext, PublishRequest, SocialPlatform, SocialPostResult } from "./socialPost.js";
import { mockPostPublisher } from "./socialPost.js";

/** Domain yang boleh dikunjungi per platform (least-privilege). */
const ALLOWED_HOSTS: Record<SocialPlatform, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  twitter: ["x.com", "twitter.com", "mobile.twitter.com"],
};

/** Key Vault untuk kredensial per platform. */
function credKeys(platform: SocialPlatform): { user: string; pass: string; session: string } {
  return {
    user: `${platform}.username`,
    pass: `${platform}.password`,
    session: `${platform}.sessionState`, // storageState JSON (opsi tanpa login ulang)
  };
}

export interface PlaywrightPublisherOptions {
  /** Jalankan browser tanpa UI (default true). */
  headless?: boolean;
  /** Timeout aksi browser (ms, default 30000). */
  timeoutMs?: number;
}

// Tipe minimal Playwright yang kita pakai (paket = dependensi OPSIONAL, tak di-import statis
// agar typecheck/build tak butuh playwright terpasang). Sengaja subset, bukan tipe penuh.
interface PwRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PwPage {
  setDefaultTimeout(ms: number): void;
}
interface PwContext {
  route(pattern: string, handler: (route: PwRoute) => void): Promise<void>;
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts?: { storageState?: object }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: { launch(opts?: { headless?: boolean }): Promise<PwBrowser> };
}

/**
 * Buat publisher Playwright. Tidak meng-import playwright sampai `publish` dipanggil
 * (dependensi opsional). Melempar error jelas bila playwright/kredensial tak tersedia.
 */
export function createPlaywrightPostPublisher(opts: PlaywrightPublisherOptions = {}): PostPublisher {
  const headless = opts.headless ?? true;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async publish(req: PublishRequest, ctx: PublishContext): Promise<SocialPostResult> {
      const playwright = await loadPlaywright();
      const keys = credKeys(req.platform);
      const sessionState = await ctx.vault.get(keys.session);
      const username = await ctx.vault.get(keys.user);
      const password = await ctx.vault.get(keys.pass);
      if (!sessionState && !(username && password)) {
        throw new Error(
          `Kredensial ${req.platform} tak ada di Vault. Simpan '${keys.session}' (storageState) ` +
            `atau '${keys.user}'+'${keys.pass}' via \`npm run vault\`.`,
        );
      }

      const browser = await playwright.chromium.launch({ headless });
      try {
        const context = await browser.newContext(
          sessionState ? { storageState: JSON.parse(sessionState) as object } : {},
        );
        // Least-privilege: blokir navigasi ke domain di luar allowlist platform.
        const allowed = ALLOWED_HOSTS[req.platform];
        await context.route("**/*", (route) => {
          const host = safeHost(route.request().url());
          if (host && !allowed.some((h) => host === h || host.endsWith(`.${h}`))) {
            void route.abort();
          } else {
            void route.continue();
          }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);

        // NOTE: implementasi posting nyata per platform diisi di sini (login bila perlu →
        // buka composer → isi konten/media → submit). Selektor sengaja TIDAK di-hardcode
        // karena UI berubah; operator melengkapi sesuai versi UI saat deploy.
        await postToPlatform(page, req, { username, password });

        return {
          ok: true,
          platform: req.platform,
          dryRun: false,
          note: "Posting via Playwright dikirim.",
          ...(req.scheduledFor !== undefined ? { scheduledFor: req.scheduledFor } : {}),
        };
      } finally {
        await browser.close();
      }
    },
  };
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Dynamic import playwright (dependensi OPSIONAL). Specifier non-literal agar TS tak mencoba
 * me-resolve tipe modul saat build (paket belum terpasang). Gagal → error jelas saat runtime.
 */
async function loadPlaywright(): Promise<PlaywrightModule> {
  const spec = "playwright";
  try {
    const mod = (await import(spec)) as unknown as PlaywrightModule;
    return mod;
  } catch {
    throw new Error(
      "Provider 'playwright' dipilih tapi paket belum terpasang. Jalankan: " +
        "`npm i -D playwright` lalu `npx playwright install chromium`.",
    );
  }
}

/**
 * Placeholder aksi posting per platform. Sengaja dipisah agar operator/kontributor
 * mengisi langkah UI (login + composer + submit) sesuai versi UI live + akun test.
 * Default: melempar agar tak ada false-positive "terbit" padahal belum diimplementasi.
 */
async function postToPlatform(
  _page: unknown,
  req: PublishRequest,
  _creds: { username?: string; password?: string },
): Promise<void> {
  throw new Error(
    `Otomasi posting ${req.platform} via Playwright belum diisi (selektor UI). ` +
      "Lengkapi postToPlatform() sesuai UI akun test, atau pakai POST_PROVIDER=mock untuk dry-run.",
  );
}

export type PostProviderMode = "mock" | "playwright";

/**
 * Pilih PostPublisher dari env `POST_PROVIDER` (default "mock"):
 * - "mock"       → dry-run deterministik (tanpa browser/akun).
 * - "playwright" → posting nyata via browser (butuh playwright + kredensial Vault).
 */
export function createPostPublisherFromEnv(env: NodeJS.ProcessEnv = process.env): PostPublisher {
  const mode = (env.POST_PROVIDER?.trim().toLowerCase() || "mock") as PostProviderMode;
  if (mode === "playwright") {
    return createPlaywrightPostPublisher({
      headless: env.POST_PLAYWRIGHT_HEADLESS !== "false",
    });
  }
  return mockPostPublisher();
}
