/**
 * Department Template #2 — Sales / Penjualan (Phase 5.1, plan §5).
 *
 * Membuktikan platform GENERIK: departemen kedua dengan role, skill, dan workflow BERBEDA
 * dari Marketing, dijalankan oleh ENGINE YANG SAMA (tanpa cabang khusus per departemen).
 * Bedanya yang menonjol: aksi eksternal akhir = `send_outreach` (kirim pesan 1:1 ke calon
 * pembeli), bukan `schedule_post` (publish sosmed). Tetap approval-gated + guardrail.
 *
 * INI HANYA DATA (seed). Semua field editable setelah di-seed (Department Builder & Character
 * Editor). Skill yang dirujuk adalah NAMA skill dari Skill Registry global.
 */

import type { DepartmentTemplate, RoleTemplate, WorkflowDef } from "@vc/shared";

/** Id template stabil (dipakai Department.templateId saat di-seed). */
export const SALES_TEMPLATE_ID = "tmpl-sales";

/**
 * Workflow default Sales:
 *   Sales Manager (intake) → Lead Researcher (riset calon) → Proposal Writer (tulis penawaran)
 *   → Sales Reviewer (loop revisi) → Approval owner → Outreach Rep (kirim outreach).
 *
 * Token `loop_until_pass` & `approval_gate` ditafsirkan engine generik (sama dgn Marketing).
 */
const SALES_WORKFLOW: WorkflowDef = {
  id: "wf-sales-default",
  name: "Sales — Riset Calon → Penawaran → Review → Approval → Outreach",
  steps: [
    {
      id: "wf-sales-intake",
      role: "Sales Manager",
      action: "plan_directive",
      next: "wf-sales-research",
    },
    {
      id: "wf-sales-research",
      role: "Lead Researcher",
      action: "market_research",
      next: "wf-sales-write",
    },
    {
      id: "wf-sales-write",
      role: "Proposal Writer",
      action: "write_content",
      next: "wf-sales-review",
    },
    {
      // Reviewer me-loop ke penulisan sampai penawaran layak dikirim.
      id: "wf-sales-review",
      role: "Sales Reviewer",
      action: "review_content",
      next: "loop_until_pass",
    },
    {
      // Setelah lolos review, Manager minta approval owner sebelum kontak pihak luar.
      id: "wf-sales-approval",
      role: "Sales Manager",
      action: "request_approval",
      next: "approval_gate",
    },
    {
      // Hanya berjalan setelah approval; kirim outreach ke calon pembeli.
      id: "wf-sales-send",
      role: "Outreach Rep",
      action: "send_outreach",
      // tanpa `next` = langkah terakhir.
    },
  ],
};

/** Role default Sales (plan §5). Semua editable lewat Character Editor. */
const SALES_ROLES: RoleTemplate[] = [
  {
    role: "Sales Manager",
    description:
      "Manager departemen Penjualan. Terima arahan owner, pecah jadi target outreach, koordinasi " +
      "tim, dan minta approval sebelum mengontak calon pembeli. Jadi 'wajah' balasan ke owner.",
    skillScope: ["message_agent", "ask_user"],
    guardrails: [
      { rule: "propose_only" },
      { rule: "approval_required_for_external_actions" },
    ],
    spriteKey: "sales_manager",
  },
  {
    role: "Lead Researcher",
    description:
      "Periset calon pembeli (lead). Cari prospek, kebutuhan, dan sinyal beli; rangkum jadi " +
      "daftar calon + konteks untuk penyusunan penawaran.",
    skillScope: ["web_search", "web_fetch", "market_research"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "lead_researcher",
  },
  {
    role: "Proposal Writer",
    description:
      "Penulis penawaran. Susun pesan outreach/penawaran yang dipersonalisasi sesuai brief & " +
      "konteks calon pembeli. Hasilkan draf yang siap direview.",
    skillScope: ["write_content"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "proposal_writer",
  },
  {
    role: "Sales Reviewer",
    description:
      "Reviewer penawaran. Nilai kejelasan, kesopanan, kepatuhan, dan kecocokan dengan calon. " +
      "Minta revisi sampai layak, lalu loloskan ke tahap approval.",
    skillScope: ["review_content"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "sales_reviewer",
  },
  {
    role: "Outreach Rep",
    description:
      "Pengirim outreach. Kirim pesan penawaran ke calon pembeli (email/DM/WhatsApp) HANYA " +
      "setelah di-approve owner. Selalu lewat approval gate.",
    skillScope: ["send_outreach"],
    guardrails: [
      { rule: "approval_required_for_external_actions" },
      { rule: "rate_limit", params: { maxPostsPerDay: 20 } },
    ],
    spriteKey: "outreach_rep",
  },
];

/** Union skill semua role = skill pool default departemen. */
const SALES_DEFAULT_SKILLS: string[] = Array.from(
  new Set(SALES_ROLES.flatMap((r) => r.skillScope)),
);

/** Template Sales lengkap (data-driven, editable setelah di-seed). */
export const SALES_TEMPLATE: DepartmentTemplate = {
  id: SALES_TEMPLATE_ID,
  name: "Penjualan (Sales)",
  description:
    "Departemen penjualan end-to-end: riset calon pembeli → tulis penawaran → review → approval " +
    "→ kirim outreach. Template #2 untuk membuktikan engine generik; semua role/skill/workflow editable.",
  roleTemplates: SALES_ROLES,
  defaultSkills: SALES_DEFAULT_SKILLS,
  defaultWorkflow: SALES_WORKFLOW,
};
