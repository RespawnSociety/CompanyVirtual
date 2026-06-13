/**
 * Skema MySQL/MariaDB untuk Configuration layer + runtime (plan §4, §9; Phase 2).
 * Dijalankan satu per satu saat `ConfigStore.init()` (urutan penting karena foreign key).
 *
 * Konvensi penyimpanan:
 * - Id → VARCHAR(64) PRIMARY KEY. Epoch ms → BIGINT. Skor → DOUBLE.
 * - Field bersarang (Vec2, array, Record) → kolom LONGTEXT berisi JSON (di-`JSON.parse` saat baca).
 *   Sengaja BUKAN tipe JSON MySQL agar mapping identik lintas-driver & tak ada auto-parse.
 * - boolean TIDAK dipakai.
 * - Relasi turunan (floorIds, departmentIds, agentIds) TIDAK disimpan; dihitung dari tabel
 *   anak saat baca (sumber kebenaran tunggal). Cascade ditegakkan InnoDB FOREIGN KEY.
 *
 * Catatan dialek: MariaDB 10.4 (XAMPP) tak mendukung `CREATE INDEX IF NOT EXISTS`, jadi index
 * dideklarasikan inline di `CREATE TABLE IF NOT EXISTS` (idempoten). Kolom `text` di-backtick
 * saat dirujuk di query karena bertabrakan dengan nama tipe.
 */

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS companies (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    branding    LONGTEXT NULL,
    created_at  BIGINT NOT NULL
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS floors (
    id          VARCHAR(64) PRIMARY KEY,
    company_id  VARCHAR(64) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    idx         INT NOT NULL,
    map_key     VARCHAR(255) NOT NULL,
    INDEX idx_floors_company (company_id),
    CONSTRAINT fk_floors_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS workflows (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    steps       LONGTEXT NOT NULL
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS departments (
    id          VARCHAR(64) PRIMARY KEY,
    company_id  VARCHAR(64) NOT NULL,
    floor_id    VARCHAR(64) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    template_id VARCHAR(64) NULL,
    purpose     TEXT NOT NULL,
    skill_pool  LONGTEXT NOT NULL,
    workflow_id VARCHAR(64) NULL,
    created_at  BIGINT NOT NULL,
    INDEX idx_departments_floor (floor_id),
    INDEX idx_departments_company (company_id),
    CONSTRAINT fk_dept_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_dept_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS agents (
    id               VARCHAR(64) PRIMARY KEY,
    department_id    VARCHAR(64) NOT NULL,
    name             VARCHAR(255) NOT NULL,
    role             VARCHAR(255) NOT NULL,
    desk_pos         LONGTEXT NOT NULL,
    sprite_key       VARCHAR(255) NOT NULL,
    description      TEXT NOT NULL,
    skill_scope      LONGTEXT NOT NULL,
    guardrails       LONGTEXT NOT NULL,
    comms_handle     VARCHAR(255) NULL,
    model_policy     LONGTEXT NULL,
    memory_namespace VARCHAR(255) NOT NULL,
    status           VARCHAR(32) NOT NULL,
    created_at       BIGINT NOT NULL,
    INDEX idx_agents_department (department_id),
    CONSTRAINT fk_agents_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS directives (
    id            VARCHAR(64) PRIMARY KEY,
    company_id    VARCHAR(64) NOT NULL,
    department_id VARCHAR(64) NULL,
    text          TEXT NOT NULL,
    source        VARCHAR(32) NOT NULL,
    status        VARCHAR(32) NOT NULL,
    created_at    BIGINT NOT NULL,
    INDEX idx_directives_company (company_id),
    CONSTRAINT fk_directives_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id            VARCHAR(64) PRIMARY KEY,
    company_id    VARCHAR(64) NULL,
    directive_id  VARCHAR(64) NOT NULL,
    department_id VARCHAR(64) NOT NULL,
    title         VARCHAR(512) NOT NULL,
    assignee      VARCHAR(64) NOT NULL,
    status        VARCHAR(32) NOT NULL,
    inputs        LONGTEXT NULL,
    output_ref    VARCHAR(64) NULL,
    depends_on    LONGTEXT NOT NULL,
    created_at    BIGINT NOT NULL,
    INDEX idx_tasks_department (department_id),
    INDEX idx_tasks_company (company_id),
    CONSTRAINT fk_tasks_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    id          VARCHAR(64) PRIMARY KEY,
    task_id     VARCHAR(64) NOT NULL,
    kind        VARCHAR(64) NOT NULL,
    content     LONGTEXT NOT NULL,
    meta        LONGTEXT NULL,
    created_at  BIGINT NOT NULL,
    INDEX idx_artifacts_task (task_id),
    CONSTRAINT fk_artifacts_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id              VARCHAR(64) PRIMARY KEY,
    company_id      VARCHAR(64) NULL,
    directive_id    VARCHAR(64) NOT NULL,
    department_id   VARCHAR(64) NOT NULL,
    workflow_id     VARCHAR(64) NOT NULL,
    status          VARCHAR(32) NOT NULL,
    current_step_id VARCHAR(64) NULL,
    step_artifacts  LONGTEXT NOT NULL,
    approval_id     VARCHAR(64) NULL,
    review_rounds   INT NOT NULL,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL,
    INDEX idx_wfruns_directive (directive_id),
    INDEX idx_wfruns_company (company_id),
    INDEX idx_wfruns_approval (approval_id),
    CONSTRAINT fk_wfruns_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS comms_messages (
    id          VARCHAR(64) PRIMARY KEY,
    thread_id   VARCHAR(64) NOT NULL,
    from_party  VARCHAR(64) NOT NULL,
    to_party    VARCHAR(64) NOT NULL,
    channel     VARCHAR(32) NOT NULL,
    text        TEXT NOT NULL,
    at          BIGINT NOT NULL,
    INDEX idx_comms_thread (thread_id)
  ) ${TABLE_OPTS}`,

  `CREATE TABLE IF NOT EXISTS memory_items (
    id          VARCHAR(64) PRIMARY KEY,
    namespace   VARCHAR(255) NOT NULL,
    agent_id    VARCHAR(64) NOT NULL,
    kind        VARCHAR(32) NOT NULL,
    text        TEXT NOT NULL,
    created_at  BIGINT NOT NULL,
    importance  DOUBLE NOT NULL,
    tags        LONGTEXT NOT NULL,
    embedding   LONGTEXT NULL,
    INDEX idx_memory_namespace (namespace)
  ) ${TABLE_OPTS}`,

  // Phase 4.3 — Approval (dipersist agar audit "approval manual" punya bukti: status, waktu, note).
  `CREATE TABLE IF NOT EXISTS approvals (
    id          VARCHAR(64) PRIMARY KEY,
    company_id  VARCHAR(64) NULL,
    summary     TEXT NOT NULL,
    artifact_id VARCHAR(64) NULL,
    channel     VARCHAR(32) NOT NULL,
    status      VARCHAR(32) NOT NULL,
    note        TEXT NULL,
    decided_at  BIGINT NULL,
    created_at  BIGINT NOT NULL,
    INDEX idx_approvals_company (company_id),
    CONSTRAINT fk_approvals_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  // Phase 4.3 — Audit log: satu baris per aksi/approval (plan §8). `detail` JSON non-sensitif.
  `CREATE TABLE IF NOT EXISTS audit_entries (
    id          VARCHAR(64) PRIMARY KEY,
    company_id  VARCHAR(64) NULL,
    agent_id    VARCHAR(64) NOT NULL,
    action      VARCHAR(64) NOT NULL,
    approval_id VARCHAR(64) NULL,
    detail      LONGTEXT NOT NULL,
    at          BIGINT NOT NULL,
    INDEX idx_audit_company (company_id),
    INDEX idx_audit_agent_action (agent_id, action),
    CONSTRAINT fk_audit_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,

  // Phase 5.4 — Pemakaian LLM (token) per loop agent, untuk KPI biaya. Satu baris per
  // (loop, tier). Token dari 9Router `usage`; biaya dihitung saat baca (tarif dapat diubah).
  `CREATE TABLE IF NOT EXISTS usage_events (
    id                VARCHAR(64) PRIMARY KEY,
    company_id        VARCHAR(64) NULL,
    department_id     VARCHAR(64) NULL,
    agent_id          VARCHAR(64) NOT NULL,
    tier              VARCHAR(32) NOT NULL,
    calls             INT NOT NULL,
    prompt_tokens     BIGINT NOT NULL,
    completion_tokens BIGINT NOT NULL,
    total_tokens      BIGINT NOT NULL,
    at                BIGINT NOT NULL,
    INDEX idx_usage_company (company_id),
    INDEX idx_usage_company_dept (company_id, department_id),
    CONSTRAINT fk_usage_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ${TABLE_OPTS}`,
];
