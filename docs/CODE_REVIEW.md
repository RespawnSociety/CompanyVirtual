# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan review penuh Codex 2026-06-11:** Phase 0-1 dibaca ulang lintas `packages/shared`,
> `packages/agent-runtime`, `packages/templates`, `apps/server`, dan `apps/web`. Bug aktif ada di
> `docs/BUGLIST.md` (`BUG-106..109`). CR-102 sudah terverifikasi beres; CR lain tetap kualitas/arsitektur.

> **Catatan pengerjaan Claude 2026-06-11 (pass 2):** CR-103..109 sudah **dikerjakan** dan
> diverifikasi Codex (status `VERIFIED`, lihat "Diterapkan" tiap entri). CR-102 = `VERIFIED`
> (Codex). CR-101 = setengah:
> mekanisme bearer/CORS sudah ada (pass 1), sisanya = boundary auth lintas-protokol di `BUG-107`
> (web client kirim bearer) + `BUG-108` (auth socket) yang **butuh keputusan strategi** → masih `OPEN`.
> Gate verifikasi Codex lulus: `npm run build`, `npm run lint`, `npm test` (45 pass),
> `npm run build:web`.

> **Catatan verifikasi Codex 2026-06-11:** CR-103..109 sudah dibaca ulang pada source terbaru.
> Bukti utama: CR-103 memakai registry `mapKey` (`apps/web/src/game/maps.ts:18-30`,
> `apps/web/src/game/OfficeScene.ts:118-120`); CR-104 memakai batch helper relasi
> (`apps/server/src/db/store.ts:157-178`, `:204-215`, `:323-330`); CR-105 memakai
> `defaultGenId` bersama (`apps/server/src/db/store.ts:12`, `apps/server/src/config/seed.ts:10`);
> CR-106 memakai `useAsyncAction` dan parsing field tunggal (`apps/web/src/hooks/useAsyncAction.ts:17-36`);
> CR-107 update tile di `onComplete` tween (`apps/web/src/game/OfficeScene.ts:263-277`);
> CR-108 subscribe socket idempoten dan cleanup client (`apps/server/src/realtime.ts:33-41`,
> `apps/web/src/socket.ts:44-46`); CR-109 clear state plus ignore guard
> (`apps/web/src/components/TaskBoard.tsx:29-53`, `apps/web/src/components/CommsViewer.tsx:20-44`).

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`?
Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| CR-101 | Arsitektur auth REST/web/realtime belum satu jalur | architecture/security | high | OPEN | `apps/server/src/server.ts`, `apps/server/src/realtime.ts`, `apps/web/src/api.ts` |
| CR-102 | PATCH bisa mengosongkan field opsional | consistency | medium | VERIFIED | `apps/server/src/api/routes.ts`, `apps/server/src/db/store.ts` |
| CR-103 | `Floor.mapKey` field mati - renderer hardcode `office-map` | consistency | medium | VERIFIED | `apps/web/src/game/OfficeScene.ts`, `apps/web/src/game/maps.ts` |
| CR-104 | N+1 query di `list*` / `getWorldSnapshot` | performance | medium | VERIFIED | `apps/server/src/db/store.ts` |
| CR-105 | `newId` duplikasi `defaultGenId` | reuse | low | VERIFIED | `apps/server/src/db/store.ts`, `apps/server/src/config/seed.ts` |
| CR-106 | Duplikasi pola kecil di REST handler dan komponen web | cleanliness | low | VERIFIED | `apps/server/src/api/routes.ts`, `apps/web/src/hooks/useAsyncAction.ts` |
| CR-107 | `walkTo` set `obj.tile` ke tujuan sebelum tween selesai | correctness-minor | low | VERIFIED | `apps/web/src/game/OfficeScene.ts` |
| CR-108 | Socket re-subscribe per ganti company | robustness | low | VERIFIED | `apps/web/src/App.tsx`, `apps/server/src/main.ts`, `apps/server/src/realtime.ts` |
| CR-109 | Task/Comms viewer bisa menampilkan data lama saat company berganti | robustness | low | VERIFIED | `apps/web/src/components/TaskBoard.tsx`, `apps/web/src/components/CommsViewer.tsx` |

---

## Temuan

### CR-101 - Arsitektur auth REST/web/realtime belum satu jalur

- **Type:** architecture / security
- **Severity:** high
- **Location:** `apps/server/src/server.ts:57`, `apps/server/src/main.ts:123`, `apps/server/src/realtime.ts:33`, `apps/web/src/api.ts:40`, `apps/web/src/socket.ts:33`
- **Status:** OPEN

**Temuan**
REST kini punya bearer gate opsional via `API_AUTH_TOKEN`, dan `main.ts` menolak bind non-loopback tanpa token. Namun auth belum menjadi boundary bersama: web REST client belum mengirim token (`BUG-107`) dan realtime socket belum ikut divalidasi (`BUG-108`).

**Kenapa penting**
Plan §8 menuntut least-privilege. Kalau REST, socket, dan web client memakai mekanisme berbeda, mudah ada jalur yang aman di satu protokol tetapi bocor di protokol lain.

**Usulan perbaikan**
Setelah `BUG-107` dan `BUG-108` diperbaiki, satukan helper auth untuk REST + Socket.IO, dokumentasikan mode dev vs hosting, dan tambahkan test lintas protokol.

**Diterapkan sebagian (Claude 2026-06-11)**
Mekanisme dasar sudah ada: bearer gate `/api/*` via `API_AUTH_TOKEN` (`apps/server/src/server.ts`), penolakan bind non-loopback tanpa token (`apps/server/src/main.ts`), header CORS `authorization`, dan dokumentasi `.env.example`. **Belum** ditutup: web client belum mengirim bearer (`BUG-107`) dan socket realtime belum tervalidasi (`BUG-108`). Keduanya butuh keputusan strategi auth web (token build-time vs reverse-proxy vs login) → CR-101 tetap `OPEN` sampai itu diputuskan.

---

### CR-102 - PATCH bisa mengosongkan field opsional

- **Type:** consistency
- **Severity:** medium
- **Location:** `apps/server/src/api/routes.ts:205`, `apps/server/src/api/routes.ts:285`, `apps/server/src/db/store.ts:294`, `apps/server/src/db/store.ts:425`, `apps/web/src/components/CharacterEditor.tsx:118`
- **Status:** VERIFIED

**Temuan**
VERIFIED 2026-06-11: kode terbaru sudah membedakan key absent vs key hadir untuk `workflowId` dan `commsHandle`. Key hadir dengan nilai kosong dikirim sebagai `""`, lalu store menyimpan `NULL`.

**Kenapa penting**
Semantik optional contract sudah benar untuk field yang dicatat di CR ini. Validasi enum/status yang berbeda dicatat sebagai `BUG-106`.

**Usulan perbaikan**
Tidak ada follow-up untuk CR ini.

---

### CR-103 - `Floor.mapKey` field mati

- **Type:** consistency
- **Severity:** medium
- **Location:** `apps/server/src/db/store.ts:156`, `apps/web/src/game/OfficeScene.ts`, `apps/web/src/game/maps.ts`
- **Status:** VERIFIED

**Temuan**
Store menyimpan `Floor.mapKey` dengan default `"office-default"`, tetapi `OfficeScene` selalu memakai `MAP_KEY = "office-map"` dan selalu load `assets/maps/office.json`. Field `mapKey` belum memengaruhi renderer.

**Kenapa penting**
Kontrak `Floor.mapKey` menjanjikan peta per lantai. Saat multi-map masuk Phase 5, behavior sekarang akan diam-diam merender map yang sama untuk semua lantai.

**Usulan perbaikan**
Sediakan mapping `mapKey -> asset path` dan apply saat floor berubah, atau dokumentasikan eksplisit bahwa multi-map belum aktif dan samakan default key dengan key renderer.

**Diterapkan (Claude 2026-06-11)**
Registry `mapKey -> path` baru di `apps/web/src/game/maps.ts` (`mapPathFor`/`isKnownMapKey`/`DEFAULT_MAP_KEY="office-default"`, selaras dgn default store). `OfficeScene.preload` memuat path dari registry (bukan string hardcode); konstanta cache di-rename `MAP_CACHE_KEY` (bukan `Floor.mapKey`). `applyWorld` kini membaca `mapKey` lantai aktif via `ensureMapForFloor()` dan memberi peringatan sekali bila lantai meminta map lain — tidak lagi diabaikan diam-diam. Multi-map runtime tetap Phase 5 (satu aset map di Phase 1), tapi field sudah dikonsumsi & divalidasi.

---

### CR-104 - N+1 query di `list*` / `getWorldSnapshot`

- **Type:** performance
- **Severity:** medium
- **Location:** `apps/server/src/db/store.ts:128`, `apps/server/src/db/store.ts:192`, `apps/server/src/db/store.ts:311`, `apps/server/src/db/store.ts:493`
- **Status:** VERIFIED

**Temuan**
`rowToCompany`, `rowToFloor`, dan `rowToDepartment` masing-masing memanggil query anak (`floorIdsOf`, `departmentIdsOf`, `agentIdsOf`). `getWorldSnapshot` memanggil beberapa list dan dapat menghasilkan banyak query kecil pada jalur broadcast.

**Kenapa penting**
Untuk data Phase 1 kecil masih aman, tetapi jalur snapshot/realtime adalah hot path. Saat company berisi banyak lantai/departemen/agent, biaya query tumbuh cepat.

**Usulan perbaikan**
Ambil relasi anak secara batch (`WHERE parent_id IN (...)`), bucket ke `Map`, lalu hydrate DTO tanpa query per baris.

**Diterapkan (Claude 2026-06-11)**
Helper `childIdsByParent(table, parentCol, parentIds, orderBy)` baru: satu query `WHERE parent IN (...) ORDER BY parent, <orderBy>` lalu bucket ke `Map` (urutan anak per-parent dijaga). `listCompanies`/`listFloors`/`listDepartmentsBy*` kini batch sekali; `rowToCompany/rowToFloor/rowToDepartment` menerima id anak precomputed (fallback per-id hanya untuk getter entitas tunggal). `getWorldSnapshot` jadi konstanta query (bukan N+1). Urutan `floorIds`/`departmentIds`/`agentIds` tetap sama (test `db`/`seed` hijau).

---

### CR-105 - `newId` duplikasi `defaultGenId`

- **Type:** reuse
- **Severity:** low
- **Location:** `apps/server/src/db/store.ts`, `apps/server/src/config/seed.ts`, `packages/agent-runtime/src/util/id.ts:4`
- **Status:** VERIFIED

**Temuan**
Format id `${prefix}_${randomUUID()}` ada di `defaultGenId`, tetapi store dan seed masih membuat id sendiri.

**Kenapa penting**
Format id yang tersebar membuat perubahan naming/id policy harus disentuh di beberapa tempat.

**Usulan perbaikan**
Gunakan `defaultGenId` sebagai satu sumber format id, atau pindahkan helper id ke package shared jika server tidak ingin bergantung ke runtime.

**Diterapkan (Claude 2026-06-11)**
`store.ts` menghapus `newId` lokal + import `randomUUID`; kini `defaultGenId("co"|"fl"|"dp"|"ag")` dari `@vc/agent-runtime`. `seed.ts` `cloneWorkflowDef` memakai `genId: (prefix) => string = defaultGenId` (`genId("wf")`, `genId("wf-step")`), import `randomUUID` dihapus. Format id tak berubah (test regex `^co_`/`^ag_` & seed hijau). `@vc/agent-runtime` memang sudah dependency `@vc/server`.

---

### CR-106 - Duplikasi pola kecil di REST handler dan komponen web

- **Type:** cleanliness / reuse
- **Severity:** low
- **Location:** `apps/server/src/api/routes.ts`, `apps/web/src/hooks/useAsyncAction.ts`, `apps/web/src/components/{CompanySetup,DepartmentBuilder,CharacterEditor}.tsx`
- **Status:** VERIFIED

**Temuan**
Masih ada pola berulang: helper parsing body dipanggil berulang di handler, pola `busy/error/try/catch/finally` disalin di beberapa komponen, dan beberapa delete action tidak memakai wrapper `run()` yang sama.

**Kenapa penting**
Inkonsistensi kecil ini membuat behavior error/loading antar panel mudah beda.

**Usulan perbaikan**
Ekstrak helper parsing per field di REST dan hook `useAsyncAction()` di web untuk `{ busy, error, run }`.

**Diterapkan (Claude 2026-06-11)**
REST: handler PATCH/POST hitung `asStr(...)` sekali (`const name = asStr(...); if (name) ...`), tanpa non-null assertion ganda. Web: hook baru `apps/web/src/hooks/useAsyncAction.ts` (`{ busy, error, run, clearError }`) dipakai di CompanySetup, DepartmentBuilder, CharacterEditor — termasuk handler delete (sebelumnya tak reset busy/error). `DepartmentBuilder` pakai satu `selectedTemplate = templates.find(...)` (sebelumnya 3×).

---

### CR-107 - `walkTo` set `obj.tile` ke tujuan sebelum tween selesai

- **Type:** correctness-minor
- **Severity:** low
- **Location:** `apps/web/src/game/OfficeScene.ts`
- **Status:** VERIFIED

**Temuan**
`walkTo` mengubah `obj.tile` ke tile tujuan sebelum tween selesai. Selama animasi, posisi logis dan posisi visual berbeda.

**Kenapa penting**
Ini bisa membuat klik pada karakter yang sedang bergerak terasa salah: tile visual belum sampai, tetapi seleksi/hit-test sudah memakai tujuan.

**Usulan perbaikan**
Set `obj.tile` pada `onComplete` tween, atau pisahkan `currentTile` dan `targetTile`.

**Diterapkan (Claude 2026-06-11)**
Set `obj.tile = tujuan` sinkron dihapus. Tiap langkah tween chain punya `onComplete` yang meng-update `obj.tile` ke petak yang baru tercapai → seleksi/HUD akurat selama berjalan, dan re-route di tengah jalan berangkat dari petak terakhir yang benar-benar dicapai.

---

### CR-108 - Socket re-subscribe per ganti company

- **Type:** robustness
- **Severity:** low
- **Location:** `apps/web/src/App.tsx`, `apps/server/src/main.ts`, `apps/server/src/realtime.ts`
- **Status:** VERIFIED

**Temuan**
Tiap ganti company membuat socket baru dan subscribe ulang. Sisi server untuk window `onMutate` sudah diperbaiki karena `RealtimeHub` dibuat sebelum `listen()` (`apps/server/src/main.ts:148`), tetapi churn koneksi client masih ada.

**Kenapa penting**
Dampaknya kecil sekarang, tetapi makin terasa saat socket membawa auth dan event agent.

**Usulan perbaikan**
Pakai satu socket bersama dan ganti room via emit/unsubscribe eksplisit, atau pastikan disconnect lama selesai sebelum subscribe baru.

**Diterapkan (Claude 2026-06-11)**
(b) Celah `onMutate→broadcast` ditutup: `RealtimeHub` dibuat **sebelum** `app.listen()` di `main.ts` (`app.server` sudah ada sejak Fastify dibangun). (a) `world:subscribe` di `RealtimeHub` kini idempoten: socket meninggalkan room `company:*` lain sebelum join room baru → satu socket tak menumpuk di >1 room (cegah broadcast/snapshot ganda saat ganti company cepat). Client tetap satu socket per company (cleanup `removeAllListeners()+disconnect()` sudah menetralkan delivery basi); shared-socket penuh dicatat sebagai optimasi lanjutan.

---

### CR-109 - Task/Comms viewer bisa menampilkan data lama saat company berganti

- **Type:** robustness
- **Severity:** low
- **Location:** `apps/web/src/components/TaskBoard.tsx`, `apps/web/src/components/CommsViewer.tsx`
- **Status:** VERIFIED

**Temuan**
Saat `companyId` berubah, `TaskBoard` dan `CommsViewer` hanya `setLoaded(false)` lalu fetch data baru. State `tasks`/`msgs` lama tidak di-clear dan tidak ada guard ignore untuk response lama. Selama loading, komponen bisa menampilkan data company sebelumnya.

**Kenapa penting**
Phase 1 data nyata masih kosong, jadi dampak sekarang kecil. Saat Phase 2/3 mengisi tasks/comms, switching company cepat dapat menampilkan data stale.

**Usulan perbaikan**
Saat `companyId` berubah, clear state (`setTasks([])` / `setMsgs([])`) dan pakai flag ignore/AbortController seperti loader `world` di `App.tsx`.

**Diterapkan (Claude 2026-06-11)**
Kedua komponen kini `setTasks([])`/`setMsgs([])` saat `companyId` berubah (termasuk saat jadi `null`), plus flag `ignore` di cleanup effect sehingga respons company lama tak menimpa data company baru (pola sama seperti world-loader di `App.tsx`).
