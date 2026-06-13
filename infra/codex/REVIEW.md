# Codex — Tugas Review (dipakai oleh `npm run review:codex`)

> Codex sudah membaca `AGENTS.md` otomatis (peran, batas wewenang, verifikasi 2x, template).
> File ini = **ringkasan tugas + cakupan + output** agar pemanggilan via command konsisten.
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

## Aturan keras (ulangi dari AGENTS.md)
- **READ-ONLY pada source code.** Tulis HANYA ke `docs/BUGLIST.md` & `docs/CODE_REVIEW.md`.
- Tiap entri bug WAJIB lolos **verifikasi 2x** (baca kode + sudut berbeda). Ragu → jangan masuk BUGLIST.
- Selalu tunjuk `file:line` nyata. Jangan mengarang lokasi.

## Langkah

### 1. Tentukan cakupan review
```bash
git log --oneline -15
# diff fase berjalan (sejak commit terakhir yang sudah direview), mis.:
git diff <commit-terakhir-direview>..HEAD
# atau diff 1 commit terakhir:
git diff HEAD~1 HEAD
```
Default: tinjau commit fase terbaru + working tree bila ada perubahan belum di-commit.

### 2. Bug hunt → `docs/BUGLIST.md`
Untuk tiap dugaan bug, jalankan verifikasi 2x lalu tulis entri (template AGENTS.md §6) dengan
bukti `file:line`, dampak, dan solusi konkret untuk Claude.

### 3. Temuan kualitas → `docs/CODE_REVIEW.md`
Optimal/clean/duplikasi/over-engineering/konsistensi kontrak/biaya (template §7).

### 4. VERIFIKASI entri berstatus FIXED
Untuk tiap entri `BUGLIST` ber-status `FIXED`, baca kode terbaru di lokasinya:
- akar masalah benar hilang (bukan gejala) & tak ada regresi → set **`VERIFIED_FIXED`** + catatan bukti.
- belum/half beres → **`REOPENED`** + bukti baru + solusi dipertajam.

> **Status saat ini (Phase 1):** `BUG-101..105` berstatus **FIXED** (di-fix Claude saat self-review karena
> Codex belum tersedia) — **butuh verifikasi independen kamu**. `CR-101..108` berstatus `OPEN` (tinjau & prioritaskan).
> BUG-101 (Phaser boot) sebaiknya diverifikasi di browser (`npm run dev:server` + `npm run dev:web`).

## Fokus khusus Phase 1 (AGENTS.md §8)
- Konsistensi kontrak `@vc/shared` ↔ mapping DB (`apps/server/src/db/store.ts`).
- Engine **data-driven**: tak ada hardcode "marketing" di `apps/server` (hanya DATA di `packages/templates`).
- Validasi input REST (`apps/server/src/api/routes.ts`); CORS/secrets; **owner-auth absen di REST** (lihat CR-101).
- DB round-trip; clone workflow di seed; boot/lifecycle Phaser (`apps/web/src/game`).

---

## Sweep menyeluruh Phase 0–3 (`npm run review:codex:all`)

> **Tambahan Phase 3 (Workflow Engine):** tinjau juga `apps/server/src/workflow/engine.ts` + `apps/server/src/db` (tabel `workflow_runs`) + endpoint directive-departemen/approval (`apps/server/src/api/routes.ts`) + `apps/web/src/components/WorkflowPanel.tsx`. Fokus: engine **data-driven** (token `loop_until_pass`/`approval_gate`, TANPA cabang "marketing"); approval gate **tak bisa di-bypass** (run `awaiting_approval` benar-benar pause; resume hanya lewat `resumeByApproval`); `maxReviewRounds` mencegah loop revisi tak henti; konteks antar-step direkonstruksi dari `stepArtifacts` (resume aman); semua LLM lewat router; tak ada panggilan LLM per-tick. Verifikasi observasi: `tests/workflow.test.ts` + `npm test` (57 passed).


> **Kenapa sweep penuh sekarang:** ada perubahan **lintas-fase** besar — (a) persistensi pindah dari
> `node:sqlite` (sinkron) ke **MySQL/MariaDB via `mysql2`** (store **async**); (b) runtime baru:
> directive → task → agent → artifact + animasi event. **Phase 0 & Phase 1 sudah pernah direview Codex**
> (Phase 1 → BUG-107/108/CR-101 tersisa = keputusan auth). Tetapi migrasi DB menyentuh kode lama, jadi
> tinjau **seluruh kode Phase 0–2** untuk cek regresi async — **fokus utama: Phase 2 + migrasi MySQL**.

