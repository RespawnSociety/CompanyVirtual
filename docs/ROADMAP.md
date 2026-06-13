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
| **0** | Foundations & Spikes | ✅ selesai (0.1–0.6 lolos; Codex verified) | 9Router + 1 agent loop + WA auto-reply |
| **1** | Platform Shell + Company Setup | ✅ Codex-reviewed (1.1–1.9); sisa BUG-107/108 + CR-101 (auth) = keputusan owner | Kantor 2D + Company/Dept/Character editor |
| **2** | Runtime + 1 Agent Nyata | ✅ selesai (2.1–2.6; Codex sweep Phase 0–3 ✓, nol bug high+) | Directive → agent kerja → Artifact |
| **3** | Departemen Lengkap + Workflow Engine | ✅ selesai (3.1–3.6; Codex sweep ✓, BUG-112/113 `VERIFIED_FIXED`) | Pipeline Marketing + Approval Gate |
| **4** | Aksi Eksternal + Keamanan | ✅ selesai (4.1–4.5; Codex VERIFIED — BUG-107/108/114/115 `VERIFIED_FIXED`, CR-101 `VERIFIED`; test 89/89) | Publish (Playwright/dry-run) + Vault + audit + guardrails + auth boundary |
| **5** | Platform Generalization | ⬜ belum | ≥2 departemen berjalan stabil |
| **6** | App Packaging | ⬜ belum | Tauri desktop + web |
| **7** | Memory Graph per Agent | ⬜ belum | Visualisasi graph memory (ala graphify.net) per karakter |

Legenda: ⬜ belum · 🟡 jalan · ✅ selesai (DoD lolos + Codex verified)

> **Catatan DB (2026-06-13):** persistensi pindah dari `node:sqlite` ke **MySQL/MariaDB (XAMPP)** via `mysql2` (keputusan owner). Store kini **async**. Lihat `docs/SPIKES.md` (Keputusan DB) & `docs/RUNBOOK.md` (setup).

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
- [x] **0.6 Codex review Phase 0** — review kontrak `shared` + router + loop; isi BUGLIST/CODE_REVIEW; fix sampai bersih.
  - *DoD:* ✅ Codex review 3 bug (BUG-001..003) + 4 temuan kualitas (CR-001..004) → semua di-fix Claude → Codex `VERIFIED_FIXED`/`VERIFIED`. `BUGLIST.md` & `CODE_REVIEW.md` kosong (nol item `OPEN`/`REOPENED`). Ringkasan: `docs/PERBAIKAN-2026-06-10.md`.

**DoD Fase 0:** `SPIKES.md` terisi ✅ · skrip 9Router + agent loop pakai 1 tool nyata ✅ · auto-reply WA owner jalan, nomor lain ditolak ✅ · kontrak skill/router final ✅ · review Codex (0.6) lolos ✅. **Fase 0 ditandai ✅ selesai (2026-06-10).**

**Status build:** `npm run build` ✅ · `npm run lint` ✅ · `npm test` ✅ 30/30 · spike `router`/`loop`/`wa` ✅.

---

## Phase 1 — Platform Shell + Company Setup 🎮

**Tujuan:** dunia 2D + seluruh layer konfigurasi data-driven (belum ada agent hidup).

- [x] **1.1 Tilemap kantor** — Phaser 3 + Vite, load map Tiled (JSON), 1 lantai, karakter bisa jalan (pathfinding easystarjs), jam + HUD. → `apps/web/src/game/OfficeScene.ts`, map `apps/web/public/assets/maps/office.json`.
- [x] **1.2 DB layer** — `ConfigStore` repository untuk entitas `shared`. Save/load + cascade. → `apps/server/src/db/`. *(Awalnya `node:sqlite`; Phase 2 pindah ke **MySQL/MariaDB** via `mysql2` — store async. Lihat Catatan DB.)*
- [x] **1.3 Company Setup (UI React)** — buat & namai company, branding (warna), tambah/hapus floor → tersimpan ke DB. → `apps/web/src/components/CompanySetup.tsx`.
- [x] **1.4 Department Builder (UI)** — tambah departemen ke floor: dari template atau custom; atur purpose, skillPool. → `DepartmentBuilder.tsx`.
- [x] **1.5 Character Editor (UI)** — form → `AgentProfile` (identitas, sprite, deskripsi→persona, skillScope, guardrails, deskPos, modelPolicy) → DB. → `CharacterEditor.tsx`.
- [x] **1.6 Marketing template** — `packages/templates/marketing`: roleTemplates (Manager, Market Checker, Script Maker, Reviewer, Social Media), defaultSkills, defaultWorkflow. Seed lewat `seedDepartmentFromTemplate` (engine generik, workflow di-clone).
- [x] **1.7 Task Board & Comms Viewer (dummy)** — tampilkan data placeholder (tabel/papan; data nyata mulai Phase 2/3). → `TaskBoard.tsx`, `CommsViewer.tsx`.
- [x] **1.8 WS/REST bridge** — `FACE <-> ORCH`: REST `/api/*` (Fastify) + socket.io `RealtimeHub` (room per company; `world:sync` + jalur `agent:event` untuk animasi Phase 2). → `apps/server/src/api/routes.ts`, `realtime.ts`, `apps/web/src/{api,socket}.ts`.
- [x] **1.9 Codex review Phase 1** — **sudah** direview Codex (2026-06-11): menghasilkan BUG-106..109 + CR-109 + temuan auth. Mayoritas di-FIX & dibersihkan dari daftar aktif; **tersisa `BUG-107`/`BUG-108` + `CR-101`** = keputusan strategi auth web/socket (owner), bukan blocker review. Kode **migrasi DB ke MySQL** (Phase 2) dicek ulang di sweep 0–2.

