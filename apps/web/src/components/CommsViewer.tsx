/**
 * CommsViewer (roadmap 1.7) — penampil percakapan owner↔agent. Sejak Phase 6 terisi NYATA:
 * setiap agent "bicara" di sini — output tiap langkah workflow, permintaan approval, jawaban
 * single-agent, & notifikasi — tersimpan & tampil per company, walau WhatsApp mock/tak
 * terkonfigurasi. Saat masih kosong → tampilkan empty state (bukan contoh palsu).
 */

import { useEffect, useState } from "react";
import type { CommsMessage } from "@vc/shared";
import { api } from "../api.js";

export function CommsViewer({
  companyId,
  refreshTick,
}: {
  companyId: string | null;
  refreshTick?: number;
}): JSX.Element {
  const [msgs, setMsgs] = useState<CommsMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  // CR-109: bersihkan data company lama HANYA saat ganti company (bukan tiap refreshTick) agar
  // refetch live tak berkedip kosong→isi.
  useEffect(() => {
    setMsgs([]);
    setLoaded(false);
  }, [companyId]);

  // Fetch saat company berganti ATAU ada event agent baru (refreshTick, Phase 6) → Comms live.
  useEffect(() => {
    if (!companyId) return;
    let ignore = false;
    api
      .listComms(companyId)
      .then((m) => {
        if (!ignore) setMsgs(m);
      })
      .catch(() => {
        if (!ignore) setMsgs([]);
      })
      .finally(() => {
        if (!ignore) setLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, [companyId, refreshTick]);

  if (!companyId) {
    return (
      <div className="panel">
        <p className="empty">Pilih company dulu.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Comms Viewer</h2>
      {loaded && msgs.length === 0 ? (
        <p className="empty">
          Belum ada percakapan. Beri arahan ke karakter (tab Kantor) atau jalankan workflow (tab
          Workflow) — pesan tiap agent akan muncul di sini.
        </p>
      ) : (
        <div className="list">
          {msgs.map((m) => {
            const fromUser = m.from === "user";
            return (
              <div
                className="card"
                key={m.id}
                style={{
                  alignSelf: fromUser ? "flex-start" : "flex-end",
                  maxWidth: "75%",
                  borderColor: fromUser ? "var(--border)" : "var(--accent)",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div className="sub">
                  {String(m.from)} → {String(m.to)} · {m.channel}
                </div>
                <div>{m.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
