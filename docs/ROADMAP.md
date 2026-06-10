# ROADMAP — Virtual Company Platform (Eksekusi)

> Turunan konkret & bisa-dikerjakan dari `virtual-company-platform-plan.md` §11.
> Plan = *apa & kenapa*. Roadmap ini = *urutan, task, file, dan kapan dianggap selesai*.
> Konvensi: prosa Bahasa Indonesia, identifier/path English. Dieksekusi **Claude Code** (builder/fixer) dengan **Codex** (reviewer/bug hunter — lihat `AGENTS.md`).

---

## Prinsip Eksekusi (berlaku di semua fase)

1. **Contracts-first.** Tipe & event di `packages/shared` ditulis **sebelum** implementasi yang memakainya.
2. **Spike dulu untuk hal berisiko** (9Router tool-calling, WhatsApp inbound). Catat di `docs/SPIKES.md`.
3. **Engine generik, bukan hardcode.** "marketing" hidup sebagai template di `packages/templates/marketing`, bukan di engine.
4. **Satu DoD per PR.** Tiap task punya cara uji manual di `docs/RUNBOOK.md`.
5. **Loop review wajib tiap PR:** Claude bangun → **Codex review + isi `docs/BUGLIST.md` / `docs/CODE_REVIEW.md`** → Claude fix → **Codex set `VERIFIED_FIXED`**. PR tidak "done" selama masih ada bug `OPEN`/`REOPENED` ber-severity high+.
6. **Approval Gate, Owner Auth, Vault = non-negotiable.** Tidak boleh "nanti dulu".

**Definition of Done global (tiap task):** kode jalan & teruji manual (RUNBOOK) · kontrak di `shared` konsisten · tidak ada secret ter-commit · Codex sudah review & tidak ada bug high+ tersisa.

---

## Peta Fase & Status

| Fase | Tema | Status | Output utama |
|---|---|---|---|
| **0** | Foundations & Spikes | 🟡 jalan (0.1–0.5 selesai; 0.6 Codex pending) | 9Router + 1 agent loop + WA auto-reply |
| **1** | Platform Shell + Company Setup | ⬜ belum | Kantor 2D + Company/Dept/Character editor |
| **2** | Runtime + 1 Agent Nyata | ⬜ belum | Directive → agent kerja → Artifact |
| **3** | Departemen Lengkap + Workflow Engine | ⬜ belum | Pipeline Marketing + Approval Gate |
| **4** | Aksi Eksternal + Keamanan | ⬜ belum | Publish ke akun test + Vault + audit |
| **5** | Platform Generalization | ⬜ belum | ≥2 departemen berjalan stabil |
| **6** | App Packaging | ⬜ belum | Tauri desktop + web |

Legenda: ⬜ belum · 🟡 jalan · ✅ selesai (DoD lolos + Codex verified)

---

## Phase 0 — Foundations & Spikes 🔬

**Tujuan:** buktikan tiga integrasi paling berisiko jalan, dan kunci kontrak inti.

- [x] **0.1 Monorepo skeleton** — setup workspace (`apps/`, `packages/`), TS config, linter, `.gitignore` (+ aturan secret). Tidak ada logika bisnis.
  - *Files:* root `package.json` (npm workspaces), `tsconfig.base.json` + project references, `.gitignore`, `eslint.config.mjs`, `.env.example`. ✅ build & lint bersih.
- [x] **0.2 Kontrak inti `packages/shared`** — semua tipe dari plan §9 (`Company`, `Floor`, `Department`, `DepartmentTemplate`, `AgentProfile`, `WorkflowDef`, `MemoryItem`, `Directive`, `Task`, `Artifact`, `ApprovalRequest`, `CommsMessage`, `AuditEntry`) + `AgentEvent` + kontrak `Skill`/`RouterClient`.
  - *DoD:* ✅ tipe ter-compile, di-export, dipakai `agent-runtime` & `server`.
- [x] **0.3 Spike 9Router** — `agent-runtime/src/router`: client OpenAI-compatible ke `localhost:20128/v1`, **chat + tool/function calling** jalan, fallback 3-tier.
  - *DoD:* ✅ **terbukti live** — `tool_calls` valid dari `kr/claude-sonnet-4.5`. Temuan `stream:false` dicatat di `SPIKES.md`.
- [x] **0.4 Spike agent loop minimal** — `agent-runtime/src/loop.ts`: 1 agent, event → LLM → 1 skill nyata (`web_search`) → balas; memory tersimpan.
  - *DoD:* ✅ terbukti mock & live — think→act → web_search → balas → 2 memory item tersimpan.