**DoD Fase 1:** buat company nama bebas → tambah dept Marketing dari template → karakter muncul di lantai & bisa jalan → semua config tersimpan & ter-load ulang.

**Status build Phase 1:** `npm run build` ✅ · `npm run lint` ✅ · `npm run typecheck:web` ✅ · `npm run build:web` ✅ · `npm test` ✅ (kini 52/52 termasuk Phase 2). Smoke live: REST company→floor→dept(template)→world (5 agent) + socket.io `world:sync` ✅. **Fase 1: Codex sudah review (1.9 ✅).** Sisa item auth (BUG-107/108, CR-101) menunggu keputusan strategi auth — lihat `docs/BUGLIST.md`.

---

## Phase 2 — Runtime + 1 Agent Nyata 🤖

**Tujuan:** satu karakter benar-benar hidup & menghasilkan output AI nyata.

- [x] **2.1 Registry karakter↔agent** — `apps/server/src/registry/dispatcher.ts`: `DirectiveDispatcher` me-resolve `AgentProfile` dari ConfigStore (selalu fresh) → jalankan agent loop generik.
- [x] **2.2 Skill `write_content`** — `agent-runtime/src/skills/writeContent.ts` (konten nyata via 9Router; non-risky). Terdaftar di `main.ts`, `KNOWN_SKILLS.implemented=true`.
- [x] **2.3 Directive → Task → Agent** — `POST /api/agents/:agentId/directives` → buat `Directive`+`Task` → dispatch (latar belakang) → loop → hasil final jadi `Artifact`, status Task/Directive diperbarui. Endpoint balas 202.
- [x] **2.4 Animasi status** — `agent:event` (socket.io) → `OfficeScene.setAgentStatus` (titik status + denyut saat working) + composer arahan di tab Kantor + Task Board live (refetch saat event).
- [x] **2.5 Memory nyata** — `MysqlMemoryStore` persisten (tabel `memory_items`), retrieval recency+relevance (keyword) sama dengan InMemory; di-inject ke dispatcher.
- [x] **2.6 Codex review Phase 2** — ✅ **direview Codex** (sweep Phase 0–3, 2026-06-13): semua LLM lewat router (tak ada provider langsung) & tak ada panggilan LLM per-tick animasi terkonfirmasi; migrasi MySQL/async dicek. Nol bug high+ tersisa (BUG-112/113 dari sweep → `VERIFIED_FIXED`).

**DoD Fase 2:** ketik arahan → karakter "bekerja" → konten asli AI (via 9Router) tersimpan & tampil di Task Board.

**Status Phase 2:** `npm run build` ✅ · `npm run lint` ✅ · `npm run typecheck:web` ✅ · `npm run build:web` ✅ · `npm test` ✅ 52/52 (+ db/seed/configApi migrasi MySQL, dispatch/write_content/memory). Smoke live (MySQL, 9Router down): REST company→floor→dept(template)→directive→Task (202, lalu `blocked` saat router mati) + cascade delete ✅. **Konten AI nyata butuh 9Router hidup** (uji manual saat 9Router jalan). Menunggu sweep Codex 0–2 (2.6).

---

## Phase 3 — Departemen Lengkap + Workflow Engine 🧩

**Tujuan:** seluruh role Marketing jalan sebagai pipeline data-driven + approval.

