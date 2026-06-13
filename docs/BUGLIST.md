# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED_FIXED` sudah dicek ulang dan dihapus dari daftar aktif. Yang tersisa di file ini hanya bug yang masih perlu keputusan/perbaikan.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | OPEN | `apps/web/src/api.ts:40`, `apps/server/src/server.ts:57` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | OPEN | `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:57` |

---

## Entri

### BUG-107 - `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer

- **Status:** OPEN
- **Severity:** high
- **Category:** runtime
- **Location:** `apps/web/src/api.ts:40`, `apps/server/src/server.ts:57`, `apps/server/src/main.ts:123`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Server sudah mendukung `API_AUTH_TOKEN` dan bahkan mewajibkannya saat bind non-loopback, tetapi klien web bawaan tidak punya mekanisme untuk mengirim `Authorization: Bearer <token>`. Akibatnya mode deployment yang aman membuat UI resmi gagal memanggil semua endpoint `/api/*`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:57`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/main.ts:123-128`):
  ```ts
  const apiAuthToken = env.API_AUTH_TOKEN?.trim() || undefined;
  if (!apiAuthToken && !isLoopbackHost(host)) {
    throw new Error(
      `Server bind ke host non-loopback '${host}' tanpa API_AUTH_TOKEN. ` +
        "REST /api/* akan terbuka tanpa auth. Set API_AUTH_TOKEN di .env sebelum expose ke jaringan.",
  ```
- Kutipan kode (`apps/web/src/api.ts:39-40`):
  ```ts
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
  ```
- Kontrak env (`.env.example:45-48`) menyatakan klien harus mengirim `Authorization: Bearer <token>`, tetapi tidak ada `VITE_*`/config/token path di `apps/web`.
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
- **Location:** `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:57`, `apps/web/src/socket.ts:33`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Bearer auth hanya diterapkan pada URL yang diawali `/api/`. Socket.IO `/socket.io` tidak dicek token, dan `RealtimeHub` langsung menerima `world:subscribe` lalu mengirim snapshot company. Jadi saat REST sudah dilindungi token, world snapshot masih bisa diambil lewat socket tanpa auth bila penyerang mengetahui `companyId`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:57`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/realtime.ts:33-36`):
  ```ts
  socket.on("world:subscribe", (companyId: Id) => {
    void socket.join(room(companyId));
    const snap = this.store.getWorldSnapshot(companyId);
    if (snap) socket.emit("world:sync", snap);
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
