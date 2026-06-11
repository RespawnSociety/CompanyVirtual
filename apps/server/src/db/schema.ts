/**
 * Skema SQLite untuk Configuration layer (plan §4, §9).
 * Disimpan sebagai DDL terpisah agar mudah dibaca & di-review.
 *
 * Konvensi penyimpanan:
 * - Field skalar (id, name, status, ...) → kolom langsung.
 * - Field bersarang (Vec2, array, Record) → kolom TEXT berisi JSON.
 * - boolean TIDAK dipakai (node:sqlite tak bind boolean) — pakai INTEGER/TEXT.
 * - Relasi turunan (floorIds, departmentIds, agentIds) TIDAK disimpan; dihitung
 *   dari tabel anak saat baca (sumber kebenaran tunggal, hindari drift).
 */

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  branding    TEXT,                 -- JSON Record<string,unknown> | NULL
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS floors (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  idx         INTEGER NOT NULL,     -- urutan lantai (0-based)
  map_key     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floors_company ON floors(company_id);

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  steps       TEXT NOT NULL         -- JSON WorkflowStep[]
);

CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  floor_id    TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  template_id TEXT,                 -- DepartmentTemplate.id asal | NULL (custom)
  purpose     TEXT NOT NULL,
  skill_pool  TEXT NOT NULL,        -- JSON string[]
  workflow_id TEXT,                 -- workflows.id | NULL
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_floor ON departments(floor_id);
CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);

CREATE TABLE IF NOT EXISTS agents (
  id               TEXT PRIMARY KEY,
  department_id    TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  desk_pos         TEXT NOT NULL,   -- JSON Vec2
  sprite_key       TEXT NOT NULL,
  description      TEXT NOT NULL,
  skill_scope      TEXT NOT NULL,   -- JSON string[]
  guardrails       TEXT NOT NULL,   -- JSON Guardrail[]
  comms_handle     TEXT,
  model_policy     TEXT,            -- JSON ModelPolicy | NULL
  memory_namespace TEXT NOT NULL,
  status           TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department_id);

-- Phase 2–3 yang mengisi tabel ini; Phase 1 hanya read (kosong → UI placeholder).
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  directive_id  TEXT NOT NULL,
  department_id TEXT NOT NULL,
  title         TEXT NOT NULL,
  assignee      TEXT NOT NULL,
  status        TEXT NOT NULL,
  inputs        TEXT,               -- JSON Record | NULL
  output_ref    TEXT,
  depends_on    TEXT NOT NULL,      -- JSON Id[]
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id);

CREATE TABLE IF NOT EXISTS comms_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  from_party  TEXT NOT NULL,
  to_party    TEXT NOT NULL,
  channel     TEXT NOT NULL,
  text        TEXT NOT NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comms_thread ON comms_messages(thread_id);
`;
