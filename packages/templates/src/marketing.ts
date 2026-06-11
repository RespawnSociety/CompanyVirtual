/**
 * Department Template #1 — Marketing (plan §5).
 *
 * INI HANYA DATA (seed). Engine TIDAK boleh meng-hardcode "marketing" — ia membaca
 * template ini sebagai data lalu meng-instansiasi Department + AgentProfile + Workflow.
 * Semua field di sini editable setelah di-seed (lihat Department Builder & Character Editor).
 *
 * Skill yang dirujuk (`skillScope`/`defaultSkills`) adalah NAMA skill dari Skill Registry
 * global. Sebagian belum diimplementasi sampai Phase 2–4 (mis. write_content, ig_post);
 * di Phase 1 namanya cukup sebagai konfigurasi.
 */

import type { DepartmentTemplate, RoleTemplate, WorkflowDef } from "@vc/shared";

/** Id template stabil (dipakai Department.templateId saat di-seed). */
export const MARKETING_TEMPLATE_ID = "tmpl-marketing";

/**
 * Workflow default Marketing (plan §5):
 *   Manager → Market Checker → Script Maker → Reviewer (loop revisi)
 *   → Approval via WA → Social Media publish.
 *
 * Catatan interpretasi (untuk Workflow Engine generik, Phase 3):
 * - `next` berisi id step berikutnya, atau token khusus `loop_until_pass` / `approval_gate`.
 * - Token tidak membawa target; engine melanjutkan ke step BERIKUTNYA pada array `steps`
 *   setelah konstruksi loop/gate selesai. Urutan array = urutan alami pipeline.
 */
const MARKETING_WORKFLOW: WorkflowDef = {
  id: "wf-marketing-default",
  name: "Marketing — Riset → Tulis → Review → Approval → Publish",
  steps: [
    {
      id: "wf-mkt-intake",
      role: "Manager",
      action: "plan_directive",
      next: "wf-mkt-research",
    },
    {
      id: "wf-mkt-research",
      role: "Market Checker",
      action: "market_research",
      next: "wf-mkt-write",
    },
    {
      id: "wf-mkt-write",
      role: "Script Maker",
      action: "write_content",
      next: "wf-mkt-review",
    },
    {
      // Reviewer me-loop ke penulisan sampai lolos kualitas/brand voice.
      id: "wf-mkt-review",
      role: "Reviewer",
      action: "review_content",
      next: "loop_until_pass",
    },
    {
      // Setelah lolos review, Manager minta approval owner via WhatsApp.
      id: "wf-mkt-approval",
      role: "Manager",
      action: "request_approval",
      next: "approval_gate",
    },
    {
      // Hanya berjalan setelah approval; publish ke akun (Phase 4).
      id: "wf-mkt-publish",
      role: "Social Media",
      action: "schedule_post",
      // tanpa `next` = langkah terakhir.
    },
  ],
};

/** Role default Marketing (plan §5). Semua editable lewat Character Editor. */
const MARKETING_ROLES: RoleTemplate[] = [
  {
    role: "Manager",
    description:
      "Manager departemen Pemasaran. Terima arahan owner, pecah jadi task, koordinasi tim, " +
      "lapor progres, dan minta approval sebelum aksi berisiko. Jadi 'wajah' balasan ke owner.",
    skillScope: ["message_agent", "ask_user"],
    guardrails: [
      { rule: "propose_only" },
      { rule: "approval_required_for_external_actions" },
    ],
    spriteKey: "manager",
  },
  {
    role: "Market Checker",
    description:
      "Periset pasar. Cari tren, kompetitor, audiens, dan keyword relevan. Rangkum temuan " +
      "jadi masukan untuk pembuatan konten.",
    skillScope: ["web_search", "web_fetch", "browser_do", "market_research"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "market_checker",
  },
  {
    role: "Script Maker",
    description:
      "Penulis konten. Tulis caption, script video, thread, hook, dan CTA sesuai brief & " +
      "brand voice. Hasilkan draf yang siap direview.",
    skillScope: ["write_content"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "script_maker",
  },
  {
    role: "Reviewer",
    description:
      "Reviewer kualitas. Nilai konten dari sisi kualitas, brand voice, dan kepatuhan. " +
      "Minta revisi sampai layak, lalu loloskan ke tahap approval.",
    skillScope: ["review_content"],
    guardrails: [{ rule: "no_external_publish" }],
    spriteKey: "reviewer",
  },
  {
    role: "Social Media",
    description:
      "Pengelola sosial media. Jadwalkan & publish konten ke akun (IG/Twitter) HANYA setelah " +
      "di-approve owner. Selalu lewat approval gate.",
    skillScope: ["ig_post", "twitter_post", "schedule_post"],
    guardrails: [
      { rule: "approval_required_for_external_actions" },
      { rule: "rate_limit", params: { maxPostsPerDay: 5 } },
    ],
    spriteKey: "social_media",
  },
];

/** Union skill semua role = skill pool default departemen. */
const MARKETING_DEFAULT_SKILLS: string[] = Array.from(
  new Set(MARKETING_ROLES.flatMap((r) => r.skillScope)),
);

/** Template Marketing lengkap (data-driven, editable setelah di-seed). */
export const MARKETING_TEMPLATE: DepartmentTemplate = {
  id: MARKETING_TEMPLATE_ID,
  name: "Pemasaran (Marketing)",
  description:
    "Departemen pemasaran end-to-end: riset pasar → tulis konten → review → approval → publish. " +
    "Template #1 untuk memvalidasi platform; semua role/skill/workflow editable.",
  roleTemplates: MARKETING_ROLES,
  defaultSkills: MARKETING_DEFAULT_SKILLS,
  defaultWorkflow: MARKETING_WORKFLOW,
};
