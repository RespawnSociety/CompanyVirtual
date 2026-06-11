/**
 * CharacterEditor (roadmap 1.5) — form → AgentProfile → DB.
 * Isi identitas, sprite, persona (description → system prompt), skillScope, guardrails,
 * posisi meja, comms handle, dan model policy (tier 9Router). Buat baru atau edit.
 */

import { useEffect, useState } from "react";
import type { AgentProfile, ModelTier, WorldSnapshot } from "@vc/shared";
import { api, type NewAgentInput, type SkillCatalogEntry } from "../api.js";
import { useAsyncAction } from "../hooks/useAsyncAction.js";

interface Props {
  world: WorldSnapshot | null;
  skills: SkillCatalogEntry[];
  reload: () => Promise<void>;
}

const SPRITE_KEYS = ["manager", "market_checker", "script_maker", "reviewer", "social_media", "default"];
const TIERS: (ModelTier | "")[] = ["", "subscription", "cheap", "free"];

interface FormState {
  id: string | null; // null = mode buat baru
  name: string;
  role: string;
  spriteKey: string;
  description: string;
  skillScope: string[];
  guardrails: string; // satu rule per baris
  deskX: number;
  deskY: number;
  commsHandle: string;
  tier: ModelTier | "";
  preferredProvider: string;
}

const EMPTY: FormState = {
  id: null,
  name: "",
  role: "",
  spriteKey: "default",
  description: "",
  skillScope: [],
  guardrails: "",
  deskX: 3,
  deskY: 4,
  commsHandle: "",
  tier: "",
  preferredProvider: "",
};

