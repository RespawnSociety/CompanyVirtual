# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-106 | PATCH agent menerima `status` di luar `AgentStatus` | medium | VERIFIED_FIXED | `apps/server/src/api/routes.ts:297` |
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | OPEN | `apps/web/src/api.ts:40`, `apps/server/src/server.ts:57` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | OPEN | `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:57` |
| BUG-109 | Menghapus company aktif meninggalkan `companyId` stale di UI | medium | VERIFIED_FIXED | `apps/web/src/App.tsx:58`, `apps/web/src/components/CompanySetup.tsx:103` |

---

## Entri

### BUG-106 - PATCH agent menerima `status` di luar `AgentStatus`

- **Status:** VERIFIED_FIXED
- **Severity:** medium
- **Category:** type-contract
- **Location:** `apps/server/src/api/routes.ts:297`, `apps/server/src/db/store.ts:478`, `packages/shared/src/types.ts:84`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Endpoint `PATCH /api/agents/:id` menerima string apa pun sebagai `status`, lalu cast langsung ke `NewAgent["status"]`. Nilai di luar union `AgentStatus` bisa tersimpan di SQLite dan ikut keluar lewat `WorldSnapshot`.

**Bukti**
- Kutipan kode (`packages/shared/src/types.ts:84`):
  ```ts
  export type AgentStatus = "idle" | "working" | "talking" | "blocked";
  ```
- Kutipan kode (`apps/server/src/api/routes.ts:290-291`):
  ```ts
  const status = asStr(body["status"]);
  if (status) patch.status = status as NewAgent["status"];
  ```
- Kutipan kode (`apps/server/src/db/store.ts:416`, `apps/server/src/db/store.ts:436`):
  ```ts
  ...(patch.status !== undefined ? { status: patch.status } : {}),
  ...
  next.status,
  ```
- Observasi:
  `node --input-type=module -e "...PATCH status:'banana'..."` menghasilkan
  `{"patchStatus":200,"returnedStatus":"banana","worldStatus":"banana"}`.
- Alasan ini bug: `AgentProfile.status` dikontrak sebagai union terbatas, tetapi API dapat mengembalikan nilai yang tidak mungkin menurut `@vc/shared`.

**Dampak**
Client dan runtime yang melakukan narrowing terhadap `AgentStatus` bisa menerima state tidak dikenal. Animasi/status agent Phase 2+ dapat salah render atau jatuh ke fallback diam-diam karena status bukan `idle|working|talking|blocked`.

**Verifikasi #1 (pembacaan kode)**
`routes.ts` hanya memakai `asStr` dan type assertion, bukan validasi enum. `store.ts` menyimpan `next.status` apa adanya dan `rowToAgent` meng-cast kolom DB kembali ke `AgentProfile["status"]`, sehingga nilai invalid tidak pernah ditolak.

**Verifikasi #2 (observasi runtime)**
Fastify inject pada server in-memory membuat agent, lalu `PATCH /api/agents/:id` dengan payload `{ "status": "banana" }`. Response PATCH dan `GET /api/companies/:id/world` sama-sama mengembalikan `"banana"`.

**Solusi yang diusulkan (untuk Claude)**
1. Tambahkan validator `asAgentStatus(v)` di `apps/server/src/api/routes.ts` yang hanya menerima `"idle" | "working" | "talking" | "blocked"`.
2. Untuk `POST /api/departments/:departmentId/agents` dan `PATCH /api/agents/:id`, tolak status invalid dengan `400`.
3. Tambahkan test di `tests/configApi.test.ts`: PATCH status invalid harus 400 dan status lama tidak berubah.

**Diperbaiki (Claude 2026-06-11)** — sudah diverifikasi Codex pada 2026-06-11.
Validator `asAgentStatus(v)` baru di `apps/server/src/api/routes.ts` (whitelist `idle|working|talking|blocked`). PATCH agent: bila key `status` hadir tapi nilai invalid → `400` (tak disimpan); valid → di-set. POST agent tidak membaca `status` (default `idle`), jadi tak ada jalur lain. Test ditambah di `tests/configApi.test.ts`: PATCH `status:"banana"` → 400 dan status lama (`working`) tak berubah. `npm test` (45 pass) & `npm run lint` lulus.

**Catatan verifikasi perbaikan**
VERIFIED_FIXED 2026-06-11 oleh Codex. Pembacaan kode: `apps/server/src/api/routes.ts:43-49` menambahkan whitelist `AgentStatus`, dan `apps/server/src/api/routes.ts:297-301` mengembalikan `400` bila key `status` hadir tetapi nilainya bukan `idle|working|talking|blocked`. Observasi runtime setelah `npm run build`: PATCH valid `status:"working"` menghasilkan 200, PATCH invalid `status:"banana"` menghasilkan 400, dan `GET /world` tetap mengembalikan `worldStatus:"working"`. Gate lulus: `npm run build`, `npm run lint`, `npm test` (45 passed), `npm run build:web`.

---

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
  `buildServer({ apiAuthToken: "secret" })` mengembalikan `{"noAuth":401,"auth":200}` untuk `GET /api/companies`; request tanpa header sama dengan perilaku `api.ts`.

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

**Catatan Claude 2026-06-11 — DITUNDA (butuh keputusan).**
Solusi #1 menuntut pilihan strategi auth web (token build-time `VITE_API_AUTH_TOKEN` yang ter-embed di bundle vs reverse-proxy yang menyuntik header vs login ringan) — trade-off keamanan yang harus diputuskan owner, bukan default sepihak. Dikerjakan bersama `BUG-108` (auth socket) sebagai satu boundary auth (lihat CR-101). Status tetap `OPEN` sampai strategi dipilih.

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

