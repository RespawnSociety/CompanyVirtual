/**
 * TaskBoard (roadmap 1.7) — papan task per status. Phase 1: data nyata (tasks) masih
 * kosong sampai Phase 2; saat kosong ditampilkan contoh placeholder (ditandai jelas).
 */

import { useEffect, useState } from "react";
import type { Task, TaskStatus } from "@vc/shared";
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

export function TaskBoard({ companyId }: { companyId: string | null }): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setTasks([]);
      setLoaded(false);
      return;
    }
    // CR-109: bersihkan data lama + guard ignore agar respons company lama tak menimpa yang baru.
    setTasks([]);
    setLoaded(false);
    let ignore = false;
    api
      .listTasks(companyId)
      .then((t) => {
        if (!ignore) setTasks(t);
      })
      .catch(() => {
        if (!ignore) setTasks([]);
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

  const isPlaceholder = loaded && tasks.length === 0;
  const data = isPlaceholder ? PLACEHOLDER : tasks;

  return (
    <div className="panel" style={{ maxWidth: "100%" }}>
      <h2>
        Task Board{" "}
        {isPlaceholder && <span className="badge placeholder">contoh placeholder — terisi mulai Phase 2</span>}
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
                {items.map((t) => (
                  <div className="card" key={t.id}>
                    <div className="title" style={{ fontSize: 13 }}>
                      {t.title}
                    </div>
                    <div className="sub">{t.assignee}</div>
                  </div>
                ))}
                {items.length === 0 && <div className="muted" style={{ fontSize: 12 }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
