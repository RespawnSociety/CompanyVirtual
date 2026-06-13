# RUNBOOK — Virtual Company Platform

> Cara menjalankan & **menguji manual** tiap kemampuan. Satu DoD per task (roadmap §0).
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

---

## Prasyarat

- **Node.js ≥ 20** (dites di Node 25). Cek: `node --version`.
- Paket dependency lewat **npm workspaces** (pnpm tidak wajib).
- **MySQL/MariaDB hidup** (mis. **XAMPP** — start "MySQL" di control panel). Mulai Phase 2
  persistensi pakai MySQL (driver `mysql2`, tanpa native build). Default koneksi cocok dengan
  XAMPP (`127.0.0.1:3306`, user `root`, password kosong).

## Setup

```bash
npm install            # pasang dependency semua workspace
cp .env.example .env   # lalu isi nilai (Windows: copy .env.example .env)
```

Buat database (sekali; sesuaikan kredensial bila bukan XAMPP default):

```bash
# Windows + XAMPP:
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS virtual_company CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS virtual_company_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

`virtual_company` = database app; `virtual_company_test` = khusus `npm test` (di-TRUNCATE antar-test;
dibuat otomatis bila belum ada). Skema tabel dibuat otomatis saat server/test start (`ConfigStore.init`).

```bash
npm run build          # tsc --build (kompilasi semua package → dist/)
```

> `npm test` dan `npm run spike:*` otomatis menjalankan `npm run build` lebih dulu
> (lewat hook `pre*`), jadi langkah `build` manual hanya perlu sekali untuk memastikan.
> **Catatan:** sejak Phase 2, `npm test` (db/seed/configApi/dispatch) **butuh MySQL hidup**.
> Tes non-DB (router/loop/memory/relay/ownerAuth/cloudWebhook/templates/server) tetap jalan tanpa MySQL.

---

## Verifikasi cepat (semua logika Phase 0, tanpa layanan eksternal)

```bash
npm run typecheck      # semua tipe ter-compile (kontrak @vc/shared konsisten)
npm test               # unit test: router fallback, loop, memory, owner auth, webhook, relay
npm run spike:loop     # demo agent loop (mock): web_search → balas → memory tersimpan
npm run spike:wa       # demo owner auth: owner dibalas; nomor lain ditolak
```

Ketiganya **deterministik** dan tidak butuh 9Router/WhatsApp hidup.

---

## DoD per task

### 0.3 — 9Router tool/function calling (jalur live)
1. Pastikan 9Router berjalan di `NINEROUTER_BASE_URL` (default `http://localhost:20128/v1`).
2. Isi minimal satu model di `.env`: `NINEROUTER_MODEL_SUBSCRIPTION` / `_CHEAP` / `_FREE`.
3. Jalankan: `npm run spike:router`.
4. **Lolos bila:** output menampilkan `tool_calls` (mis. `get_weather(...)`).
   Bila model tak mendukung function calling, ganti model di `.env`.
- Logika fallback 3-tier (tanpa 9Router): `npm test` → `tests/router.test.ts`.

### 0.4 — Agent loop minimal
1. `npm run spike:loop` (mock) atau `npm run spike:loop -- --live` (pakai 9Router).
2. **Lolos bila:** status `done`, `web_search` terpanggil & sukses, ada balasan final,
   dan `memory tersimpan: ≥1 item`. Skrip mencetak `✓ DoD TERPENUHI`.

### 0.5 — WhatsApp auto-reply + Owner Auth

**A. Cepat (deterministik, tanpa WhatsApp):**
1. `npm run spike:wa`.
2. **Lolos bila:** Kasus 1 (owner) → `action: replied` + ada balasan terkirim;
   Kasus 2 (nomor lain) → `rejected_unknown_*` dan handler tidak dipanggil. `✓ DoD TERPENUHI`.

**B. Jalur HTTP (mode mock, uji webhook lokal):**
1. Set `.env`: `WA_ADAPTER=mock`, `WA_OWNER_NUMBERS=+62812...` (nomormu).
2. `npm run -w @vc/server dev` → server di `http://127.0.0.1:8787`.
3. Kirim payload webhook ala Cloud API (POST) — contoh PowerShell:
   ```powershell
   $body = @{ entry = @(@{ changes = @(@{ value = @{
     metadata = @{ display_phone_number = "15550009999" }
     messages = @(@{ from = "62812..."; id = "wamid.1"; timestamp = "1700000000"; type = "text"; text = @{ body = "halo" } })
   } }) }) } | ConvertTo-Json -Depth 8
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/webhook/whatsapp -Body $body -ContentType "application/json"
   ```
