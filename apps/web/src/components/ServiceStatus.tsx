/**
 * ServiceStatus — indikator layanan lokal untuk shell desktop (Phase 6.1: "memantau").
 * Hanya tampil saat web berjalan di dalam Tauri; di browser biasa komponen ini me-render
 * null (tak ada shell yang memantau service). Polling ringan tiap beberapa detik via command
 * `service_status` (lihat apps/web/src/desktop.ts). Tidak ada panggilan LLM — sekadar cek port.
 */

import { useEffect, useState } from "react";
import { getServiceStatus, isDesktop, type ServiceStatus as Status } from "../desktop.js";

const POLL_MS = 3000;

function Dot({ label, ok }: { label: string; ok: boolean }): JSX.Element {
  return (
    <span className="svc" title={`${label}: ${ok ? "hidup" : "mati"}`}>
      <span className={`conn-dot ${ok ? "on" : "down"}`} />
      {label}
    </span>
  );
}

export function ServiceStatus(): JSX.Element | null {
  const [status, setStatus] = useState<Status | null>(null);
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    let stop = false;
    const tick = async (): Promise<void> => {
      const s = await getServiceStatus();
      if (!stop) setStatus(s);
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div className="svc-status" title="Status layanan lokal (shell desktop)">
      <Dot label="Server" ok={status?.server ?? false} />
      <Dot label="9Router" ok={status?.ninerouter ?? false} />
      <Dot label="DB" ok={status?.database ?? false} />
    </div>
  );
}