- [x] **3.1 Semua role Marketing sebagai agent** — engine me-resolve agent per `role` di departemen (`WorkflowEngine.resolveAgentForRole`); tiap step di-dispatch ke agent-nya. Publish (Social Media) = stub (skill risky belum diregistrasi → agent balas teks, Phase 4 isi nyata).
- [x] **3.2 Skills pendukung** — `review_content` (verdict PASS/REVISI), `market_research`, `web_fetch` (mock) diimplementasi + diregistrasi (`KNOWN_SKILLS.implemented=true`). `message_agent`/`ask_user` belum (delegasi ditangani engine; tetap `implemented=false`).
- [x] **3.3 Generic Workflow Engine** — `apps/server/src/workflow/engine.ts`: baca `WorkflowDef` (DATA), eksekusi step urut, token `loop_until_pass` (loop revisi ke step konten, cap `maxReviewRounds`) & `approval_gate` (pause + persist `WorkflowRun`). **Tanpa cabang "marketing".**
- [x] **3.4 Delegasi internal** — engine mengoordinasi role→role (output mengalir antar-step via `stepArtifacts`/konteks); Manager step `request_approval` = "wajah" yang mengirim pesan minta approval ke owner.
- [x] **3.5 Approval Gate + resume** — pause di `approval_gate` (run `awaiting_approval`), resume `APPROVE`/`REVISI` lewat `POST /api/approvals/:approvalId` (UI WorkflowPanel) + event `approval_requested`/`message` ke owner. *(Inbound WA `APPROVE`/`REVISI` 2-arah penuh = lanjutan Phase 4 saat Cloud API hidup; jalur keputusan lewat UI sudah lengkap.)*
- [x] **3.6 Codex review Phase 3** — ✅ **direview Codex** (sweep Phase 0–3, 2026-06-13): engine data-driven (tanpa hardcode "marketing"), approval gate tak bisa di-bypass, threading/`stepArtifacts` benar. Temuan BUG-112/113 → di-fix Claude → `VERIFIED_FIXED`. Nol bug high+ tersisa.

**DoD Fase 3:** 1 directive mengalir lewat seluruh departemen → konten direview & dicek pasar → Manager minta approval → keputusanmu menggerakkan langkah berikut.

**Status Phase 3:** `npm test` ✅ 57/57 (+ `tests/workflow.test.ts`: pipeline penuh, loop revisi, approval pause, resume approve/revise) · `build`/`lint`/`typecheck:web`/`build:web` ✅. **Smoke LIVE via 9Router (kr/claude-sonnet-4.5):** arahan "caption promo diskon 30%" → pipeline Manager→riset→tulis→review (loop 2×)→approval → **konten AI nyata** → APPROVE → publish (stub) → run+directive `done` ✅. WA relay 2-arah inbound approve = lanjutan. Menunggu Codex 3.6.

---

## Phase 4 — Aksi Eksternal + Keamanan 🔐

**Tujuan:** publish nyata ke akun test, aman & ter-audit.

> **Keputusan owner (2026-06-13):** skill sosial = **Playwright browser** (jalur posting nyata) dengan
> default **mock/dry-run** untuk tes/dev; Vault = **encrypted file** (AES-256-GCM) + fallback env;
> auth boundary (BUG-107/108 + CR-101) **ditutup di fase ini**.

- [x] **4.1 Credential Vault** — `apps/server/src/security/vault.ts`: `FileVault` (AES-256-GCM, master key scrypt dari `VAULT_MASTER_KEY`, file terenkripsi di-gitignore) + `EnvVault` fallback + `LayeredVault`; `createVaultFromEnv` (mode file/env/noop). CLI `npm run vault`. Tak ada secret di prompt/log/commit (nilai tak pernah di-log).
- [x] **4.2 Skill sosial** — `agent-runtime/src/skills/socialPost.ts`: `ig_post`/`twitter_post`/`schedule_post` (semua `risky`, **approval-gated + preview**). Provider pluggable: `mockPostPublisher` (dry-run default) + `createPlaywrightPostPublisher` (browser nyata, lazy-import, kredensial dari Vault, **domain allowlist** least-privilege). Pilih via `POST_PROVIDER`. `KNOWN_SKILLS.implemented=true`.
- [x] **4.3 Audit log** — tabel `audit_entries` + `approvals` (persist). `ctx.audit` (kontrak `@vc/shared`) dipanggil skill aksi eksternal; engine mencatat `approval_requested`/`approval_decided`/`publish_authorized`/`publish_blocked`. Endpoint `GET /api/companies/:id/audit`.
- [x] **4.4 Guardrails** — `apps/server/src/security/guardrails.ts`: `rate_limit` (maxPostsPerDay via hitung audit 24 jam), `posting_hours` (jam lokal, mendukung lewat tengah malam), least-privilege domain (Playwright allowlist). Ditegakkan di engine pra-eksekusi skill `risky` pasca-approval.
- [x] **Auth boundary (BUG-107/108 + CR-101)** — helper `security/auth.ts` (`hasValidBearer`/`hasValidSocketToken`) dipakai REST (`server.ts`) **dan** Socket.IO (`realtime.ts` `io.use`); web kirim bearer (`VITE_API_AUTH_TOKEN`) di REST + socket handshake.
- [x] **4.5 Codex review Phase 4** — Codex (CLI dipasang owner) mereview keamanan: **BUG-107/108 → `VERIFIED_FIXED`**, **CR-101 → `VERIFIED`**; menemukan **BUG-114** (publish gagal pasca-approval berakhir `done` tanpa audit) & **BUG-115** (edit agent UI membuang params guardrail) → di-FIX Claude → **Codex re-verifikasi `VERIFIED_FIXED`**. Tidak ada bug `OPEN`/`REOPENED` tersisa.

