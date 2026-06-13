/// <reference types="vite/client" />

/** Env build-time yang dipakai web (di-inject Vite saat build). */
interface ImportMetaEnv {
  /** Token bearer untuk REST/realtime bila server dilindungi (BUG-107/108). Lihat apps/web/src/api.ts. */
  readonly VITE_API_AUTH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