export function CharacterEditor({ world, skills, reload }: Props): JSX.Element {
  const [departmentId, setDepartmentId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY);
  const { busy, error, run } = useAsyncAction();

  useEffect(() => {
    if (world && !world.departments.some((d) => d.id === departmentId)) {
      setDepartmentId(world.departments[0]?.id ?? "");
    }
  }, [world, departmentId]);

  if (!world) {
    return (
      <div className="panel">
        <p className="empty">Pilih atau buat company dulu (tab Company).</p>
      </div>
    );
  }
  if (world.departments.length === 0) {
    return (
      <div className="panel">
        <p className="empty">Belum ada departemen. Tambah dulu di tab Departemen.</p>
      </div>
    );
  }

  const agentsInDept = world.agents.filter((a) => a.departmentId === departmentId);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void =>
    setForm((f) => ({ ...f, [k]: v }));
  const toggleSkill = (s: string): void =>
    setForm((f) => ({
      ...f,
      skillScope: f.skillScope.includes(s)
        ? f.skillScope.filter((x) => x !== s)
        : [...f.skillScope, s],
    }));

  const loadAgent = (a: AgentProfile): void =>
    setForm({
      id: a.id,
      name: a.name,
      role: a.role,
      spriteKey: a.spriteKey,
      description: a.description,
      skillScope: [...a.skillScope],
      guardrails: a.guardrails.map((g) => g.rule).join("\n"),
      deskX: a.deskPos.x,
      deskY: a.deskPos.y,
      commsHandle: a.commsHandle ?? "",
      tier: a.modelPolicy?.tier ?? "",
      preferredProvider: a.modelPolicy?.preferredProvider ?? "",
    });

  const buildInput = (): NewAgentInput => {
    const input: NewAgentInput = {
      name: form.name.trim(),
      role: form.role.trim(),
      deskPos: { x: Number(form.deskX), y: Number(form.deskY) },
      spriteKey: form.spriteKey,
      description: form.description.trim(),
      skillScope: form.skillScope,
      guardrails: form.guardrails
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((rule) => ({ rule })),
    };
    // CR-102: kirim commsHandle apa adanya (termasuk "" untuk meng-clear saat edit).
    // Create: "" diabaikan server → default kosong. Edit: "" → server menghapus handle.
    input.commsHandle = form.commsHandle.trim();
    if (form.tier || form.preferredProvider.trim()) {
      input.modelPolicy = {
        ...(form.tier ? { tier: form.tier } : {}),
        ...(form.preferredProvider.trim() ? { preferredProvider: form.preferredProvider.trim() } : {}),
      };
    }
    return input;
  };

  const save = (): Promise<void> =>
    run(async () => {
      const input = buildInput();
      if (form.id) await api.updateAgent(form.id, input);
      else await api.createAgent(departmentId, input);
      setForm(EMPTY);
      await reload();
    });

  const canSave = form.name.trim().length > 0 && form.role.trim().length > 0;

  return (
    <>
      <div className="panel">
        <h2>Departemen</h2>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          {world.departments.map((d) => {
            const floor = world.floors.find((f) => f.id === d.floorId);
            return (
              <option key={d.id} value={d.id}>
                {d.name}
                {floor ? ` — ${floor.name}` : ""}
              </option>
            );
          })}
        </select>
        <div className="list" style={{ marginTop: 12 }}>
          {agentsInDept.length === 0 ? (
            <p className="empty">Belum ada karakter di departemen ini.</p>
          ) : (
            agentsInDept.map((a) => (
              <div className="card" key={a.id}>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <div className="title">
                      {a.name} <span className="muted">· {a.role}</span>
                    </div>
                    <div className="sub">
                      meja ({a.deskPos.x},{a.deskPos.y}) · sprite {a.spriteKey} ·{" "}
                      {a.skillScope.length} skill
                    </div>
                  </div>
                  <button className="secondary" onClick={() => loadAgent(a)}>
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.deleteAgent(a.id);
                        if (form.id === a.id) setForm(EMPTY);
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

      <div className="panel">
        <h2>{form.id ? "Edit karakter" : "Buat karakter baru"}</h2>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Nama</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Role</label>
            <input value={form.role} onChange={(e) => set("role", e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Sprite</label>
            <select value={form.spriteKey} onChange={(e) => set("spriteKey", e.target.value)}>
              {SPRITE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Meja X</label>
            <input
              type="number"
              value={form.deskX}
              onChange={(e) => set("deskX", Number(e.target.value))}
              style={{ width: 90 }}
            />
          </div>
          <div>
            <label>Meja Y</label>
            <input
              type="number"
              value={form.deskY}
              onChange={(e) => set("deskY", Number(e.target.value))}
              style={{ width: 90 }}
            />
          </div>
        </div>

        <label>Deskripsi / persona (→ system prompt)</label>
        <textarea value={form.description} onChange={(e) => set("description", e.target.value)} />

        <label>Skill scope</label>
        <div className="checkbox-grid">
          {skills.map((s) => (
            <label key={s.name}>
              <input
                type="checkbox"
                checked={form.skillScope.includes(s.name)}
                onChange={() => toggleSkill(s.name)}
              />
              {s.name}
              {s.risky && <span className="badge risky">risky</span>}
              {!s.implemented && <span className="badge">soon</span>}
            </label>
          ))}
        </div>

        <label>Guardrails (satu aturan per baris)</label>
        <textarea
          value={form.guardrails}
          onChange={(e) => set("guardrails", e.target.value)}
          placeholder={"propose_only\nno_external_publish"}
        />

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Comms handle (opsional)</label>
            <input value={form.commsHandle} onChange={(e) => set("commsHandle", e.target.value)} />
          </div>
          <div>
            <label>Model tier</label>
            <select value={form.tier} onChange={(e) => set("tier", e.target.value as ModelTier | "")}>
              {TIERS.map((t) => (
                <option key={t || "none"} value={t}>
                  {t || "(default)"}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Preferred provider (opsional)</label>
            <input
              value={form.preferredProvider}
              onChange={(e) => set("preferredProvider", e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || !canSave} onClick={() => void save()}>
            {form.id ? "Simpan perubahan" : "Buat karakter"}
          </button>
          {form.id && (
            <button className="secondary" onClick={() => setForm(EMPTY)}>
              Batal / baru
            </button>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
