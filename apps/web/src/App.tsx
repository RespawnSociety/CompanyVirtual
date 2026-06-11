/**
 * App shell — topbar (pilih company + status koneksi), tab navigasi, dan panel aktif.
 * Mengelola state global: daftar company, company terpilih, WorldSnapshot (REST + realtime).
 */

import { useCallback, useEffect, useState } from "react";
import type { Company, DepartmentTemplate, WorldSnapshot } from "@vc/shared";
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

  // Daftar company di awal; auto-pilih bila belum ada pilihan tersimpan.
  useEffect(() => {
    refreshCompanies()
      .then((list) => {
        setCompanyId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list[0]?.id ?? null));
      })
      .catch(() => undefined);
  }, [refreshCompanies]);

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
    });
    return () => sub.disconnect();
  }, [companyId]);

  const reload = useCallback(async (): Promise<void> => {
    await refreshCompanies();
    if (companyId) {
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
        {tab === "world" && <WorldView world={world} />}
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
        {tab === "tasks" && <TaskBoard companyId={companyId} />}
        {tab === "comms" && <CommsViewer companyId={companyId} />}
      </div>
    </div>
  );
}
