# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED_FIXED` umumnya dihapus dari daftar aktif setelah dicek ulang; entri verified yang masih tertulis dipertahankan sebagai bukti verifikasi terbaru.
> **Catatan sweep Phase 0-3 2026-06-13:** `packages/shared`, `packages/agent-runtime`, `packages/templates`, `apps/server`, dan `apps/web` direview ulang, dengan fokus tambahan `WorkflowEngine`, `workflow_runs`, approval gate, dan `WorkflowPanel`. Gate observasi terbaru: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (59 passed). `BUG-112/113` sudah diverifikasi beres oleh Codex dan dihapus dari daftar aktif.
> **Catatan Phase 4 2026-06-13:** review keamanan Phase 4 (vault, guardrails, auth, audit, skill sosial) selesai. Gate: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` **87 passed**. `BUG-107/108` -> `VERIFIED_FIXED`; temuan baru: `BUG-114/115` `OPEN`.
> **Update Claude 2026-06-13 (fix BUG-114/115):** kedua temuan Codex di-FIX (status `FIXED`, menunggu verifikasi Codex). BUG-114: skill `risky` gagal → run `blocked` + audit `*_failed` (engine `runStep` + `socialPost`). BUG-115: `CharacterEditor` pertahankan `params` guardrail + validasi server PATCH/POST agent (`rate_limit`/`posting_hours` wajib params, else 400). Gate ulang: `npm test` **89 passed** (+ `publish.test.ts` failure case, `configApi.test.ts` guardrail validation), build/lint/typecheck:web hijau.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | VERIFIED_FIXED | `apps/web/src/api.ts`, `apps/server/src/server.ts` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | VERIFIED_FIXED | `apps/server/src/realtime.ts`, `apps/server/src/security/auth.ts` |
| BUG-114 | Gagal publish eksternal pasca-approval bisa berakhir `done` tanpa audit kegagalan | high | FIXED | `apps/server/src/workflow/engine.ts`, `packages/agent-runtime/src/skills/socialPost.ts` |
| BUG-115 | Edit agent di UI menghapus parameter guardrail sehingga `rate_limit` tidak aktif | high | FIXED | `apps/web/src/components/CharacterEditor.tsx`, `apps/server/src/api/routes.ts` |

---

## Entri

### BUG-107 - `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer

- **Status:** VERIFIED_FIXED
- **Severity:** high
- **Category:** runtime
- **Location:** `apps/web/src/api.ts:48`, `apps/server/src/server.ts:63`, `apps/server/src/main.ts:157`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Server sudah mendukung `API_AUTH_TOKEN` dan bahkan mewajibkannya saat bind non-loopback, tetapi klien web bawaan tidak punya mekanisme untuk mengirim `Authorization: Bearer <token>`. Akibatnya mode deployment yang aman membuat UI resmi gagal memanggil semua endpoint `/api/*`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:60`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/main.ts:143-148`):
  ```ts
  const apiAuthToken = env.API_AUTH_TOKEN?.trim() || undefined;
  if (!apiAuthToken && !isLoopbackHost(host)) {
    throw new Error(
      `Server bind ke host non-loopback '${host}' tanpa API_AUTH_TOKEN. ` +
        "REST /api/* akan terbuka tanpa auth. Set API_AUTH_TOKEN di .env sebelum expose ke jaringan.",
  ```
- Kutipan kode (`apps/web/src/api.ts:40-41`):
  ```ts
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
  ```
- Kontrak env (`.env.example:55-58`) menyatakan klien harus mengirim `Authorization: Bearer <token>`, tetapi tidak ada `VITE_*`/config/token path di `apps/web`.
- Observasi: `buildServer({ apiAuthToken: "secret" })` mengembalikan `{"noAuth":401,"auth":200}` untuk `GET /api/companies`; request tanpa header sama dengan perilaku `api.ts`.

**Dampak**
Begitu operator mengikuti instruksi aman untuk hosting non-lokal (`API_AUTH_TOKEN` wajib), web app tidak bisa memuat company/template/world/CRUD karena semua request REST dikirim tanpa bearer. Ini memblokir Phase 1 UI pada mode aman.

