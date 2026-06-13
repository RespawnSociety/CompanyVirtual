# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED_FIXED` sudah dicek ulang dan dihapus dari daftar aktif. Yang tersisa di file ini hanya bug yang masih perlu keputusan/perbaikan.
> **Catatan sweep Phase 0-2 2026-06-13:** migrasi MySQL/async dan runtime Phase 2 direview. Gate observasi: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (52 passed).

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | OPEN | `apps/web/src/api.ts:41`, `apps/server/src/server.ts:60` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | OPEN | `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:60` |
| BUG-110 | Task Board live bisa melewatkan status `done` dan artifact karena event dikirim sebelum persist selesai | medium | VERIFIED_FIXED | `packages/agent-runtime/src/loop.ts:137`, `apps/server/src/registry/dispatcher.ts:132`, `apps/web/src/App.tsx:100` |
| BUG-111 | Router error membuat task `blocked`, tetapi directive tetap `in_progress` | medium | VERIFIED_FIXED | `apps/server/src/registry/dispatcher.ts:125`, `packages/shared/src/types.ts:173` |

---

## Entri

### BUG-107 - `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer

- **Status:** OPEN
- **Severity:** high
- **Category:** runtime
- **Location:** `apps/web/src/api.ts:41`, `apps/server/src/server.ts:60`, `apps/server/src/main.ts:143`
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
- Observasi:
  `buildServer({ apiAuthToken: "secret" })` mengembalikan
  `{"noAuth":401,"auth":200}` untuk `GET /api/companies`; request tanpa header sama dengan perilaku `api.ts`.

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

**Catatan verifikasi perbaikan**
Kosong sampai Claude menandai `FIXED`.

---

### BUG-108 - Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token

- **Status:** OPEN
- **Severity:** high
- **Category:** security
- **Location:** `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:60`, `apps/web/src/socket.ts:33`
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
- Observasi:
  Server in-memory dengan `apiAuthToken: "secret"` + `RealtimeHub` menerima socket tanpa token dan mengirim `{"company":"A","agents":1}` setelah `world:subscribe`.
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

**Catatan verifikasi perbaikan**
Kosong sampai Claude menandai `FIXED`.

---

### BUG-110 - Task Board live bisa melewatkan status `done` dan artifact karena event dikirim sebelum persist selesai

- **Status:** VERIFIED_FIXED
- **Severity:** medium
- **Category:** concurrency
- **Location:** `packages/agent-runtime/src/loop.ts:137`, `packages/agent-runtime/src/loop.ts:184`, `apps/server/src/registry/dispatcher.ts:132`, `apps/server/src/registry/dispatcher.ts:139`, `apps/web/src/App.tsx:100`, `apps/web/src/components/TaskBoard.tsx:51`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
Task Board direfresh oleh event agent (`message`, `status`, `skill_end`), tetapi event selesai dari `runAgentLoop` dikirim sebelum `DirectiveDispatcher` menyimpan artifact dan mengubah task ke `done`. Karena tidak ada event post-persist, UI bisa refetch terlalu cepat dan tetap melihat task `in_progress` tanpa artifact sampai user refresh manual atau event lain datang.

**Bukti**
- Kutipan kode (`packages/agent-runtime/src/loop.ts:134-137`):
  ```ts
  finalText = res.message.content;
  status = "done";
  if (finalText) {
    emit({ type: "message", agentId: agent.id, at: now(), to: "user", text: finalText });
  ```
- Kutipan kode (`packages/agent-runtime/src/loop.ts:181-185`):
  ```ts
  emit({
    type: "status",
    agentId: agent.id,
    at: now(),
    status: status === "blocked" ? "blocked" : "idle",
  ```
- Kutipan kode (`apps/server/src/registry/dispatcher.ts:113`, `apps/server/src/registry/dispatcher.ts:132-140`):
  ```ts
  result = await runAgentLoop(agent, directive.text, {
  ...
  const artifact = await store.addArtifact({
  ...
  const updated =
    (await store.updateTask(task.id, { status: "done", outputRef: artifact.id })) ?? task;
  await store.updateDirectiveStatus(directive.id, "done");
  ```
- Kutipan kode (`apps/web/src/App.tsx:100-105`, `apps/web/src/components/TaskBoard.tsx:51`):
  ```tsx
  onAgentEvent: (e) => {
    setLastEvent(e);
    if (e.type === "status" || e.type === "skill_end" || e.type === "message") {
      setRefreshTick((t) => t + 1);
    }
  ...
  Promise.all([api.listTasks(companyId), api.listArtifacts(companyId)])
  ```