4. **Lolos bila:** response berisi `outcomes` dengan `action: replied` untuk nomor owner;
   ganti `from` ke nomor lain → `rejected_unknown_*`. (Balasan tidak benar-benar terkirim di mode mock.)

**C. Jalur produksi (WhatsApp Cloud API resmi):**
1. Set `.env`: `WA_ADAPTER=cloud`, `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_ACCESS_TOKEN`,
   `WA_CLOUD_VERIFY_TOKEN`, `WA_OWNER_NUMBERS`.
2. Ekspos server ke internet (mis. tunnel) → daftarkan webhook URL di Meta dengan verify token sama.
3. Verifikasi handshake: Meta `GET /webhook/whatsapp` → server balas `hub.challenge`.
4. Chat dari nomormu ke nomor perusahaan → balasan otomatis. Chat dari nomor lain → balasan default.

---

---

## Phase 1 — Platform Shell + Company Setup 🎮

Dunia 2D (Phaser) + Configuration layer data-driven (Company/Floor/Department/Character),
disimpan ke SQLite lewat REST, disinkronkan realtime (socket.io). Belum ada agent "hidup".

### Catatan teknis
- **DB:** `node:sqlite` (built-in Node ≥ 22) — **tanpa kompilasi native** (penting di Windows + Node terbaru).
  File default `data/vc.db` (di-`.gitignore`). Set `DB_PATH=:memory:` untuk non-persisten.
- **Web:** Vite 7 + React 18 + Phaser 3 (`apps/web`). Dev server mem-proxy `/api` & `/socket.io`
  ke orchestrator (`:8787`) → web pakai URL relatif, tak perlu CORS.

### Verifikasi cepat (logika, tanpa browser)
```bash
npm run build           # tsc backend (shared, agent-runtime, templates, server)
npm run typecheck:web   # tsc --noEmit web
npm run build:web       # vite build web (bundling)
npm test                # 43 test: + templates, db (persistensi), seed, configApi (inject)
npm run lint            # eslint seluruh repo (termasuk web)
```

### DoD Fase 1 — uji manual end-to-end (butuh 2 terminal)
1. Terminal A: `npm run dev:server`  → orchestrator di `http://127.0.0.1:8787` (REST `/api/*` + socket.io).
2. Terminal B: `npm run dev:web`     → buka `http://localhost:5173`.
3. Di browser:
   - Tab **Company** → isi nama (mis. *"PT Maju Jaya"*) → **Buat company** → **Tambah lantai**.
   - Tab **Departemen** → pilih lantai → sumber **Dari template** → *Pemasaran (Marketing)* → **Tambah departemen**
     (men-seed 5 karakter + workflow).
   - Tab **Kantor** → 5 karakter muncul di lantai. Klik satu karakter (terpilih), lalu klik petak lantai →
     karakter **berjalan** (menghindari dinding). Jam in-game berjalan di HUD.
   - Tab **Karakter** → edit/ buat `AgentProfile` (persona, skillScope, guardrails, meja, model tier) → tersimpan.
   - Tab **Task Board** / **Comms** → tampil placeholder bertanda jelas (terisi Phase 2/3).
4. **Reload** (refresh browser / restart server dengan `DB_PATH=data/vc.db`) → seluruh config (company,
   lantai, departemen, karakter) **tetap ada** (persisten di SQLite). **Lolos bila** semua langkah di atas jalan.

> Smoke test tanpa browser (REST + realtime): jalankan server lalu `POST /api/companies`,
> `POST /api/companies/:id/floors`, `POST /api/floors/:floorId/departments {"templateId":"tmpl-marketing"}`,
> `GET /api/companies/:id/world` (harus 5 agent), dan subscribe socket.io `world:subscribe` → terima `world:sync`.

---

## Phase 2 — Runtime + 1 Agent Nyata 🤖

Directive (UI) → buat `Task` → dispatch ke 1 agent → agent loop (via 9Router) → hasil jadi `Artifact`,
animasi status karakter via `agent:event`. Persistensi: MySQL.

