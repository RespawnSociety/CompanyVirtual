/**
 * CompanySetup (roadmap 1.3) — buat & namai company, branding (warna), tambah/hapus lantai.
 * Semua tersimpan ke DB lewat REST; world ter-update via realtime/reload.
 */

import { useState } from "react";
import type { Company, WorldSnapshot } from "@vc/shared";
import { api } from "../api.js";

interface Props {
  companies: Company[];
  selectedCompanyId: string | null;
  world: WorldSnapshot | null;
  onSelectCompany: (id: string) => void;
  reload: () => Promise<void>;
}

export function CompanySetup({
  companies,
  selectedCompanyId,
  world,
  onSelectCompany,
  reload,
}: Props): JSX.Element {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4f7cff");
  const [floorName, setFloorName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createCompany = (): Promise<void> =>
    run(async () => {
      const company = await api.createCompany({ name: name.trim(), branding: { primaryColor: color } });
      setName("");
      onSelectCompany(company.id);
      await reload();
    });

  const addFloor = (): Promise<void> =>
    run(async () => {
      if (!selectedCompanyId) return;
      await api.createFloor(selectedCompanyId, { name: floorName.trim() });
      setFloorName("");
      await reload();
    });

  return (
    <>
      <div className="panel">
        <h2>Buat Company</h2>
        <label>Nama company (bebas)</label>
        <input
          value={name}
          placeholder="mis. PT Maju Jaya"
          onChange={(e) => setName(e.target.value)}
        />
        <label>Warna brand</label>
        <div className="row">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 60, padding: 2 }}
          />
          <span className="muted">{color}</span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || name.trim().length === 0} onClick={() => void createCompany()}>
            Buat company
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="panel">
        <h2>Company ({companies.length})</h2>
        {companies.length === 0 ? (
          <p className="empty">Belum ada company. Buat satu di atas.</p>
        ) : (
          <div className="list">
            {companies.map((c) => (
              <div className="card" key={c.id}>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <div className="title">
                      {c.name}{" "}
                      {c.id === selectedCompanyId && <span className="badge accent">aktif</span>}
                    </div>
                    <div className="sub">
                      {c.floorIds.length} lantai · id {c.id.slice(0, 12)}…
                    </div>
                  </div>
                  {c.id !== selectedCompanyId && (
                    <button className="secondary" onClick={() => onSelectCompany(c.id)}>
                      Pilih
                    </button>
                  )}
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.deleteCompany(c.id);
                        await reload();
                      })
                    }
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedCompanyId && (
        <div className="panel">
          <h2>Lantai company aktif</h2>
          <label>Nama lantai baru</label>
          <div className="row">
            <input
              value={floorName}
              placeholder="mis. Lantai 1 — Pemasaran"
              onChange={(e) => setFloorName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button disabled={busy || floorName.trim().length === 0} onClick={() => void addFloor()}>
              Tambah lantai
            </button>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {!world || world.floors.length === 0 ? (
              <p className="empty">Belum ada lantai.</p>
            ) : (
              world.floors.map((f) => (
                <div className="card" key={f.id}>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <div className="title">{f.name}</div>
                      <div className="sub">
                        lantai #{f.index} · {f.departmentIds.length} departemen · map {f.mapKey}
                      </div>
                    </div>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.deleteFloor(f.id);
                          await reload();
                        })
                      }
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