- Observasi probe runtime:
  `["event:status:working","event:message","event:memory","event:memory","event:status:idle","addArtifact","updateTask:done"]`.
- Alasan ini bug: event yang memicu `refreshTick` terjadi sebelum `addArtifact` dan `updateTask:done`, sementara tidak ada `task:updated`/event lain setelah persist selesai.

**Dampak**
Alur DoD Phase 2 ("Task Board live") bisa tampak macet: karakter sudah kembali idle, tetapi Task Board masih menampilkan task `Dikerjakan` tanpa tombol "Lihat konten". User perlu pindah/refresh manual atau menunggu event lain yang tidak dijamin ada.

**Verifikasi #1 (pembacaan kode)**
`runAgentLoop` emit `message` dan status `idle` sebelum return. `DirectiveDispatcher` baru menyimpan artifact dan mengubah status task setelah `await runAgentLoop(...)` selesai. Web hanya refetch Task Board ketika event agent menaikkan `refreshTick`.

**Verifikasi #2 (observasi runtime + kontrak DoD)**
Probe dengan `MockRouterClient([textResponse("final")])` dan wrapper `store.addArtifact/updateTask` menunjukkan urutan event sebelum persist: `event:message` dan `event:status:idle` muncul sebelum `addArtifact` dan `updateTask:done`. `docs/ROADMAP.md:91` menyebut Task Board live "refetch saat event", jadi event post-persist wajib ada agar live update deterministik.

**Solusi yang diusulkan (untuk Claude)**
1. Tambahkan event realtime post-persist, misalnya `task:updated`/`runtime:sync`, setelah `addArtifact`, `updateTask`, dan `updateDirectiveStatus` selesai di `DirectiveDispatcher`.
2. Update kontrak `packages/shared/src/realtime.ts` dan `apps/web/src/socket.ts` agar web bisa menerima event task selesai.
3. Di `App.tsx`, naikkan `refreshTick` dari event post-persist tersebut, bukan hanya dari event agent yang terjadi selama loop.
4. Tambahkan test/unit probe: urutan event yang memicu Task Board harus terjadi setelah task `done` dan artifact tersedia.

**Diperbaiki (Claude 2026-06-13) — FIXED (menunggu verifikasi Codex).**
Ditambah event POST-persist `task_update` di event bus:
- `packages/shared/src/events.ts`: tipe baru `AgentTaskUpdateEvent` (`type:"task_update"`, `taskId`, `status`) di union `AgentEvent`.
- `apps/server/src/registry/dispatcher.ts`: `emitTaskUpdate(updated)` dipanggil **setelah** `addArtifact` + `updateTask` + `updateDirectiveStatus` selesai, di SEMUA cabang (done/awaiting_approval/review/error). Jadi event ini dijamin tiba sesudah artifact & status tersimpan.
- `apps/web/src/App.tsx`: `onAgentEvent` menaikkan `refreshTick` saat `type === "task_update"` (selain status/skill_end/message), jadi Task Board refetch setelah persist.
- Test `tests/dispatch.test.ts`: happy-path mengecek ada event `task_update` ber-status `done`.
Gate: `npm test` 53/53, `lint`, `typecheck:web` hijau.

**Catatan verifikasi perbaikan**
VERIFIED_FIXED 2026-06-13 oleh Codex. Pembacaan kode: `packages/shared/src/events.ts:73-78` menambahkan `AgentTaskUpdateEvent` (`type: "task_update"`, `taskId`, `status`) ke union `AgentEvent`; `apps/server/src/registry/dispatcher.ts:112-113` membuat `emitTaskUpdate`, dan memanggilnya setelah persist selesai di cabang `done` (`apps/server/src/registry/dispatcher.ts:138-147`), error (`apps/server/src/registry/dispatcher.ts:130-132`), awaiting approval (`apps/server/src/registry/dispatcher.ts:153-156`), dan review (`apps/server/src/registry/dispatcher.ts:161-163`). UI menaikkan `refreshTick` saat menerima `task_update` di `apps/web/src/App.tsx:100-113`. Observasi runtime: urutan happy path sekarang `...,"addArtifact","updateTask:done","event:task_update:done"`, jadi refetch andal terjadi setelah artifact dan status task tersimpan. Gate lulus: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (53 passed).

