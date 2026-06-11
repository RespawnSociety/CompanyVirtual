/**
 * CommsViewer (roadmap 1.7) — penampil percakapan WhatsApp/internal. Phase 1: data nyata
 * (comms) masih kosong sampai Phase 3 (WA relay 2 arah); saat kosong tampilkan placeholder.
 */

import { useEffect, useState } from "react";
import type { CommsMessage } from "@vc/shared";
import { api } from "../api.js";

const PLACEHOLDER: CommsMessage[] = [
  { id: "c1", threadId: "t1", from: "user", to: "Manager", channel: "whatsapp", text: "(contoh) Tolong siapkan konten peluncuran minggu ini.", at: 1 },
  { id: "c2", threadId: "t1", from: "Manager", to: "user", channel: "whatsapp", text: "(contoh) Siap, saya koordinasikan tim. Akan saya kabari hasilnya.", at: 2 },
  { id: "c3", threadId: "t1", from: "Manager", to: "user", channel: "whatsapp", text: "(contoh) Draft caption siap & sudah direview. Mohon approval untuk publish.", at: 3 },
];

export function CommsViewer({ companyId }: { companyId: string | null }): JSX.Element {
  const [msgs, setMsgs] = useState<CommsMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setMsgs([]);
      setLoaded(false);
      return;
    }
    // CR-109: bersihkan data lama + guard ignore agar respons company lama tak menimpa yang baru.
    setMsgs([]);
    setLoaded(false);
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
  }, [companyId]);

  if (!companyId) {
    return (
      <div className="panel">
        <p className="empty">Pilih company dulu.</p>
      </div>
    );
  }

  const isPlaceholder = loaded && msgs.length === 0;
  const data = isPlaceholder ? PLACEHOLDER : msgs;

  return (
    <div className="panel">
      <h2>
        Comms Viewer{" "}
        {isPlaceholder && (
          <span className="badge placeholder">contoh placeholder — terisi mulai Phase 3</span>
        )}
      </h2>
      <div className="list">
        {data.map((m) => {
          const fromUser = m.from === "user";
          return (
            <div
              className="card"
              key={m.id}
              style={{
                alignSelf: fromUser ? "flex-start" : "flex-end",
                maxWidth: "75%",
                borderColor: fromUser ? "var(--border)" : "var(--accent)",
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
    </div>
  );
}