**Verifikasi #1 (pembacaan kode)**
Server menolak `/api/*` tanpa bearer saat `apiAuthToken` diset, sementara `apps/web/src/api.ts` hanya mengirim `content-type` untuk semua request dan tidak membaca konfigurasi token apa pun.

**Verifikasi #2 (observasi runtime)**
Fastify inject pada server in-memory dengan `apiAuthToken: "secret"` menunjukkan request tanpa `Authorization` mendapat 401, sedangkan request dengan `Authorization: Bearer secret` mendapat 200.

**Solusi yang diusulkan (untuk Claude)**
1. Tentukan strategi auth web resmi: token dev via `VITE_API_AUTH_TOKEN`, reverse-proxy yang menyuntik header, atau session/login ringan.
2. Implementasikan satu jalur eksplisit di `apps/web/src/api.ts` untuk menyertakan bearer ketika mode token aktif.
3. Update `.env.example` dan `docs/RUNBOOK.md` agar operator tahu cara web client mendapat token.
4. Tambahkan test untuk `buildServer({ apiAuthToken })` dan dokumentasikan smoke test web dengan token.

**Catatan Claude 2026-06-11 - DITUNDA (butuh keputusan).**
Solusi #1 menuntut pilihan strategi auth web (token build-time `VITE_API_AUTH_TOKEN` yang ter-embed di bundle vs reverse-proxy yang menyuntik header vs login ringan) - trade-off keamanan yang harus diputuskan owner, bukan default sepihak. Dikerjakan bersama `BUG-108` (auth socket) sebagai satu boundary auth (lihat CR-101). Status tetap `OPEN` sampai strategi dipilih.

**Perbaikan Claude 2026-06-13 (FIXED — Phase 4).**
Owner memilih strategi **token dev build-time** (`VITE_API_AUTH_TOKEN`). Diterapkan:
1. `apps/web/src/api.ts` — baca `import.meta.env.VITE_API_AUTH_TOKEN`; bila ada, sisipkan `Authorization: Bearer <token>` di SEMUA request `/api/*` (helper `authHeaders()`); token diekspor (`AUTH_TOKEN`) agar dipakai socket juga.
2. `apps/web/src/vite-env.d.ts` — tipe `ImportMetaEnv.VITE_API_AUTH_TOKEN`.
3. `.env.example` — dokumentasi `VITE_API_AUTH_TOKEN` + catatan keamanan (token ter-embed di bundle → dev/token bersama; produksi pakai reverse-proxy/login).
4. Helper validasi dipindah ke `apps/server/src/security/auth.ts` (dipakai bersama REST + socket — CR-101).

**Catatan verifikasi perbaikan (Codex 2026-06-13)**
`VERIFIED_FIXED`.

Verifikasi #1 (pembacaan kode): `apps/web/src/api.ts:48-58` membaca `VITE_API_AUTH_TOKEN` dan menyisipkan `Authorization: Bearer <token>` via `authHeaders()` ke semua request REST; `apps/server/src/server.ts:63` tetap menolak `/api/*` tanpa bearer valid; helper shared `apps/server/src/security/auth.ts:19-23` memvalidasi format `Bearer`.

Verifikasi #2 (observasi/test): `tests/auth.test.ts:19-23` menutup validasi helper bearer, dan gate 2026-06-13 hijau: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` (**87 passed**). Akar masalah lama (web tidak pernah mengirim bearer) sudah hilang.

---

### BUG-108 - Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token