- [x] **0.5 Spike WhatsApp adapter + Owner Auth** — `apps/server/comms`: adapter (Cloud API + Mock), webhook inbound (Fastify), **filter nomor owner/whitelist**, auto-reply.
  - *DoD:* ✅ chat dari nomor owner → auto-reply; nomor lain ditolak (tak menyetir agent). (Cloud API diimplementasi; Baileys ditunda — lihat SPIKES §0.5.)
- [ ] **0.6 Codex review Phase 0** — review kontrak `shared` + router + loop; isi BUGLIST/CODE_REVIEW; fix sampai bersih. **(MENUNGGU Codex.)**

**DoD Fase 0:** `SPIKES.md` terisi ✅ · skrip 9Router + agent loop pakai 1 tool nyata ✅ · auto-reply WA owner jalan, nomor lain ditolak ✅ · kontrak skill/router final ✅. **Sisa: review Codex (0.6) sebelum fase ditandai ✅.**

**Status build:** `npm run build` ✅ · `npm run lint` ✅ · `npm test` ✅ 24/24 · spike `router`/`loop`/`wa` ✅.

---

## Phase 1 — Platform Shell + Company Setup 🎮

**Tujuan:** dunia 2D + seluruh layer konfigurasi data-driven (belum ada agent hidup).

- [ ] **1.1 Tilemap kantor** — Phaser 3 + Vite, load map Tiled (JSON), 1 lantai, karakter bisa jalan (pathfinding easystarjs), jam + HUD.
- [ ] **1.2 DB layer** — SQLite + repository untuk entitas `shared`. Save/load.
- [ ] **1.3 Company Setup (UI React)** — buat & namai company, branding, tambah floor → tersimpan ke DB.
- [ ] **1.4 Department Builder (UI)** — tambah departemen ke floor: pilih dari template atau custom; atur purpose, skillPool, workflowId.
- [ ] **1.5 Character Editor (UI)** — form → `AgentProfile` (identitas, sprite, deskripsi→persona, skillScope, guardrails, deskPos, modelPolicy) → DB.
- [ ] **1.6 Marketing template** — `packages/templates/marketing`: roleTemplates (Manager, Market Checker, Script Maker, Reviewer, Social Media), defaultSkills, defaultWorkflow. Seed sebagai dept pertama.
- [ ] **1.7 Task Board & Comms Viewer (dummy)** — tampilkan data placeholder.
- [ ] **1.8 WS/REST bridge** — `FACE <-> ORCH` (socket.io), event bus → animasi karakter.
- [ ] **1.9 Codex review Phase 1** — fokus: konsistensi kontrak DB↔shared, tidak ada hardcode "marketing" di engine.

**DoD Fase 1:** buat company nama bebas → tambah dept Marketing dari template → karakter muncul di lantai & bisa jalan → semua config tersimpan & ter-load ulang.

---

## Phase 2 — Runtime + 1 Agent Nyata 🤖

**Tujuan:** satu karakter benar-benar hidup & menghasilkan output AI nyata.

- [ ] **2.1 Registry karakter↔agent** — `apps/server/registry`: map `AgentProfile` → instance agent runtime.
- [ ] **2.2 Skill `write_content`** — `agent-runtime/skills/write_content` (lewat 9Router).
- [ ] **2.3 Directive → Task → Agent** — directive (UI/WA) → buat `Task` → dispatch ke 1 agent → agent loop kerja → hasil jadi `Artifact`.
- [ ] **2.4 Animasi status** — event `working/idle/talking` menggerakkan sprite via event bus.
- [ ] **2.5 Memory nyata** — short-term + long-term (`MemoryItem`) per agent, retrieval recency+relevance (keyword dulu).
- [ ] **2.6 Codex review Phase 2** — fokus: semua LLM lewat router (tak ada provider langsung), tidak ada panggilan LLM per-tick animasi.

**DoD Fase 2:** ketik arahan → karakter "bekerja" → konten asli AI (via 9Router) tersimpan & tampil di Task Board.

---

## Phase 3 — Departemen Lengkap + Workflow Engine 🧩

**Tujuan:** seluruh role Marketing jalan sebagai pipeline data-driven + approval.

