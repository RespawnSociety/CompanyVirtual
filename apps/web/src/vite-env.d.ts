/// <reference types="vite/client" />

/** Env build-time yang dipakai web (di-inject Vite saat build). */
interface ImportMetaEnv {
  /** Token bearer untuk REST/realtime bila server dilindungi (BUG-107/108). Lihat apps/web/src/api.ts. */
  readonly VITE_API_AUTH_TOKEN?: string;
  /**
   * Origin server absolut (Phase 6). Kosong → URL relatif (browser/dev, di-proxy Vite).
   * Di-set (mis. `http://127.0.0.1:8787`) untuk shell desktop Tauri. Lihat apps/web/src/api.ts.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
