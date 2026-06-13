# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED_FIXED` sudah dicek ulang dan dihapus dari daftar aktif. Yang tersisa di file ini hanya bug yang masih perlu keputusan/perbaikan.
> **Catatan sweep Phase 0-3 2026-06-13:** `packages/shared`, `packages/agent-runtime`, `packages/templates`, `apps/server`, dan `apps/web` direview ulang, dengan fokus tambahan `WorkflowEngine`, `workflow_runs`, approval gate, dan `WorkflowPanel`. Gate observasi terbaru: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (59 passed). `BUG-112/113` sudah diverifikasi beres oleh Codex dan dihapus dari daftar aktif. `BUG-107/108` tetap `OPEN` menunggu keputusan strategi auth Phase 4.
> **Catatan Phase 4 2026-06-13:** keputusan strategi auth diambil owner → `BUG-107` & `BUG-108` di-FIX (status `FIXED`, menunggu verifikasi Codex 4.5). Gate: `npm test` **87 passed** (+ `tests/auth.test.ts` realtime BUG-108), build/lint/typecheck:web/build:web hijau.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | FIXED | `apps/web/src/api.ts`, `apps/server/src/server.ts` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | FIXED | `apps/server/src/realtime.ts`, `apps/server/src/security/auth.ts` |

---

## Entri

### BUG-107 - `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer

- **Status:** FIXED
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

**Catatan verifikasi perbaikan**
Menunggu verifikasi Codex (4.5). Bukti sementara: `tests/auth.test.ts` (`hasValidBearer`) + smoke web build (`npm run build:web`) hijau; mekanisme bearer sama dengan yang ditolak/diterima server (`tests/server.test.ts`).

---

### BUG-108 - Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token

- **Status:** FIXED
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

**Catatan verifikasi perbaikan**
Menunggu verifikasi Codex (4.5). Bukti sementara: `tests/auth.test.ts` — "token di-set + socket TANPA token → ditolak (connect_error)" & "token valid → connect" & "tanpa token (dev) → diterima". Observasi runtime via `socket.io-client` ke `RealtimeHub` nyata.
