/**
 * App shell — topbar (pilih company + status koneksi), tab navigasi, dan panel aktif.
 * Mengelola state global: daftar company, company terpilih, WorldSnapshot (REST + realtime).
 */

import { useCallback, useEffect, useState } from "react";
import type { AgentEvent, Company, DepartmentTemplate, WorldSnapshot } from "@vc/shared";
import { api, type SkillCatalogEntry } from "./api.js";
import { subscribeWorld } from "./socket.js";
import { WorldView } from "./components/WorldView.js";
import { CompanySetup } from "./components/CompanySetup.js";
import { DepartmentBuilder } from "./components/DepartmentBuilder.js";
import { CharacterEditor } from "./components/CharacterEditor.js";
import { TaskBoard } from "./components/TaskBoard.js";
import { CommsViewer } from "./components/CommsViewer.js";

type Tab = "world" | "company" | "departments" | "characters" | "tasks" | "comms";

const TABS: { id: Tab; label: string }[] = [
  { id: "world", label: "🏢 Kantor" },
  { id: "company", label: "Company" },
  { id: "departments", label: "Departemen" },
  { id: "characters", label: "Karakter" },
  { id: "tasks", label: "Task Board" },
  { id: "comms", label: "Comms" },
];

const LS_KEY = "vc.selectedCompanyId";

export function App(): JSX.Element {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(
    () => localStorage.getItem(LS_KEY) || null,
  );
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("world");
  // Phase 2: event agent terbaru (untuk animasi) + tick untuk memicu refetch Task Board.
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Katalog statis (template & skill) sekali di awal.
  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(() => undefined);
    api.listSkills().then(setSkills).catch(() => undefined);
  }, []);

  const refreshCompanies = useCallback(async (): Promise<Company[]> => {
    const list = await api.listCompanies();
    setCompanies(list);
    return list;
  }, []);

  // Daftar company di awal.
  useEffect(() => {
    refreshCompanies().catch(() => undefined);
  }, [refreshCompanies]);

  // BUG-109: rekonsiliasi company terpilih tiap daftar berubah (mount, buat, hapus).
  // Bila pilihan aktif sudah tak ada (mis. baru dihapus), pindah ke company lain / null —
  // updater fungsional memakai nilai terbaru, jadi tak menabrak pilihan yang baru di-set.
  useEffect(() => {
    setCompanyId((cur) => (cur && companies.some((c) => c.id === cur) ? cur : companies[0]?.id ?? null));
  }, [companies]);

  // Simpan pilihan + muat world (REST) tiap company berganti.
  useEffect(() => {
    if (!companyId) {
      setWorld(null);
      localStorage.removeItem(LS_KEY);
      return;
    }
    localStorage.setItem(LS_KEY, companyId);
    // Guard balapan: abaikan respons getWorld lama bila company keburu berganti.
    let ignore = false;
    api
      .getWorld(companyId)
      .then((w) => {
        if (!ignore) setWorld(w);
      })
      .catch(() => {
        if (!ignore) setWorld(null);
      });
    return () => {
      ignore = true;
    };
  }, [companyId]);

  // Realtime: subscribe ke company terpilih → update world saat config berubah.
  useEffect(() => {
    if (!companyId) {
      setConnected(false);
      return;
    }
    const sub = subscribeWorld(companyId, {
      onSync: setWorld,
      onConnectChange: setConnected,
      onAgentEvent: (e) => {
        setLastEvent(e);
        // Status/akhir-skill/pesan → kemungkinan task/artifact berubah → refetch Task Board.
        if (e.type === "status" || e.type === "skill_end" || e.type === "message") {
          setRefreshTick((t) => t + 1);
        }
      },
    });
    return () => sub.disconnect();
  }, [companyId]);

  const reload = useCallback(async (): Promise<void> => {
    const list = await refreshCompanies();
    // Refresh snapshot hanya bila company aktif masih ada (mutasi tanpa ganti company).
    // Bila company aktif baru dihapus (BUG-109), effect rekonsiliasi + world-loader yang memuat ulang.
    if (companyId && list.some((c) => c.id === companyId)) {
      try {
        setWorld(await api.getWorld(companyId));
      } catch {
        setWorld(null);
      }
    }
  }, [companyId, refreshCompanies]);

  const selectCompany = useCallback((id: string): void => {
    setCompanyId(id);
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <h1>VIRTUAL COMPANY</h1>
        <div className="company-select">
          <span className="muted">Company:</span>
          <select
            value={companyId ?? ""}
            onChange={(e) => selectCompany(e.target.value)}
            disabled={companies.length === 0}
          >
            {companies.length === 0 && <option value="">(belum ada)</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grow" />
        <div className="company-select">
          <span className={`conn-dot ${connected ? "on" : ""}`} />
          <span className="muted">{connected ? "realtime tersambung" : "offline"}</span>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === "world" && (
          <WorldView
            world={world}
            agentEvent={lastEvent}
            onDirectiveSent={() => setRefreshTick((t) => t + 1)}
          />
        )}
        {tab === "company" && (
          <CompanySetup
            companies={companies}
            selectedCompanyId={companyId}
            world={world}
            onSelectCompany={selectCompany}
            reload={reload}
          />
        )}
        {tab === "departments" && (
          <DepartmentBuilder world={world} templates={templates} skills={skills} reload={reload} />
        )}
        {tab === "characters" && (
          <CharacterEditor world={world} skills={skills} reload={reload} />
        )}
        {tab === "tasks" && <TaskBoard companyId={companyId} refreshTick={refreshTick} world={world} />}
        {tab === "comms" && <CommsViewer companyId={companyId} />}
      </div>
    </div>
  );
}