**Catatan Claude 2026-06-11 — DITUNDA (butuh keputusan).**
Tergantung strategi auth web yang sama dengan `BUG-107` (token diteruskan ke `RealtimeHub` via `io.use` + `socket.handshake.auth.token`). Test realtime juga butuh `socket.io-client` di root (kini hanya ada di `apps/web`). Status tetap `OPEN` sampai strategi auth dipilih; akan dikerjakan satu paket dengan `BUG-107` + CR-101.

**Catatan verifikasi perbaikan**
Kosong sampai Claude menandai `FIXED`.

---

### BUG-109 - Menghapus company aktif meninggalkan `companyId` stale di UI

- **Status:** VERIFIED_FIXED
- **Severity:** medium
- **Category:** logic
- **Location:** `apps/web/src/App.tsx:47`, `apps/web/src/components/CompanySetup.tsx:103`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Saat user menghapus company yang sedang aktif, `CompanySetup` hanya memanggil `reload()`. `reload()` memperbarui daftar company dan mencoba `getWorld(companyId)` untuk id lama, tetapi tidak pernah mengganti `companyId` ke company lain atau `null`. Akibatnya state global tetap menunjuk company yang sudah dihapus.

**Bukti**
- Kutipan kode (`apps/web/src/components/CompanySetup.tsx:115-116`):
  ```tsx
  await api.deleteCompany(c.id);
  await reload();
  ```
- Kutipan kode (`apps/web/src/App.tsx:98-105`):
  ```tsx
  const reload = useCallback(async (): Promise<void> => {
    await refreshCompanies();
    if (companyId) {
      try {
        setWorld(await api.getWorld(companyId));
      } catch {
        setWorld(null);
      }
  ```
- Kutipan kode (`apps/web/src/components/CompanySetup.tsx:53-54`, `apps/web/src/components/CompanySetup.tsx:129`):
  ```tsx
  await api.createFloor(selectedCompanyId, { name: floorName.trim() });
  ...
  {selectedCompanyId && (
  ```
- Observasi REST:
  Setelah `DELETE /api/companies/:id`, `GET /api/companies/:id/world` mengembalikan `{"deleteStatus":200,"worldAfterDelete":404}`.

**Dampak**
UI dapat tetap menganggap company yang sudah dihapus sebagai aktif. Panel “Lantai company aktif” masih muncul karena `selectedCompanyId` truthy, lalu aksi seperti tambah lantai menarget id yang sudah tidak ada dan berakhir 404. Topbar select juga menerima `value={companyId}` yang tidak ada di opsi company terbaru.

**Verifikasi #1 (pembacaan kode)**
`reload()` tidak memakai hasil `refreshCompanies()` untuk mengecek apakah `companyId` masih ada. Effect auto-pilih company hanya berjalan saat mount (`refreshCompanies().then(...)`), bukan setiap list berubah setelah delete.

**Verifikasi #2 (data-flow + observasi REST)**
Alur `deleteCompany(activeId) -> reload() -> api.getWorld(activeId)` pasti memakai id lama karena `setCompanyId` tidak dipanggil. REST mengonfirmasi id lama sudah 404 setelah delete, sehingga UI masuk state `companyId` lama + `world=null`.

**Solusi yang diusulkan (untuk Claude)**
1. Ubah `reload()` agar memakai hasil `const list = await refreshCompanies()` dan merekonsiliasi `companyId`.
2. Jika `companyId` sudah tidak ada, set ke `list[0]?.id ?? null` dan biarkan effect world loader memuat snapshot baru.
3. Setelah delete company aktif di `CompanySetup`, bisa juga panggil callback eksplisit untuk memilih company berikutnya/null.
4. Tambahkan test komponen atau minimal helper-state test untuk kasus delete selected company.

**Diperbaiki (Claude 2026-06-11)** — sudah diverifikasi Codex pada 2026-06-11.
`App.tsx` kini punya effect rekonsiliasi `[companies]`: tiap daftar company berubah (mount/buat/hapus), `setCompanyId((cur) => cur valid ? cur : companies[0]?.id ?? null)` (updater fungsional → tak menabrak pilihan baru dari `onSelectCompany`). `reload()` memakai list hasil `refreshCompanies()` dan hanya `getWorld` bila company aktif masih ada (hindari fetch 404 untuk id terhapus); selebihnya effect rekonsiliasi + world-loader memuat ulang. Effect mount disederhanakan jadi sekadar `refreshCompanies()`. `npm run build:web` & `npm test` lulus. (Catatan: belum ada test komponen React di repo; verifikasi via build + pembacaan alur.)

**Catatan verifikasi perbaikan**
VERIFIED_FIXED 2026-06-11 oleh Codex. Pembacaan kode: `apps/web/src/App.tsx:47-63` sekarang menyimpan hasil `refreshCompanies()` dan merekonsiliasi `companyId` setiap daftar company berubah; `apps/web/src/App.tsx:101-112` hanya memanggil `getWorld(companyId)` bila id aktif masih ada di list terbaru. Data-flow delete: `apps/web/src/components/CompanySetup.tsx:103-104` memanggil `api.deleteCompany(c.id)` lalu `reload()`, sehingga list terbaru memicu rekonsiliasi ke company lain atau `null` dan world-loader memuat snapshot baru/clear state. Gate lulus: `npm run build`, `npm run lint`, `npm test` (45 passed), `npm run build:web`.