**Cakupan (baca penuh):**
`packages/shared` (kontrak), `packages/agent-runtime` (loop, skills `webSearch`/`writeContent`, memory, router),
`packages/templates` (marketing = data), `apps/server` (`db/store.ts`+`schema.ts`+`memoryStore.ts`,
`api/routes.ts`, `registry/dispatcher.ts`, `realtime.ts`, `server.ts`, `main.ts`, `comms/*`),
`apps/web` (`game/OfficeScene.ts`, `components/{DirectiveComposer,TaskBoard,WorldView}.tsx`, `App.tsx`, `api.ts`, `socket.ts`).

**Fokus verifikasi 2x (utamakan):**
1. **Dialek & korrektnes MySQL** (`db/schema.ts`, `db/store.ts`): SQL injection (pastikan hanya
   konstanta internal yang diinterpolasi di `childIdsByParent`, sisanya placeholder `?`); reserved word
   (`text` di-backtick di INSERT directives/memory); round-trip tipe (BIGINT epoch ms → `Number`,
   DOUBLE importance, LONGTEXT JSON `JSON.parse`); FK `ON DELETE CASCADE` (companies→floors→departments→agents,
   directives, tasks, artifacts); upsert `ON DUPLICATE KEY UPDATE` workflows; `?? null` (bukan `undefined`) ke `execute`.
2. **Regresi async-ifikasi**: setiap pemanggil store kini `await` (routes/seed/realtime/dispatcher/main);
   `onMutate` fire-and-forget `broadcastWorld` (race?); subscribe socket async snapshot (urutan emit?);
   tak ada Promise yang lupa di-`await` / unhandled rejection.
3. **Dispatch (`registry/dispatcher.ts`)**: directive→task→artifact benar; transisi status
   (`done`/`awaiting_approval`/`blocked`); ack 202 TIDAK menunggu loop (background); error router → task `blocked`
   (tak nyangkut `in_progress`); memory tersimpan; tak ada kebocoran lintas-company; concurrency directive ke 1 agent.
4. **Semua LLM lewat router** (`writeContent` & loop) — flag panggilan provider langsung. `write_content` non-risky benar.
5. **Animasi (2.4)**: TIDAK ada panggilan LLM per-tick/per-render; murni event-driven; status live tak ditimpa snapshot.
6. **Carryover Phase 0/1**: engine data-driven (tak ada hardcode "marketing" di server), validasi input REST
   (endpoint directive baru), approval gate tak bisa di-bypass, owner-auth, secrets/CORS.
7. **Re-evaluasi entri terbuka**: `BUG-107`/`BUG-108` (auth web/socket) & `CR-101` — masih valid pasca-migrasi?