- [ ] **3.1 Semua role Marketing sebagai agent** — Manager, Market Checker, Script Maker, Reviewer, Social Media (publish masih stub).
- [ ] **3.2 Skills pendukung** — `web_search`, `web_fetch`, `market_research`, `review_content`, `message_agent`, `ask_user`.
- [ ] **3.3 Generic Workflow Engine** — `apps/server/workflow`: baca `WorkflowDef` (data), eksekusi step, `loop_until_pass` (loop revisi), `approval_gate`. **Tanpa if-else per departemen.**
- [ ] **3.4 Delegasi internal** — Manager → anggota via `message_agent`; Manager sebagai "wajah" balasan.
- [ ] **3.5 WA relay 2 arah + Approval Gate** — threading per directive; approval inline (`APPROVE` / `REVISI: ...`); aksi berisiko pause sampai approve.
- [ ] **3.6 Codex review Phase 3** — fokus: engine benar-benar data-driven, approval gate tak bisa di-bypass, threading benar.

**DoD Fase 3:** 1 directive mengalir lewat seluruh departemen → konten direview & dicek pasar → Manager minta approval via WA → keputusanmu menggerakkan langkah berikut.

---

## Phase 4 — Aksi Eksternal + Keamanan 🔐

**Tujuan:** publish nyata ke akun test, aman & ter-audit.

- [ ] **4.1 Credential Vault** — `apps/server/security`: enkripsi (keychain/sops/age), `VaultReader`. Tak ada secret di prompt/log/commit.
- [ ] **4.2 Skill sosial** — `ig_post`, `twitter_post`, `schedule_post` (API resmi diutamakan, browser Playwright fallback), semua **approval-gated + preview**.
- [ ] **4.3 Audit log** — `AuditEntry` tiap aksi + approval.
- [ ] **4.4 Guardrails** — rate limit, jam posting, least-privilege (batasi domain/perintah).
- [ ] **4.5 Codex review Phase 4** — fokus keamanan: secret handling, semua aksi eksternal lewat approval, audit lengkap.

**DoD Fase 4:** konten yang di-approve **terbit di akun test**, dengan audit trail & approval manual.

---

## Phase 5 — Platform Generalization 🏢⭐

**Tujuan:** buktikan ini platform, bukan app marketing.

- [ ] **5.1 Department Template Library** — tambah ≥1 template baru (Sales/CS/Produk/…): role+skill+workflow berbeda, engine sama.
- [ ] **5.2 Multi-floor & perpindahan lantai** — navigasi antar lantai di world 2D.
- [ ] **5.3 Custom department** — buat dept tanpa template lewat Department Builder.
- [ ] **5.4 KPI dashboard** — per departemen/company; biaya per "hari kerja" terpantau.
- [ ] **5.5 Save/resume + optimasi** — performa & biaya (throttle, cache routing tier 9Router).
- [ ] **5.6 Codex review Phase 5** — fokus: nol regresi pada Marketing saat menambah dept kedua; tak ada coupling departemen-spesifik di engine.

**DoD Fase 5:** pengguna bisa buat company baru, tambah **≥2 departemen berbeda** dari template/custom, keduanya jalan stabil, biaya terpantau.

---

## Phase 6 — App Packaging 📦

**Tujuan:** distribusi sebagai app yang tinggal klik.

- [ ] **6.1 Tauri shell** — `apps/desktop`: bungkus web + jalankan/pantau 9Router & agent lokal.
- [ ] **6.2 Web responsif** — tetap jalan di browser.
- [ ] **6.3 (Opsional) mobile companion.**
- [ ] **6.4 Codex review final** — sweep keamanan & kebersihan menyeluruh.

**DoD Fase 6:** dobel-klik app → service lokal hidup → platform jalan; juga jalan di browser.

---

## Jalur Kritis (urutan dependensi)

```
0.2 shared ──┬─► 0.3 router ──► 0.4 loop ──► 2.x runtime ──► 3.x workflow ──► 4.x aksi eksternal
             ├─► 0.5 WA + owner auth ───────────────────────► 3.5 WA relay + approval
             └─► 1.2 DB ──► 1.3–1.6 config UI ──► 1.6 marketing template ──► 3.1 role marketing
                                                                              │
                                                          5.x generalization ◄┘ ──► 6.x packaging
```

**Aturan:** jangan mulai task yang dependensinya belum `✅`. `packages/shared` adalah leher botol — kunci dulu sebelum melebar.

---

## Cara update roadmap ini
- Centang `[x]` saat task lolos DoD **dan** Codex `VERIFIED`.
- Update kolom Status di "Peta Fase" (⬜→🟡→✅).
- Bug yang muncul saat sebuah task → masuk `docs/BUGLIST.md`, bukan dicatat di sini.
