/**
 * WorkflowPanel (Phase 3) — kirim arahan ke DEPARTEMEN (jalankan pipeline workflow) +
 * kelola APPROVAL: run yang `awaiting_approval` ditampilkan dengan tombol APPROVE / REVISI.
 * Keputusan owner menggerakkan langkah berikut (engine resume). Refetch saat `refreshTick`.
 */

import { useEffect, useState } from "react";
import type { WorkflowRun, WorldSnapshot } from "@vc/shared";
import { api } from "../api.js";
import { useAsyncAction } from "../hooks/useAsyncAction.js";

const RUN_STATUS_LABEL: Record<string, string> = {
  running: "berjalan",
  awaiting_approval: "menunggu approval",
  done: "selesai",
  blocked: "terhenti",
  cancelled: "dibatalkan",
};

export function WorkflowPanel({
  world,
  companyId,
  refreshTick = 0,
  onChanged,
}: {
  world: WorldSnapshot | null;
  companyId: string | null;
  refreshTick?: number;
  onChanged?: () => void;
}): JSX.Element {
  const depts = world?.departments ?? [];
  const [deptId, setDeptId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const { busy, error, run: runAction } = useAsyncAction();

  useEffect(() => {
    setDeptId((cur) => (cur && depts.some((d) => d.id === cur) ? cur : depts[0]?.id ?? ""));
  }, [depts]);

  useEffect(() => {
    if (!companyId) {
      setRuns([]);
      return;
    }
    let ignore = false;
    api
      .listRuns(companyId)
      .then((r) => {
        if (!ignore) setRuns(r);
      })
      .catch(() => {
        if (!ignore) setRuns([]);
      });
    return () => {
      ignore = true;
    };
  }, [companyId, refreshTick]);

  const deptName = (id: string): string => depts.find((d) => d.id === id)?.name ?? id;
  const pending = runs.filter((r) => r.status === "awaiting_approval" && r.approvalId);

  const send = (): void => {
    const t = text.trim();
    if (!deptId || !t) return;
    void runAction(async () => {
      await api.sendDepartmentDirective(deptId, t);
      setText("");
      onChanged?.();
    });
  };

  const decide = (approvalId: string, decision: "approve" | "revise"): void => {
    let note: string | undefined;
    if (decision === "revise") {
      const input = window.prompt("Alasan revisi (untuk tim):");
      if (input === null) return; // batal
      note = input.trim() || undefined;
    }
    void runAction(async () => {
      await api.resolveApproval(approvalId, decision, note);
      onChanged?.();
    });
  };

  return (
    <div className="panel" style={{ maxWidth: "100%" }}>
      <h2>Workflow Departemen</h2>
      {depts.length === 0 ? (
        <p className="muted">Belum ada departemen. Tambah departemen (mis. Marketing) dulu.</p>
      ) : (
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="sub" style={{ marginBottom: 6 }}>Beri arahan ke departemen (pipeline)</div>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} disabled={busy}>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="mis. Bikin kampanye diskon akhir pekan untuk Instagram"
              rows={3}
              style={{ width: "100%", marginTop: 6 }}
              disabled={busy}
            />
            <button onClick={send} disabled={busy || !text.trim()} style={{ marginTop: 6 }}>
              {busy ? "Memproses…" : "Jalankan workflow"}
            </button>
            {error && <p className="hint" style={{ color: "#f87171" }}>{error}</p>}
            <p className="hint">
              Manager → riset → tulis → review (loop) → <b>minta approval</b> → publish. Pipeline
              berhenti di approval sampai kamu putuskan di kanan.
            </p>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="sub" style={{ marginBottom: 6 }}>
              Menunggu persetujuan ({pending.length})
            </div>
            {pending.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>Tak ada yang menunggu approval.</p>
            ) : (
              <div className="list">
                {pending.map((r) => (
                  <div className="card" key={r.id}>
                    <div className="title" style={{ fontSize: 13 }}>{deptName(r.departmentId)}</div>
                    <div className="sub">run {r.id.slice(0, 12)}… · putaran revisi: {r.reviewRounds}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      <button onClick={() => decide(r.approvalId!, "approve")} disabled={busy}>
                        APPROVE
                      </button>
                      <button onClick={() => decide(r.approvalId!, "revise")} disabled={busy}>
                        REVISI
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {runs.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="sub" style={{ marginBottom: 4 }}>Semua run</div>
                {runs.map((r) => (
                  <div key={r.id} className="muted" style={{ fontSize: 12 }}>
                    {deptName(r.departmentId)} — {RUN_STATUS_LABEL[r.status] ?? r.status}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