---

### BUG-111 - Router error membuat task `blocked`, tetapi directive tetap `in_progress`

- **Status:** VERIFIED_FIXED
- **Severity:** medium
- **Category:** logic
- **Location:** `apps/server/src/registry/dispatcher.ts:125`, `apps/server/src/registry/dispatcher.ts:126`, `packages/shared/src/types.ts:173`, `docs/RUNBOOK.md:165`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
Saat `runAgentLoop` gagal (misalnya 9Router mati), dispatcher menandai task sebagai `blocked`, tetapi directive induknya tetap di-set `in_progress`. Kontrak `DirectiveStatus` juga belum punya status terminal error/blocked, sehingga directive bisa terlihat masih berjalan padahal semua task-nya sudah gagal.

**Bukti**
- Kutipan kode (`apps/server/src/registry/dispatcher.ts:123-127`):
  ```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = (await store.updateTask(task.id, { status: "blocked" })) ?? task;
    await store.updateDirectiveStatus(directive.id, "in_progress");
    return { status: "error", finalText: null, task: updated, error: message };
  }
  ```
- Kutipan kode (`packages/shared/src/types.ts:173-179`):
  ```ts
  export type DirectiveStatus =
    | "received"
    | "planned"
    | "in_progress"
    | "awaiting_approval"
    | "done";
  ```
- Kontrak operasional (`docs/RUNBOOK.md:165`) menyatakan tanpa 9Router, task akan jadi `blocked`.
- Observasi probe runtime:
  `{"outcome":"error","taskStatus":"blocked","directiveStatus":"in_progress"}`.
- Alasan ini bug: parent directive tidak punya status terminal yang merepresentasikan kegagalan child task, sehingga read model directive bertentangan dengan state task.

**Dampak**
Endpoint `GET /api/companies/:id/directives` dapat menampilkan directive gagal sebagai masih berjalan. Dashboard/phase berikutnya yang menghitung pekerjaan aktif dari directive akan salah, dan operator tidak punya sinyal bahwa directive berhenti karena router error.

**Verifikasi #1 (pembacaan kode)**
Catch block router/loop error eksplisit menulis task `blocked`, lalu menulis directive kembali ke `in_progress`. Tidak ada cabang lain yang mengubah directive tersebut setelah error.

**Verifikasi #2 (observasi runtime)**
Probe dengan `DirectiveDispatcher`, router mock yang melempar `Error("router down")`, dan MySQL test DB menghasilkan outcome `error`, task DB `blocked`, tetapi directive DB tetap `in_progress`.

**Solusi yang diusulkan (untuk Claude)**
1. Tambahkan status terminal error pada `DirectiveStatus`, paling konsisten: `"blocked"`.
2. Ubah catch di `apps/server/src/registry/dispatcher.ts` agar `updateDirectiveStatus(directive.id, "blocked")` saat task blocked karena router/loop error.
3. Update UI/API typing yang memakai `DirectiveStatus` bila ada.
4. Tambahkan test di `tests/dispatch.test.ts`: router gagal -> task `blocked`, directive `blocked`, outcome `error`.

**Diperbaiki (Claude 2026-06-13) — FIXED (menunggu verifikasi Codex).**
- `packages/shared/src/types.ts`: tambah status terminal `"blocked"` ke `DirectiveStatus`.
- `apps/server/src/registry/dispatcher.ts`: catch error loop/router kini `updateDirectiveStatus(directive.id, "blocked")` (bukan `in_progress`), konsisten dengan task yang juga `blocked`.
- Test `tests/dispatch.test.ts` ("BUG-111 ..."): router mock melempar → outcome `error`, task DB `blocked`, directive DB `blocked`.
Gate: `npm test` 53/53, `lint`, `typecheck:web` hijau.

**Catatan verifikasi perbaikan**
VERIFIED_FIXED 2026-06-13 oleh Codex. Pembacaan kode: `packages/shared/src/types.ts:203-209` menambahkan `"blocked"` ke `DirectiveStatus`, dan catch router/loop error di `apps/server/src/registry/dispatcher.ts:123-132` sekarang menulis task `blocked` lalu `updateDirectiveStatus(directive.id, "blocked")`. Observasi runtime dengan router mock yang melempar menghasilkan `{"outcome":"error","taskStatus":"blocked","directiveStatus":"blocked"}`. Test khusus ada di `tests/dispatch.test.ts:120-138`. Gate lulus: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (53 passed).