- **Status:** VERIFIED_FIXED
- **Severity:** high
- **Category:** security
- **Location:** `apps/server/src/realtime.ts:37`, `apps/server/src/security/auth.ts:30`, `apps/web/src/socket.ts:37`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Bearer auth hanya diterapkan pada URL yang diawali `/api/`. Socket.IO `/socket.io` tidak dicek token, dan `RealtimeHub` langsung menerima `world:subscribe` lalu mengirim snapshot company. Jadi saat REST sudah dilindungi token, world snapshot masih bisa diambil lewat socket tanpa auth bila penyerang mengetahui `companyId`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:60`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/realtime.ts:33-44`):
  ```ts
  socket.on("world:subscribe", (companyId: Id) => {
    const target = room(companyId);
    const stale = [...socket.rooms].filter((r) => r.startsWith("company:") && r !== target);
    for (const r of stale) void socket.leave(r);
    void socket.join(target);
    void this.store
      .getWorldSnapshot(companyId)
      .then((snap) => {
        if (snap) socket.emit("world:sync", snap);
      })
  });
  ```
- Kutipan kode (`apps/web/src/socket.ts:33`, `apps/web/src/socket.ts:37`):
  ```ts
  const socket: WorldSocket = io({ autoConnect: true });
  ...
  socket.emit("world:subscribe", companyId);
  ```
- Observasi: server in-memory dengan `apiAuthToken: "secret"` + `RealtimeHub` menerima socket tanpa token dan mengirim `{"company":"A","agents":1}` setelah `world:subscribe`.
- Alasan ini bug: proteksi REST tidak menutup channel realtime yang membawa data company yang sama (`WorldSnapshot` berisi company, floors, departments, agents).

**Dampak**
Mode hosting aman masih punya jalur baca tanpa auth untuk snapshot konfigurasi perusahaan. Ini membocorkan nama company, struktur lantai/departemen, dan profil agent ke client yang bisa menebak/memperoleh `companyId`.

**Verifikasi #1 (pembacaan kode)**
Auth hook di `server.ts` hanya memeriksa `/api/`, sedangkan `RealtimeHub` tidak menerima token, tidak memasang middleware Socket.IO, dan tidak memvalidasi handshake sebelum mengirim `world:sync`.

**Verifikasi #2 (observasi runtime)**
Script Node lokal membuat server dengan `apiAuthToken`, attach `RealtimeHub`, lalu connect via `socket.io-client` tanpa `auth`/header. Setelah emit `world:subscribe`, client tetap menerima snapshot.

**Solusi yang diusulkan (untuk Claude)**
1. Teruskan `apiAuthToken` ke `RealtimeHub`.
2. Tambahkan Socket.IO middleware (`io.use`) yang memvalidasi token dari `socket.handshake.auth.token` atau header `Authorization`.
3. Update `apps/web/src/socket.ts` agar mengirim token dengan mekanisme yang sama seperti REST.
4. Tambahkan test realtime: tanpa token tidak menerima `world:sync`; token valid berhasil subscribe.

**Catatan Claude 2026-06-11 - DITUNDA (butuh keputusan).**
Tergantung strategi auth web yang sama dengan `BUG-107` (token diteruskan ke `RealtimeHub` via `io.use` + `socket.handshake.auth.token`). Test realtime juga butuh `socket.io-client` di root (kini hanya ada di `apps/web`). Status tetap `OPEN` sampai strategi auth dipilih; akan dikerjakan satu paket dengan `BUG-107` + CR-101.

**Perbaikan Claude 2026-06-13 (FIXED — Phase 4).**
1. `RealtimeHub` (`apps/server/src/realtime.ts`) menerima `apiAuthToken`; bila di-set, pasang `io.use` middleware yang memvalidasi `socket.handshake.auth.token` ATAU header `Authorization` SEBELUM `connection` (snapshot tak akan terkirim ke socket tak terotentikasi).
2. `apps/server/src/main.ts` meneruskan `apiAuthToken` ke `RealtimeHub`.
3. `apps/web/src/socket.ts` mengirim `auth: { token }` (sama dengan REST bearer) saat token ada.
4. Validasi dibagi pakai helper `apps/server/src/security/auth.ts` (`hasValidSocketToken`) — satu boundary dengan REST (CR-101).
5. `socket.io-client` dapat di-resolve dari root (hoisted) → test realtime memungkinkan.

**Catatan verifikasi perbaikan (Codex 2026-06-13)**
`VERIFIED_FIXED`.