**Observasi (bukti verifikasi #2):** `npm test` (butuh MySQL hidup; DB test `virtual_company_test`),
`npm run build`, `npm run lint`, `npm run typecheck:web`. Smoke server: lihat `docs/RUNBOOK.md` (Phase 2).

---

## Fokus review Phase 4 (aksi eksternal + keamanan) — untuk 4.5

> Cakupan tambahan: `apps/server/src/security/{vault,guardrails,auth}.ts`, `apps/server/src/db/{schema,store}.ts`
> (tabel `approvals`/`audit_entries` + method baru), `apps/server/src/workflow/engine.ts` (publish segment +
> `makeGuardedApproval` + persist approval), `packages/agent-runtime/src/skills/{socialPost,playwrightPublisher}.ts`,
> `packages/shared/src/skill.ts` (`AuditDraft`/`SkillContext.audit`), `apps/web/src/{api,socket}.ts`, `apps/server/src/realtime.ts`.

**Fokus verifikasi 2x (utamakan keamanan):**
1. **Vault**: nilai secret TIDAK pernah masuk log/prompt/audit `detail`; file `data/vault.enc` benar-benar
   terenkripsi (bukan plaintext); master key salah → gagal (auth tag). Cek `summarizeArgs`/audit tak membocorkan kredensial.
2. **Approval gate tak bisa di-bypass**: skill `risky` HANYA eksekusi di segmen pasca-`approval_gate`
   (`grantApprovalId`); tanpa grant → default-deny (blocked). Tak ada jalur publish yang lewat tanpa approval.
3. **Guardrails benar**: rate_limit menghitung audit 24 jam (action publish), posting_hours jam lokal
   (termasuk lewat tengah malam); gagal guardrail → run `blocked` + audit `publish_blocked` (tak diam-diam terbit).
4. **Least-privilege Playwright**: domain allowlist menahan navigasi luar; kredensial dari Vault; lazy-import aman.
5. **Audit lengkap**: setiap aksi eksternal + keputusan approval tercatat (`approval_requested`/`approval_decided`/
   `publish_authorized`/`publish_blocked`/`<skill>`); scoping per company benar.
6. **Auth boundary (BUG-107/108/CR-101)**: REST + Socket pakai helper sama; web kirim token di kedua jalur;
   socket tanpa token ditolak saat token aktif; perbandingan waktu-konstan.

**Observasi:** `npm test` **87 passed** (`tests/{vault,social,guardrails,audit,publish,auth}.test.ts`), build/lint/typecheck:web/build:web hijau.

---

## Fokus review Phase 5 (generalisasi platform) — untuk 5.6 (`npm run review:codex:p5`)

> Cakupan tambahan: `packages/templates/src/sales.ts`, `packages/agent-runtime/src/skills/sendOutreach.ts`,
> `apps/server/src/kpi/{kpi,recordUsage}.ts`, `apps/server/src/config/costRates.ts`,
> `packages/agent-runtime/src/loop.ts` (akumulasi `usage`), `packages/agent-runtime/src/router/{throttle,nineRouter}.ts`
> (throttle + tier cooldown), `apps/server/src/db/{schema,store}.ts` (`usage_events`), `apps/server/src/api/routes.ts`
> (`GET /api/companies/:id/kpi`), `apps/web/src/game/{OfficeScene,maps}.ts` (multi-floor), `apps/web/src/components/KpiDashboard.tsx`.

**Fokus verifikasi 2x:**
1. **Engine tetap data-driven (KRITIS):** tak ada hardcode "sales"/"marketing" di `apps/server/src/workflow/engine.ts`;
   Sales jalan via `WorkflowDef` (token `loop_until_pass`/`approval_gate` sama). **Nol regresi Marketing** saat ada dept ke-2.
2. **`send_outreach`** `risky` → approval-gated; channel di luar allowlist DITOLAK (tak diam-diam jadi email);
   provider `ok:false`/throw → audit `send_outreach_failed` + run `blocked` (bukan `done`); audit tanpa secret.
   **VERIFIKASI entri FIXED: BUG-116 & BUG-117** → set `VERIFIED_FIXED` atau `REOPENED` dgn bukti.
3. **KPI biaya benar:** token dari `usage_events` (nyata, dari 9Router `usage`); agregasi per company/dept/tier/hari
   konsisten; biaya = token × tarif per-tier (`COST_*`, subscription default 0); atribusi audit→dept benar;
   `computeKpi` HANYA baca DB (tak ada panggilan LLM saat render KPI).
4. **Pencatatan usage:** dispatcher & engine merekam usage tiap loop tanpa menggagalkan kerja (fire-and-forget
   aman); tak ada double-count; loop yang gagal tak menulis usage palsu.
5. **Optimasi router:** throttle FIFO tak mengubah hasil & tak deadlock; tier cooldown tak pernah mengosongkan
   seluruh kandidat (fallback tetap jalan); default tetap aman.
6. **Multi-floor:** swap map runtime mem-`destroy` layer/tilemap lama (tak bocor); grid pathfinding dibangun ulang;
   `mapKey` tak dikenal → fallback default; karakter difilter per lantai.
7. **VERIFIKASI CR-110** (throttle escape-hatch, `ADDRESSED`) → `VERIFIED` atau beri temuan.

**Observasi:** `npm test` **104 passed** (`tests/{sales,throttle,kpi,loop}.test.ts` dll), build/lint/typecheck:web/build:web hijau.
Catatan infra: tiap FILE test kini pakai database sendiri (`virtual_company_test_<file>`) — bukan bug, perbaikan flakiness.

---

## Fokus review Phase 6 (app packaging) — untuk 6.4 (`npm run review:codex:p6`)

> **Konteks penting:** Rust/Cargo + MSVC **belum terpasang** di mesin ini → kamu **tidak bisa**
> menjalankan `cargo build`, `tauri dev`, atau `tauri build`. Review kode Rust = **analisis baca-kode
> (read-only)**; tandai temuan yang baru bisa dikonfirmasi setelah build sebagai catatan untuk owner.
> Tak ada entri BUGLIST Phase 6 berstatus `FIXED` saat ini (belum ada siklus fix) — fokus = bug hunt baru.

> **Cakupan:** `apps/desktop/src-tauri/src/{lib,service,main}.rs`, `apps/desktop/src-tauri/{tauri.conf.json,Cargo.toml,build.rs,capabilities/default.json}`,
> `apps/desktop/package.json`, `apps/desktop/README.md`, `apps/web/src/{api,socket,desktop}.ts`,
> `apps/web/src/components/ServiceStatus.tsx`, `apps/web/src/App.tsx`, `apps/web/src/game/bootGame.ts`,
> `apps/web/src/styles.css`, `apps/web/src/vite-env.d.ts`, `apps/web/.env.desktop`, root `package.json`
> (scripts `dev:desktop`/`build:desktop`/`build:web:desktop`), `.gitignore`, `.env.example`.

**Fokus verifikasi 2x:**
1. **Rust shell (`service.rs`/`lib.rs`, baca-kode):** spawn `node <entry>` aman — path entry berasal dari
   env/resource/penelusuran filesystem (**bukan input user**) → flag bila ada jalur injeksi command/arg.
   Proses anak orchestrator **di-kill** saat window `Destroyed` **dan** lewat `Drop` → cek potensi
   **orphan** bila app crash. **TOCTOU** `port_open` sebelum spawn (dua instance → spawn dobel?).
   Resolusi `resource_dir()`/`entry.ancestors().nth(4)` benar (root repo). Tak ada `panic`/`unwrap`
   di jalur normal selain `lock().expect` (boleh). `cwd` server = root repo (temukan `.env`/`data/`/node_modules).
2. **Keamanan packaging (AGENTS.md §8):** CSP `connect-src` **least-privilege** (hanya loopback
   `:8787`/`:20128`, TANPA wildcard `*`); `script-src 'self'` (tak ada remote script). `withGlobalTauri:true`
   hanya mengekspos command `service_status`/`restart_server` ke **bundle lokal tepercaya** (`frontendDist`)
   — bukan konten remote. `restart_server` tak bisa disalahgunakan. **Desktop TIDAK mem-bypass auth**:
   web tetap kirim `VITE_API_AUTH_TOKEN` (= `API_AUTH_TOKEN`). `.env.desktop` **bukan secret** (hanya
   alamat loopback) & benar di-commit (pengecualian `.gitignore`); env yang di-inherit proses node tak di-log.
3. **NOL REGRESI browser (KRITIS):** saat `VITE_API_BASE_URL` kosong (default browser/dev), `api.ts`
   `BASE` = `"/api"` & `socket.ts` `io(opts)` **persis** perilaku lama (URL relatif, proxy Vite) →
   buktikan tak ada perubahan jalur same-origin. `SERVER_URL` strip trailing-slash benar. Auth header
   tetap terkirim di kedua jalur.
4. **Deteksi Tauri no-op aman di browser:** `desktop.ts` tak crash bila `window.__TAURI__` absen
   (return null/false); `ServiceStatus` render `null` di browser (tak polling/tak error tiap interval).
5. **Responsif (6.2):** Phaser mode **FIT** (`bootGame.ts`) tak merusak pemetaan koordinat
   klik-untuk-berjalan (Scale Manager memetakan pointer ke resolusi dasar) — **verifikasi di browser**;
   media queries `styles.css` tak menyembunyikan kontrol penting di layar sempit.
6. **Build mode desktop:** `build:web:desktop` (`--mode desktop`) memuat `apps/web/.env.desktop` →
   base URL absolut **ter-embed**; tak bocor ke `build:web` (browser) biasa.
7. **Nol regresi fungsional:** runtime/engine/skills tak tersentuh (perubahan hanya web-shell + scaffold).

**Observasi (bukti verifikasi #2):** `npm run build` + `typecheck:web` + `lint` + `build:web` +
`build:web:desktop` (cek `127.0.0.1:8787` ter-embed di `apps/web/dist`) + `npm test` (**104**, butuh MySQL hidup)
+ `npm run tauri -- info` (validasi config + lapor toolchain: Rust/MSVC kurang, WebView2 ada).
Smoke browser & desktop: lihat `docs/RUNBOOK.md` (Phase 6).
