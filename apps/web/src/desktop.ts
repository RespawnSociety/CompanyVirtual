/**
 * Jembatan opsional ke shell desktop Tauri (Phase 6). Web TIDAK bergantung pada paket Tauri:
 * saat dijalankan di dalam shell, Tauri meng-inject global `window.__TAURI__` (config
 * `app.withGlobalTauri = true`). Di browser biasa global itu tidak ada → semua fungsi di sini
 * menjadi no-op (mengembalikan null/false), sehingga web tetap jalan di browser (DoD 6.2).
 */

/** Status layanan lokal yang dipantau shell desktop (cermin `StatusReport` di src-tauri/service.rs). */
export interface ServiceStatus {
  /** Orchestrator (apps/server) yang dijalankan & dipantau shell — true bila port menerima koneksi. */
  server: boolean;
  /** 9Router lokal (gateway LLM) — true bila port-nya hidup. */
  ninerouter: boolean;
  /** MySQL/MariaDB (XAMPP) — true bila port-nya hidup. */
  database: boolean;
  /** Apakah orchestrator dijalankan oleh shell ini (true) atau hanya dipantau (false). */
  managed: boolean;
}

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

function tauri(): TauriGlobal | null {
  const w = window as unknown as { __TAURI__?: TauriGlobal };
  return w.__TAURI__ ?? null;
}

/** True bila web sedang berjalan di dalam shell desktop Tauri. */
export function isDesktop(): boolean {
  return tauri() !== null;
}

/**
 * Minta status layanan lokal ke shell desktop. Mengembalikan null di browser (bukan desktop)
 * atau bila command gagal — pemanggil memperlakukan null sebagai "tak ada info status".
 */
export async function getServiceStatus(): Promise<ServiceStatus | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return await t.core.invoke<ServiceStatus>("service_status");
  } catch {
    return null;
  }
}

/** Minta shell me-restart orchestrator lokal. No-op (false) di browser. */
export async function restartServer(): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  try {
    await t.core.invoke<null>("restart_server");
    return true;
  } catch {
    return false;
  }
}