### Catatan teknis
- **DB:** MySQL/MariaDB (`mysql2`). Store **async**. Skema dibuat saat start (`ConfigStore.init`).
- **Skill `write_content`:** menghasilkan konten nyata via 9Router (non-risky, tanpa approval).
- **Dispatch:** `POST /api/agents/:agentId/directives {"text":"…"}` balas **202** + `{directive, task}`;
  loop jalan di latar belakang (emit `agent:event`), hasil final disimpan jadi `Artifact`,
  status Task → `done` (atau `awaiting_approval`/`blocked`).

### Verifikasi cepat (logika, tanpa browser)
```bash
npm test    # 52 test — termasuk dispatch (mock 9Router), write_content, memory persist (MySQL)
```
> `tests/dispatch.test.ts` membuktikan alur directive→task→artifact + memory persisten + event status
> **tanpa** 9Router hidup (router di-mock). Butuh MySQL hidup.

### DoD Fase 2 — uji manual end-to-end (butuh 9Router hidup)
**Prasyarat:** MySQL (XAMPP) hidup, **9Router hidup** di `NINEROUTER_BASE_URL` dengan minimal satu model
(`NINEROUTER_MODEL_*`) yang mendukung chat. Tanpa 9Router, task akan jadi `blocked` (loop gagal di router).

1. Terminal A: `npm run dev:server` → orchestrator `http://127.0.0.1:8787`.
2. Terminal B: `npm run dev:web` → buka `http://localhost:5173`.
3. Buat company → tambah lantai → tambah departemen Marketing (template) → 5 karakter muncul.
4. Tab **Kantor** → panel **Beri Arahan**: pilih karakter (mis. *Script Maker*), ketik arahan
   (mis. *"Tulis caption promo diskon akhir pekan"*) → **Kirim arahan**.
5. **Lolos bila:** karakter **berdenyut** (status working) saat bekerja lalu kembali idle; di tab
   **Task Board** muncul task `Selesai` dengan tombol **Lihat konten** → menampilkan **konten asli AI**
   (via 9Router). Reload → task & konten tetap ada (persisten di MySQL).

> Smoke tanpa 9Router (hanya validasi pipeline): langkah 1–4 tetap membuat Directive+Task; task
> berakhir `blocked` (router mati). Buktikan REST: `POST /api/agents/:id/directives` balas 202 lalu
> `GET /api/companies/:id/tasks` menampilkan task tersebut.

---

## Phase 3 — Departemen Lengkap + Workflow Engine 🧩

Arahan ke **departemen** → Workflow Engine generik menjalankan pipeline `WorkflowDef`:
Manager → riset → tulis → review (loop revisi) → **approval gate (pause)** → publish. Approval
di-resume lewat UI (APPROVE/REVISI). Engine **data-driven** (tak ada cabang "marketing").

### Catatan teknis
- **Engine:** `apps/server/src/workflow/engine.ts`. Token `next`: `<id>` (lompat), `loop_until_pass`
  (review; REVISI → ulang step konten s/d `maxReviewRounds`=2; PASS → lanjut), `approval_gate`
  (pause, persist `WorkflowRun`), tanpa `next` (step akhir).
- **State:** tabel `workflow_runs` (status, currentStepId, stepArtifacts, approvalId, reviewRounds).
  Konteks antar-step direkonstruksi dari artifact (tahan resume).
- **Endpoint:** `POST /api/departments/:id/directives` (jalankan workflow, 202) ·
  `POST /api/approvals/:approvalId {decision:"approve"|"revise", note?}` (resume) ·
  `GET /api/companies/:id/runs`.
- **Skills baru:** `review_content` (verdict PASS/REVISI), `market_research`, `web_fetch` (mock).

### Verifikasi cepat (logika, tanpa 9Router)
```bash
npm test    # 57 test — termasuk tests/workflow.test.ts (pipeline, loop revisi, approval pause, resume)
```

### DoD Fase 3 — uji manual (butuh 9Router hidup)
1. `npm run dev:server` + `npm run dev:web`. Pastikan `.env` punya `NINEROUTER_MODEL_SUBSCRIPTION`
   (mis. `kr/claude-sonnet-4.5`) & 9Router hidup.
2. Buat company → lantai → departemen **Marketing** (template). Tab **Workflow** → pilih departemen,
   ketik arahan (mis. *"Buat caption IG promo diskon 30% akhir pekan, gaya santai"*) → **Jalankan workflow**.
