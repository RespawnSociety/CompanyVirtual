# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.

> ⚠️ **Catatan sumber (CR-101..108):** Temuan Phase 1 dari self-review Claude (Codex CLI belum terpasang).
> Status `OPEN` = usulan, belum dikerjakan; mohon ditinjau/diprioritaskan saat Codex tersedia.

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`? Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| CR-101 | REST `/api/*` tanpa auth (owner-auth tak menutup HTTP) | architecture/security | high | OPEN | `apps/server/src/api/routes.ts` |
| CR-102 | PATCH tak bisa mengosongkan field opsional (commsHandle/workflowId) | consistency | medium | OPEN | `apps/server/src/api/routes.ts`, `db/store.ts` |
| CR-103 | `Floor.mapKey` field mati — renderer hardcode `office-map` | consistency | medium | OPEN | `apps/web/src/game/OfficeScene.ts` |
| CR-104 | N+1 query di `list*`/`getWorldSnapshot` (jalur broadcast) | performance | medium | OPEN | `apps/server/src/db/store.ts` |
| CR-105 | `newId` duplikasi `defaultGenId` agent-runtime | reuse | low | OPEN | `apps/server/src/db/store.ts`, `config/seed.ts` |
| CR-106 | Duplikasi pola: `asStr` ganda + `run()` busy/error + `templates.find` | cleanliness | low | OPEN | `apps/server/src/api/routes.ts`, web components |
| CR-107 | `walkTo` set `obj.tile` ke tujuan sebelum tween selesai | correctness-minor | low | OPEN | `apps/web/src/game/OfficeScene.ts` |
| CR-108 | Socket re-subscribe per ganti company + window `onMutate` sebelum hub siap | robustness | low | OPEN | `apps/web/src/App.tsx`, `apps/server/src/main.ts` |

---

## Temuan

### CR-101 — REST `/api/*` tanpa autentikasi

- **Type:** architecture / security
- **Severity:** high (tapi lokal-only di Phase 1)
- **Location:** `apps/server/src/api/routes.ts` (semua handler), `apps/server/src/main.ts` (selalu register)
- **Status:** OPEN

**Temuan** Endpoint mutasi config (create/delete company, floor, department, agent) tak punya cek owner sama sekali. Owner-auth Phase 0 (`comms/ownerAuth.ts`) hanya menutup jalur WhatsApp, bukan HTTP. Dengan `WEB_ORIGIN=*` default, siapa pun yang menjangkau server bisa menghapus/menulis ulang seluruh perusahaan.

**Kenapa penting** Plan §8 menegaskan least-privilege & owner-auth non-negotiable. REST adalah permukaan serang baru yang belum dijaga.

**Mitigasi saat ini** Server default bind `127.0.0.1` (lokal). Cukup untuk Phase 1 (dev lokal), **tapi wajib** ditutup sebelum expose ke jaringan.

**Usulan** Tambah middleware auth pada `/api/*` (mis. token bearer dari env, atau samakan dengan owner-auth) sebelum Phase 4 (aksi eksternal) / sebelum hosting non-lokal. Ketatkan `WEB_ORIGIN` di produksi.

---

### CR-102 — PATCH tak bisa mengosongkan field opsional

- **Type:** consistency
- **Severity:** medium
- **Location:** `apps/server/src/api/routes.ts` (PATCH agent/department), `apps/server/src/db/store.ts` (`updateDepartment`, `updateAgent`)
- **Status:** OPEN

**Temuan** Guard `if (asStr(body[x]))` + coalesce `patch.x ?? cur.x ?? null` membuat `commsHandle` & `workflowId` tak bisa di-reset jadi kosong (string kosong/`null` ditolak sebagai "tak diubah"). Field-field ini opsional di `@vc/shared`, jadi semestinya bisa dikosongkan.

**Kenapa penting** Divergensi dari semantik optional kontrak; user tak bisa melepas workflow/handle yang sudah diset.

**Usulan** Bedakan "absent" vs "explicit null/empty" pada body PATCH (mis. cek `key in body`), atau sediakan sentinel. Saat key hadir dengan nilai kosong → set ke `null`/hapus.

---

### CR-103 — `Floor.mapKey` field mati

- **Type:** consistency
- **Severity:** medium
- **Location:** `apps/web/src/game/OfficeScene.ts` (`MAP_KEY="office-map"`, selalu load `office.json`)
- **Status:** OPEN

**Temuan** Store menyimpan & default-kan `mapKey` ("office-default"), tapi OfficeScene meng-hardcode satu map dan mengabaikan `mapKey`. Janji "map per lantai" belum terpenuhi.

**Kenapa penting** Multi-floor/multi-map (Phase 5) butuh ini; sekarang semua lantai render map sama tanpa error → menyesatkan.

**Usulan** OfficeScene memuat berkas Tiled sesuai `floor.mapKey` (peta `mapKey → path`), atau dokumentasikan eksplisit bahwa multi-map = Phase 5 dan satukan default. Selaraskan `mapKey` default dengan key map nyata.

---

### CR-104 — N+1 query di `list*` / `getWorldSnapshot`

- **Type:** performance
- **Severity:** medium
- **Location:** `apps/server/src/db/store.ts` (`listCompanies`→`floorIdsOf`, `listFloors`→`departmentIdsOf`, `listDepartments*`→`agentIdsOf`, `getWorldSnapshot`)
- **Status:** OPEN

**Temuan** Tiap baris pada list memicu query anak tambahan untuk menghitung `*Ids`. `getWorldSnapshot` (dipanggil tiap `onMutate` → broadcast) memicu lusinan query kecil; tumbuh dengan ukuran world.

**Kenapa penting** Jalur broadcast adalah hot path. Untuk skala Phase 1 (sedikit entitas) masih OK, tapi cepat membengkak.

**Usulan** Query anak ber-grup (`... WHERE parent_id IN (...) ORDER BY ...`) lalu bucket ke `Map`, atau `json_group_array`. Bangun map id sekali & reuse di `rowToFloor/rowToDepartment`.

---

### CR-105 — `newId` duplikasi `defaultGenId`

- **Type:** reuse
- **Severity:** low
- **Location:** `apps/server/src/db/store.ts` (`newId`), `apps/server/src/config/seed.ts` (`randomUUID` langsung)
- **Status:** OPEN

**Temuan** `newId(prefix)` = `${prefix}_${randomUUID()}` identik dengan `defaultGenId` yang sudah diekspor `@vc/agent-runtime`. Ada 3 tempat menghasilkan id sendiri.

**Usulan** Import `defaultGenId` dari agent-runtime, hapus salinan lokal & pemanggilan `randomUUID` langsung di seed; satu sumber format id.

---

### CR-106 — Duplikasi pola kecil (server & web)

- **Type:** cleanliness / reuse
- **Severity:** low
- **Location:** `apps/server/src/api/routes.ts` (eval `asStr(body[x])` ganda + `!`); `apps/web/src/components/{CompanySetup,DepartmentBuilder,CharacterEditor}.tsx` (pola `setBusy/try/catch/finally`); `DepartmentBuilder.tsx` (`templates.find` 3×)
- **Status:** OPEN

**Temuan**
1. Handler memanggil `asStr(body["x"])` dua kali (guard + baca dengan `!`) → hitung ganda + non-null assertion rapuh.
2. Pola busy/error `run()` disalin di 3 komponen; handler delete malah tak reset error/busy (inkonsistensi).
3. `templates.find(...)` dipanggil 3× berurutan untuk lookup yang sama.

**Usulan** (1) `const name = asStr(body["x"]); if (name) patch.x = name;` (hitung sekali, tanpa `!`). (2) Hook `useAsyncAction()` bersama `{ busy, error, run }`. (3) `const selected = templates.find(...)` sekali.

---

### CR-107 — `walkTo` set `obj.tile` sebelum tween selesai

- **Type:** correctness-minor
- **Severity:** low
- **Location:** `apps/web/src/game/OfficeScene.ts` (`walkTo`)
- **Status:** OPEN

**Temuan** `obj.tile` di-set ke tujuan saat path ditemukan (sinkron), padahal tween masih berjalan ~1.4s. Selama animasi, tile logis = tujuan → klik di tile yang terlihat tak memilih karakter; klik tujuan dianggap "sudah di sana".

**Kenapa penting** Hanya memengaruhi seleksi/HUD saat berjalan (kosmetik), bukan posisi akhir. Rendah.

**Usulan** Set `obj.tile` di `onComplete` tween, atau pisahkan "tile visual" vs "tile tujuan".

---

### CR-108 — Socket re-subscribe & window `onMutate` sebelum hub siap

- **Type:** robustness
- **Severity:** low
- **Location:** `apps/web/src/App.tsx` (socket per ganti company), `apps/web/src/socket.ts`, `apps/server/src/main.ts` (`realtimeRef.hub` di-set setelah `listen`)
- **Status:** OPEN

**Temuan** (a) Tiap ganti company membuat socket baru & subscribe ulang; saat reconnect cepat bisa sesaat join 2 room. (b) Mutasi yang masuk di celah antara `listen()` resolve dan `realtimeRef.hub` di-assign akan no-op broadcast.

**Kenapa penting** Keduanya skenario sempit & berdampak kecil (snapshot basi sesaat sampai reload). Rendah.

**Usulan** (a) Pakai satu socket bersama + ganti room via emit, atau pastikan disconnect tuntas sebelum subscribe baru. (b) Buat `RealtimeHub` sebelum membuka koneksi (mis. `serverFactory` Fastify) atau antre broadcast singkat.