**DoD Fase 4:** konten yang di-approve **terbit di akun test**, dengan audit trail & approval manual.
**Status Phase 4: ✅ selesai (2026-06-13).** `npm run build` ✅ · `npm run lint` ✅ · `npm run typecheck:web` ✅ · `npm run build:web` ✅ · `npm test` ✅ **89/89** (+ vault, social mock, guardrails, audit/approval store, publish via engine [approve→dry-run + guardrail rate-limit block + BUG-114 failure→blocked], auth helper + realtime BUG-108, BUG-115 guardrail param validation). Codex VERIFIED (BUG-107/108/114/115 `VERIFIED_FIXED`, CR-101 `VERIFIED`) — nol bug high+ tersisa. **Catatan:** publish "terbit di akun test" butuh setup manual (`POST_PROVIDER=playwright` + `npx playwright install chromium` + kredensial Vault + selektor UI di `playwrightPublisher.postToPlatform`); default mock = pipeline penuh tanpa terbit nyata.

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

## Phase 7 — Memory Graph per Agent 🧠🕸️

**Tujuan:** tiap agent punya "otak" yang bisa dilihat — klik karakter → tampil **graph memory interaktif** ala [graphify.net](https://graphify.net/): node = ingatan (`MemoryItem`), edge = keterkaitan antar-ingatan. Memberi observability ke apa yang "diketahui" & "diingat" agent (plan §8: Agent Inspector).

> Bergantung pada **memory nyata (2.5)** yang sudah persisten (MySQL `memory_items`). Phase ini menambah *relasi* antar memory + visualisasinya, bukan menyimpan memory dari nol.

- [ ] **7.1 Model relasi memory** — turunkan edge antar `MemoryItem` (tambah kontrak `MemoryEdge`/`MemoryGraph` di `@vc/shared`): keterkaitan via tag bersama, co-occurrence keyword, dan rujukan eksplisit (task/directive yang sama). Bobot edge = kekuatan keterkaitan.
- [ ] **7.2 Endpoint graph** — `GET /api/agents/:id/memory-graph` → `{ nodes: MemoryItem[], edges: MemoryEdge[] }` (di-scope per `memoryNamespace`). Batasi ukuran (top-N node by importance+recency) agar payload & render wajar.
- [ ] **7.3 Graph view UI (force-directed)** — klik karakter di world 2D → buka panel **Memory Graph**: node bisa di-drag/zoom/pan, klik node → detail ingatan (kind, teks, tags, createdAt, importance). Visual ala graphify (kluster per tag/topik).
- [ ] **7.4 Memory linking saat tulis** — saat agent menyimpan `MemoryItem` baru (di loop), hitung & simpan keterkaitan ke ingatan terkait (keyword dulu; embeddings via 9Router bila tersedia) → edge muncul live.
- [ ] **7.5 (Opsional) Embeddings 9Router** — ganti keterkaitan keyword dengan kemiripan embedding untuk kluster yang lebih bermakna; tetap lewat `agent-runtime/src/router` (tak ada provider langsung).
- [ ] **7.6 Codex review Phase 7** — fokus: query graph efisien (tak N+1/tak muat-semua tanpa batas), retrieval konsisten dengan memory store, tak ada panggilan LLM per-render.

**DoD Fase 7:** klik sebuah karakter → muncul graph memory-nya yang interaktif (node ingatan + edge keterkaitan), bisa zoom/pan/klik node untuk detail; graph ter-update saat agent memperoleh ingatan baru.

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
