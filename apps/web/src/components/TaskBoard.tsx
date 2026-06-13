/**
 * TaskBoard (roadmap 1.7 → 2.3/2.4) — papan task per status. Mulai Phase 2 menampilkan
 * data NYATA: task dari directive + Artifact (konten AI) yang bisa dibuka. Saat masih kosong
 * (belum ada arahan) ditampilkan contoh placeholder (ditandai jelas). Refetch saat `refreshTick`
 * berubah (dipicu agent:event / pengiriman arahan).
 */

import { useEffect, useState } from "react";
import type { Artifact, Task, TaskStatus, WorldSnapshot } from "@vc/shared";
import { api } from "../api.js";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To-do" },
  { status: "in_progress", label: "Dikerjakan" },
  { status: "review", label: "Review" },
  { status: "awaiting_approval", label: "Menunggu Approval" },
  { status: "done", label: "Selesai" },
];

const PLACEHOLDER: Task[] = [
  { id: "demo-1", directiveId: "d", departmentId: "-", title: "(contoh) Riset tren konten", assignee: "Market Checker", status: "in_progress", dependsOn: [] },
  { id: "demo-2", directiveId: "d", departmentId: "-", title: "(contoh) Tulis caption peluncuran", assignee: "Script Maker", status: "todo", dependsOn: [] },
  { id: "demo-3", directiveId: "d", departmentId: "-", title: "(contoh) Review brand voice", assignee: "Reviewer", status: "review", dependsOn: [] },
  { id: "demo-4", directiveId: "d", departmentId: "-", title: "(contoh) Publish IG", assignee: "Social Media", status: "awaiting_approval", dependsOn: [] },
];

export function TaskBoard({
  companyId,
  refreshTick = 0,
  world,
}: {
  companyId: string | null;
  refreshTick?: number;
  world?: WorldSnapshot | null;
}): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setTasks([]);
      setArtifacts([]);
      setLoaded(false);
      return;
    }
    // CR-109: bersihkan + guard ignore agar respons company lama tak menimpa yang baru.
    setLoaded(false);
    let ignore = false;
    Promise.all([api.listTasks(companyId), api.listArtifacts(companyId)])
      .then(([t, a]) => {
        if (ignore) return;
        setTasks(t);
        setArtifacts(a);
      })
      .catch(() => {
        if (!ignore) {
          setTasks([]);
          setArtifacts([]);
        }
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

  const isPlaceholder = loaded && tasks.length === 0;
  const data = isPlaceholder ? PLACEHOLDER : tasks;
  const artifactByTask = new Map(artifacts.map((a) => [a.taskId, a] as const));
  const agentName = (id: string): string =>
    world?.agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="panel" style={{ maxWidth: "100%" }}>
      <h2>
        Task Board{" "}
        {isPlaceholder && <span className="badge placeholder">contoh placeholder — kirim arahan untuk mengisi</span>}
      </h2>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {COLUMNS.map((col) => {
          const items = data.filter((t) => t.status === col.status);
          return (
            <div key={col.status} style={{ flex: 1, minWidth: 160 }}>
              <div className="sub" style={{ marginBottom: 6 }}>
                {col.label} ({items.length})
              </div>
              <div className="list">
                {items.map((t) => {
                  const artifact = artifactByTask.get(t.id);
                  const open = openTaskId === t.id;
                  return (
                    <div className="card" key={t.id}>
                      <div className="title" style={{ fontSize: 13 }}>
                        {t.title}
                      </div>
                      <div className="sub">{isPlaceholder ? t.assignee : agentName(t.assignee)}</div>
                      {artifact && (
                        <>
                          <button
                            style={{ marginTop: 4, fontSize: 11 }}
                            onClick={() => setOpenTaskId(open ? null : t.id)}
                          >
                            {open ? "Sembunyikan konten" : "Lihat konten"}
                          </button>
                          {open && (
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: 12,
                                marginTop: 6,
                                background: "#0f1420",
                                padding: 8,
                                borderRadius: 6,
                              }}
                            >
                              {artifact.content}
                            </pre>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && <div className="muted" style={{ fontSize: 12 }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