Verifikasi #1 (pembacaan kode): `apps/server/src/realtime.ts:37-46` memasang `io.use` ketika `apiAuthToken` ada dan menolak socket tanpa token sebelum event `world:subscribe`; `apps/server/src/security/auth.ts:30-36` menerima token dari `handshake.auth.token` atau header `Authorization`; `apps/web/src/socket.ts:37` mengirim `auth: { token: AUTH_TOKEN }` dari sumber yang sama dengan REST.

Verifikasi #2 (observasi/test): `tests/auth.test.ts:66-83` membuktikan socket tanpa token ditolak (`connect_error`) dan socket dengan token valid connect; `npm test` 2026-06-13 lulus **87 passed**. Jalur bocor `world:sync` tanpa auth saat REST token aktif sudah tertutup.

---

### BUG-114 - Gagal publish eksternal pasca-approval bisa berakhir `done` tanpa audit kegagalan

- **Status:** FIXED
- **Severity:** high
- **Category:** logic / security / runtime
- **Location:** `packages/agent-runtime/src/loop.ts:284`, `apps/server/src/workflow/engine.ts:325`, `packages/agent-runtime/src/skills/socialPost.ts:135`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
Setelah owner meng-approve aksi publish, kegagalan nyata dari skill sosial (mis. kredensial vault kurang, Playwright gagal, selector/platform berubah, network error) diubah menjadi tool message `ERROR`. Jika model kemudian menjawab final text, `WorkflowEngine` menandai task/run/directive sebagai `done`, bukan `blocked`, dan tidak ada audit kegagalan publish.

**Bukti**
- Kutipan kode (`packages/agent-runtime/src/loop.ts:284-287`):
  ```ts
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "skill_end", agentId: agent.id, at: now(), skill: name, ok: false, summary: msg });
    return errorOutcome(call, `Eror menjalankan "${name}": ${msg}`);
  ```
- Kutipan kode (`packages/agent-runtime/src/loop.ts:291-295`):
  ```ts
  function errorOutcome(call: ToolCall, message: string): ToolCallOutcome {
    return {
      run: { skill: call.function.name, ok: false, error: message },
      toolMessage: toolMsg(call, `ERROR: ${message}`),
  ```
- Kutipan kode (`apps/server/src/workflow/engine.ts:325-327`):
  ```ts
  const taskStatus = status === "blocked" ? "blocked" : "done";
  const doneTask =
    (await store.updateTask(task.id, { status: taskStatus, outputRef: artifact.id })) ?? task;
  ```
- Kutipan kode (`packages/agent-runtime/src/skills/socialPost.ts:135-141`):
  ```ts
  const result = await publisher.publish(req, {
    vault: ctx.vault,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });

  // Audit aksi eksternal (§4.3): preview + hasil (TANPA secret).
  await ctx.audit?.({
  ```
- Observasi runtime:
  ```json
  {"pausedStatus":"awaiting_approval","resumedStatus":"done","directiveStatus":"done","audit":["approval_requested","approval_decided","publish_authorized"]}
  ```
- Alasan ini bug: `publish_authorized` tercatat, tetapi publish tidak berhasil dan tidak ada `schedule_post`/audit failure; status akhir tetap `done`.

**Dampak**
Owner bisa melihat workflow/directive selesai padahal aksi eksternal tidak terjadi. Pada mode Playwright nyata, kegagalan kredensial/DOM/network dapat hilang sebagai percakapan model, membuat audit eksternal tidak akurat dan berisiko memicu keputusan operasional salah.

**Verifikasi #1 (pembacaan kode)**
`handleToolCall` menangkap exception skill dan mengembalikan `errorOutcome` tanpa `blockedApproval`; `runAgentLoop` hanya berhenti sebagai `blocked` jika ada `blockedApproval`; `WorkflowEngine` memetakan semua status selain `blocked` menjadi `done`. Karena audit di `socialPost` baru dipanggil setelah `publisher.publish` sukses, kegagalan publisher juga tidak mencatat audit gagal.

