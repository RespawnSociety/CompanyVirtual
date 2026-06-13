/**
 * DirectiveComposer (Phase 2.3) — kirim arahan ke SATU karakter. Pilih agent, ketik arahan,
 * kirim → server membuat Directive + Task lalu menjalankan agent loop (animasi via agent:event,
 * hasil jadi Artifact di Task Board). "ketik arahan → karakter bekerja" (DoD Fase 2).
 */

import { useEffect, useState } from "react";
import type { WorldSnapshot } from "@vc/shared";
import { api } from "../api.js";
import { useAsyncAction } from "../hooks/useAsyncAction.js";

export function DirectiveComposer({
  world,
  onSent,
}: {
  world: WorldSnapshot | null;
  onSent?: () => void;
}): JSX.Element {
  const agents = world?.agents ?? [];
  const [agentId, setAgentId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAsyncAction();

  // Default agent = pertama; rekonsiliasi bila daftar berubah / pilihan hilang.
  useEffect(() => {
    setAgentId((cur) => (cur && agents.some((a) => a.id === cur) ? cur : agents[0]?.id ?? ""));
  }, [agents]);

  const send = (): void => {
    const t = text.trim();
    if (!agentId || !t) return;
    void run(async () => {
      const res = await api.sendDirective(agentId, t);
      const who = agents.find((a) => a.id === agentId);
      setNote(`Arahan terkirim ke ${who?.name ?? "agent"} — task dibuat (${res.task.status}).`);
      setText("");
      onSent?.();
    });
  };

  return (
    <div className="panel" style={{ minWidth: 240 }}>
      <h2>Beri Arahan</h2>
      {agents.length === 0 ? (
        <p className="muted">Belum ada karakter. Tambah departemen/karakter dulu.</p>
      ) : (
        <>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={busy}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.role}
              </option>
            ))}
          </select>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mis. Tulis caption promo diskon akhir pekan untuk Instagram"
            rows={3}
            style={{ width: "100%", marginTop: 6 }}
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !text.trim()} style={{ marginTop: 6 }}>
            {busy ? "Mengirim…" : "Kirim arahan"}
          </button>
          {note && <p className="hint">{note}</p>}
          {error && <p className="hint" style={{ color: "#f87171" }}>{error}</p>}
          <p className="hint">
            Karakter akan <b>bekerja</b> (animasi berdenyut), hasilnya muncul sebagai konten di
            tab <b>Task Board</b>.
          </p>
        </>
      )}
    </div>
  );
}