3. **Lolos bila:** Task Board terisi pipeline (Manager→Market Checker→Script Maker→Reviewer→…→Manager),
   karakter beranimasi, lalu run **menunggu approval** (muncul di panel Workflow kanan).
4. Klik **APPROVE** → publish jalan → run & directive `done`. Konten final = **AI nyata** (lihat artifact
   di Task Board). Klik **REVISI** + alasan → pipeline mengulang dari step konten lalu minta approval lagi.

> **Terbukti LIVE (2026-06-13):** arahan caption diskon 30% → pipeline jalan via `kr/claude-sonnet-4.5`,
> review me-loop 2×, pause di approval, APPROVE → `done`, menghasilkan caption Instagram nyata.
> Smoke tanpa browser: `POST /api/departments/:id/directives` → poll `GET /api/companies/:id/runs`
> sampai `awaiting_approval` → `POST /api/approvals/:approvalId {"decision":"approve"}` → run `done`.

---

## Menjalankan Codex (review & bug hunt)

> Codex = **Reviewer & Bug Hunter** (lihat `AGENTS.md`). Ia membaca `AGENTS.md` otomatis;
> command di bawah mengarahkannya ke ringkasan tugas `infra/codex/REVIEW.md`.

**Prasyarat:** pasang Codex CLI sekali (global), mis.:
```bash
npm install -g @openai/codex     # lalu login: `codex login` (sekali)
codex --version                  # pastikan terpasang
```

**Jalankan review fase berjalan** (tulis temuan ke `docs/BUGLIST.md` & `docs/CODE_REVIEW.md`):
```bash
npm run review:codex      # review diff fase berjalan (bug hunt + kualitas + verifikasi FIXED)
npm run review:codex:all  # SWEEP MENYELURUH Phase 0–2 (seluruh kode, fokus migrasi MySQL + runtime)
npm run verify:codex      # khusus: verifikasi ulang entri BUGLIST berstatus FIXED
```

Atau **interaktif** (supaya bisa diawasi langkah demi langkah):
```bash
codex          # buka TUI, lalu ketik:
# "Baca dan ikuti AGENTS.md lalu infra/codex/REVIEW.md, kerjakan tugas review di sana."
```

**Catatan keamanan (penting):** command memakai sandbox `workspace-write` agar Codex bisa menulis
dua file laporan. Batas "READ-ONLY pada source, tulis hanya ke BUGLIST/CODE_REVIEW" ditegakkan lewat
instruksi `AGENTS.md`. Operator yang ingin penegakan teknis bisa menjalankan Codex di sandbox/whitelist
yang hanya mengizinkan tulis ke dua file itu (lihat catatan setup di `AGENTS.md` §1).

> Flag CLI bisa beda antar versi Codex; sesuaikan `-s/--sandbox` bila perlu. Bila perintah `codex`
> belum ada di PATH, `npm run review:codex` akan gagal dengan "command not found" — pasang dulu (di atas).

**Status review saat ini (2026-06-13):** Phase 0 ✅ & Phase 1 ✅ **sudah direview Codex** (review Phase 1
menghasilkan BUG-106..109 + CR-109; mayoritas FIXED & dibersihkan, tersisa `BUG-107`/`BUG-108` + `CR-101`
= keputusan strategi auth web/socket, **bukan** review tertunda). Yang **belum** direview: **Phase 2**
(runtime/dispatch/animasi) + **migrasi DB ke MySQL (store async)** yang menyentuh kode Phase 0–1.
Karena migrasi lintas-fase itu, review berikutnya = **sweep menyeluruh Phase 0–2**: `npm run review:codex:all`
(fokus utama Phase 2 + migrasi MySQL, sekalian cek regresi async di kode lama). Jalankan sweep untuk temuan baru
(dialek SQL MySQL, async/await store, dispatch directive, event animasi).

---

## Struktur perintah workspace

```bash
npm run -w @vc/shared build
npm run -w @vc/agent-runtime build
npm run -w @vc/server dev          # start orchestrator (tsx, hot) — REST + socket.io
npm run dev:web                     # start web (Vite) di :5173
npm run dev:server                  # alias start orchestrator
npm run lint                        # eslint (termasuk apps/web)
```

## Keamanan (selalu)
- **Jangan** commit `.env` atau kredensial apa pun (sudah diblokir `.gitignore`).
- Token WhatsApp & API key hanya lewat env/Vault (Vault asli di Phase 4).