**Verifikasi #2 (sudut berbeda)**
Probe runtime memakai workflow publish nyata, approval nyata, dan publisher injeksi yang throw. Hasilnya run/directive `done` dengan audit hanya `approval_requested`, `approval_decided`, `publish_authorized`. Test yang ada (`tests/publish.test.ts:88` dan `tests/publish.test.ts:123`) hanya menutup happy-path dry-run dan guardrail block, belum menutup failure publisher pasca-approval.

**Solusi yang diusulkan (untuk Claude)**
1. Jadikan failure tool berisiko/eksternal sebagai status terminal `blocked` (mis. `runAgentLoop` membawa `toolRuns` gagal ke `AgentLoopResult.status = "blocked"` atau `WorkflowEngine` memblokir bila ada `ToolRun.ok === false` untuk skill risky).
2. Catat audit gagal sebelum error keluar dari skill sosial, mis. `action: "publish_failed"` atau `"<skill>_failed"` berisi preview, platform, dan reason non-secret.
3. Tambahkan test: publisher throw setelah approval -> task/run/directive `blocked`, audit failure tercatat, dan tidak ada status `done`.

**Perbaikan Claude 2026-06-13 (FIXED).**
1. `apps/server/src/workflow/engine.ts` (`runStep`): setelah loop, bila ada `ToolRun` GAGAL untuk skill `risky` (`skills.get(t.skill)?.risky === true`) → paksa `status = "blocked"` (kecuali sudah blocked). Konsekuensi: `runFrom` memanggil `blockRun` → task/run/directive `blocked`, BUKAN `done`.
2. `packages/agent-runtime/src/skills/socialPost.ts`: bungkus `publisher.publish` dengan try/catch — saat gagal, audit `\`${name}_failed\`` (`{ platform, preview, reason }`, reason non-secret) lalu rethrow. Jadi kegagalan SELALU ter-audit sebelum keluar.
3. Test `tests/publish.test.ts` ("BUG-114: publisher GAGAL pasca-approval → run blocked + audit *_failed"): publisher throw → `resumed.status === "blocked"`, directive `blocked`, audit memuat `publish_authorized` + `schedule_post_failed`, TANPA `schedule_post` (tak ada sukses palsu).

**Catatan verifikasi perbaikan**
Menunggu verifikasi Codex. Bukti sementara: `tests/publish.test.ts` (3 kasus: dry-run sukses, guardrail block, failure block) + `npm test` **89 passed**, build/lint/typecheck:web hijau.

---

### BUG-115 - Edit agent di UI menghapus parameter guardrail sehingga `rate_limit` tidak aktif

- **Status:** FIXED
- **Severity:** high
- **Category:** security / logic
- **Location:** `apps/web/src/components/CharacterEditor.tsx:96`, `apps/web/src/components/CharacterEditor.tsx:116`, `apps/server/src/security/guardrails.ts:57`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
`CharacterEditor` mengubah guardrail agent menjadi textarea berisi nama rule saja. Saat disimpan, UI mengirim ulang guardrail sebagai `{ rule }` tanpa `params`. Untuk agent Social Media, default template punya `rate_limit` dengan `params.maxPostsPerDay = 5`; setelah edit/save biasa, parameter itu hilang dan `checkRateLimit` menganggap guardrail tidak punya batas.

**Bukti**
- Kutipan kode (`apps/web/src/components/CharacterEditor.tsx:96`):
  ```tsx
  guardrails: a.guardrails.map((g) => g.rule).join("\n"),
  ```
- Kutipan kode (`apps/web/src/components/CharacterEditor.tsx:112-116`):
  ```tsx
  guardrails: form.guardrails
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((rule) => ({ rule })),
  ```
- Kutipan kode (`packages/templates/src/marketing.ts:121-123`):
  ```ts
  guardrails: [
    { rule: "approval_required_for_external_actions" },
    { rule: "rate_limit", params: { maxPostsPerDay: 5 } },
  ],
  ```
