/**
 * DepartmentBuilder (roadmap 1.4) — tambah departemen ke sebuah lantai, dari Marketing
 * template (seed role+skill+workflow) ATAU custom (atur purpose & skillPool sendiri).
 */

import { useEffect, useState } from "react";
import type { DepartmentTemplate, WorldSnapshot } from "@vc/shared";
import { api, type SkillCatalogEntry } from "../api.js";
import { useAsyncAction } from "../hooks/useAsyncAction.js";

interface Props {
  world: WorldSnapshot | null;
  templates: DepartmentTemplate[];
  skills: SkillCatalogEntry[];
  reload: () => Promise<void>;
}

type Mode = "template" | "custom";

export function DepartmentBuilder({ world, templates, skills, reload }: Props): JSX.Element {
  const [floorId, setFloorId] = useState("");
  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [skillPool, setSkillPool] = useState<string[]>([]);
  const { busy, error, run } = useAsyncAction();

  useEffect(() => {
    if (world && !world.floors.some((f) => f.id === floorId)) {
      setFloorId(world.floors[0]?.id ?? "");
    }
  }, [world, floorId]);

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templates, templateId]);

  if (!world) {
    return (
      <div className="panel">
        <p className="empty">Pilih atau buat company dulu (tab Company).</p>
      </div>
    );
  }
  if (world.floors.length === 0) {
    return (
      <div className="panel">
        <p className="empty">Company ini belum punya lantai. Tambah lantai di tab Company.</p>
      </div>
    );
  }

  const toggleSkill = (s: string): void =>
    setSkillPool((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const create = (): Promise<void> =>
    run(async () => {
      if (mode === "template") {
        await api.createDepartment(floorId, {
          templateId,
          ...(name.trim() ? { name: name.trim() } : {}),
        });
      } else {
        await api.createDepartment(floorId, {
          name: name.trim(),
          purpose: purpose.trim(),
          skillPool,
        });
      }
      setName("");
      setPurpose("");
      setSkillPool([]);
      await reload();
    });

  const canCreate =
    mode === "template" ? !!templateId : name.trim().length > 0 && purpose.trim().length > 0;

  const deptsOnFloor = world.departments.filter((d) => d.floorId === floorId);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  return (
    <>
      <div className="panel">
        <h2>Tambah Departemen</h2>
        <label>Lantai tujuan</label>
        <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
          {world.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} (lt. {f.index})
            </option>
          ))}
        </select>

        <label>Sumber</label>
        <div className="row">
          <label style={{ margin: 0 }}>
            <input
              type="radio"
              checked={mode === "template"}
              onChange={() => setMode("template")}
            />{" "}
            Dari template
          </label>
          <label style={{ margin: 0 }}>
            <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />{" "}
            Custom
          </label>
        </div>

        {mode === "template" ? (
          <>
            <label>Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <p className="hint">
                {selectedTemplate.description} — akan men-seed{" "}
                {selectedTemplate.roleTemplates.length} karakter + workflow.
              </p>
            )}
            <label>Nama departemen (opsional, default nama template)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="(default)" />
          </>
        ) : (
          <>
            <label>Nama departemen</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Tujuan (purpose)</label>
            <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            <label>Skill pool</label>
            <div className="checkbox-grid">
              {skills.map((s) => (
                <label key={s.name}>
                  <input
                    type="checkbox"
                    checked={skillPool.includes(s.name)}
                    onChange={() => toggleSkill(s.name)}
                  />
                  {s.name}
                  {s.risky && <span className="badge risky">risky</span>}
                </label>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || !canCreate} onClick={() => void create()}>
            Tambah departemen
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="panel">
        <h2>Departemen di lantai ini ({deptsOnFloor.length})</h2>
        {deptsOnFloor.length === 0 ? (
          <p className="empty">Belum ada departemen di lantai ini.</p>
        ) : (
          <div className="list">
            {deptsOnFloor.map((d) => (
              <div className="card" key={d.id}>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <div className="title">
                      {d.name} {d.templateId && <span className="badge accent">template</span>}
                    </div>
                    <div className="sub">{d.purpose}</div>
                    <div style={{ marginTop: 6 }}>
                      {d.skillPool.map((s) => (
                        <span className="badge" key={s}>
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="sub" style={{ marginTop: 4 }}>
                      {d.agentIds.length} karakter
                    </div>
                  </div>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.deleteDepartment(d.id);
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
    </>
  );
}