- Kutipan kode (`apps/server/src/security/guardrails.ts:56-58`):
  ```ts
  const g = findRule(guardrails, "rate_limit");
  const max = numParam(g, "maxPostsPerDay");
  if (max === undefined) return { ok: true };
  ```
- Kutipan kode (`apps/server/src/api/routes.ts:318`, `apps/server/src/db/store.ts:583`):
  ```ts
  if (Array.isArray(body["guardrails"])) patch.guardrails = body["guardrails"] as Guardrail[];
  ...(patch.guardrails !== undefined ? { guardrails: patch.guardrails } : {}),
  ```
- Observasi runtime guardrail:
  ```json
  {"withParams":{"ok":false,"reason":"rate limit tercapai (5/5 posting dalam 24 jam)"},"withoutParams":{"ok":true}}
  ```

**Dampak**
Operator yang hanya membuka lalu menyimpan agent Social Media dari UI dapat tanpa sadar menghapus batas posting harian. Setelah itu guardrail rate limit tidak memblokir publish walau audit count sudah mencapai batas.

**Verifikasi #1 (pembacaan kode)**
Template Marketing membuat `rate_limit` berparameter. `CharacterEditor` membuang `params` saat hydrate form dan saat build payload. API menerima array guardrails dari body, lalu store menyimpan patch apa adanya. `checkRateLimit` mengembalikan OK jika `maxPostsPerDay` tidak ada.

**Verifikasi #2 (sudut berbeda)**
`tests/guardrails.test.ts:38-44` membuktikan `rate_limit` dengan `maxPostsPerDay: 5` memblokir pada count 5. Probe runtime terpisah dengan guardrail `{ rule: "rate_limit" }` pada count 5 mengembalikan `ok: true`, sehingga hilangnya `params` memang menonaktifkan guardrail.

**Solusi yang diusulkan (untuk Claude)**
1. Ubah `CharacterEditor` agar guardrail params dipertahankan; minimal, jika rule tidak berubah, kirim kembali objek `Guardrail` asli termasuk `params`.
2. Untuk rule berparameter (`rate_limit`, `posting_hours`), sediakan editor terstruktur atau input JSON/YAML yang memvalidasi `params`.
3. Tambahkan validasi server untuk PATCH agent: `rate_limit` wajib punya `params.maxPostsPerDay` number finite; `posting_hours` wajib punya jam yang valid, atau request 400.
4. Tambahkan test UI/payload atau server route yang memastikan edit/save agent tidak menghapus `params` guardrail.

**Perbaikan Claude 2026-06-13 (FIXED).**
1. `apps/web/src/components/CharacterEditor.tsx`: form kini menyimpan `guardrailsOriginal: Guardrail[]` (lengkap dgn params) saat `loadAgent`. `buildInput` membangun ulang guardrail dgn merge: rule yang cocok → pakai objek asli (incl `params`); rule baru → `{ rule }`. Jadi buka+save tak lagi membuang `params`.
2. `apps/server/src/api/routes.ts` (defense-in-depth): helper `guardrailParamError` memvalidasi POST & PATCH agent — `rate_limit` wajib `params.maxPostsPerDay` (number ≥ 0), `posting_hours` wajib `params.from`/`to` (jam 0..23); selain itu **400**. Klien apa pun (termasuk UI lama) tak bisa lagi menyimpan guardrail param-rule tanpa params.
3. Test `tests/configApi.test.ts` ("BUG-115: guardrail rate_limit/posting_hours tanpa params valid → 400"): PATCH membuang params → 400; PATCH params lengkap → 200 & tersimpan; POST posting_hours tanpa jam valid → 400.

**Catatan verifikasi perbaikan**
Menunggu verifikasi Codex. Bukti sementara: `tests/configApi.test.ts` + `npm test` **89 passed**, build/lint/typecheck:web hijau. Catatan: validasi server menolak `rate_limit`/`posting_hours` tanpa params valid — bila ke depan diinginkan "rate_limit tanpa batas", gunakan rule berbeda atau params eksplisit.
