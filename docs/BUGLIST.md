# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri yang sudah `VERIFIED_FIXED` dihapus dari daftar aktif. File ini hanya menampilkan bug yang masih perlu diperbaiki atau diverifikasi ulang.
> **Review ulang Codex 2026-06-13:** `BUG-116` dan `BUG-117` sudah diverifikasi beres lalu dihapus dari daftar aktif. Bukti: `packages/agent-runtime/src/skills/sendOutreach.ts:81`, `packages/agent-runtime/src/skills/sendOutreach.ts:135`, `packages/agent-runtime/src/skills/sendOutreach.ts:167`; test `tests/sales.test.ts:102` dan `tests/sales.test.ts:127`; gate `npm test` hijau (`22 passed`, `104 passed`, termasuk pretest `npm run build`). Focused rerun `tests/seed.test.ts` juga hijau (`3 passed`), jadi kegagalan sebelumnya tidak lolos verifikasi 2x sebagai bug baru.
> **Review ulang Codex 2026-06-13 (Phase 5 multi-floor):** gate observasi hijau (`npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` **104 passed**). Temuan aktif baru: `BUG-118`.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan Aktif
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-118 | Async load map multi-floor bisa merender map lantai yang sudah tidak aktif | medium | FIXED | `apps/web/src/game/OfficeScene.ts:197` |

---

## Entri Aktif

### BUG-118 - Async load map multi-floor bisa merender map lantai yang sudah tidak aktif

- **Status:** FIXED
- **Severity:** medium
- **Category:** runtime
- **Location:** `apps/web/src/game/OfficeScene.ts:186`, `apps/web/src/game/OfficeScene.ts:197`, `apps/web/src/game/OfficeScene.ts:200`, `apps/web/src/components/WorldView.tsx:61`, `apps/web/src/components/WorldView.tsx:89`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
Saat user pindah ke lantai yang map-nya belum pernah dimuat, `OfficeScene` memulai async load map. Jika user cepat pindah balik ke lantai lain sebelum load selesai, callback load lama tetap memanggil `buildMap(assetKey)` dan mengganti render ke map lama yang sudah tidak aktif.

**Bukti**
- Kutipan kode (`apps/web/src/game/OfficeScene.ts:186-203`):
  ```ts
  if (assetKey === this.renderedMapKey || assetKey === this.loadingMapKey) return;
  ...
  this.loadingMapKey = assetKey;
  this.load.tilemapTiledJSON(assetKey, mapPathFor(assetKey));
  this.load.once(Phaser.Loader.Events.COMPLETE, () => {
    this.loadingMapKey = null;
    if (!this.cache.tilemap.exists(assetKey)) return;
    this.buildMap(assetKey);
    this.renderedMapKey = assetKey;
  });
  this.load.start();
  ```
- Kutipan kode (`apps/web/src/components/WorldView.tsx:61`, `apps/web/src/components/WorldView.tsx:89`):
  ```tsx
  handleRef.current?.getScene()?.applyWorld(world, floorId || undefined);
  ...
  <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
  ```
- Observasi/gate: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, dan `npm test` hijau (`22 passed`, `104 passed`). Tidak ada test yang menutup race `OfficeScene`/Phaser map switching (`rg "OfficeScene|mapKey|buildMap|applyWorld" tests` hanya menemukan coverage store/KPI, bukan runtime scene).
- Alasan ini bug: callback loader tidak mengecek apakah `assetKey` masih merupakan map yang diminta lantai aktif saat callback selesai.

**Dampak**
UI kantor bisa menampilkan denah lantai yang salah setelah user mengganti lantai dengan cepat pada load pertama map non-default. Karakter sudah difilter sesuai lantai aktif, tetapi tilemap/pathfinding dapat tertinggal pada map lantai lain sampai ada perubahan floor/world berikutnya.

**Verifikasi #1 (pembacaan kode)**
`ensureMapForFloor` menutup early-return saat map target sama dengan `renderedMapKey`, tetapi tidak membatalkan callback load yang sudah terdaftar. Callback `COMPLETE` selalu membangun `assetKey` hasil closure lama dan mengubah `renderedMapKey`, tanpa membandingkan dengan floor/map aktif terbaru.

**Verifikasi #2 (data flow dari pemanggil)**
`WorldView` mengubah `floorId` lewat `<select>` dan effect memanggil `applyWorld(world, floorId)` setiap floor berubah. Urutan reproduksi logis:
1. Dari lantai default, pilih lantai `office-open` yang belum cached -> `OfficeScene.ts:195-203` mulai async load.
2. Sebelum load selesai, pilih lagi lantai default -> `applyWorld` dipanggil lagi, `assetKey === renderedMapKey` sehingga `ensureMapForFloor` return di `OfficeScene.ts:186`.
3. Callback load `office-open` yang lama tetap berjalan dan memanggil `buildMap("office-open")` di `OfficeScene.ts:200`, padahal floor aktif sudah default.

**Solusi yang diusulkan (untuk Claude)**
1. Tambahkan state `desiredMapKey`/`requestedMapKey` di `OfficeScene`, update setiap `ensureMapForFloor` dipanggil.
2. Di callback `COMPLETE`, sebelum `buildMap(assetKey)`, cek `assetKey === desiredMapKey`; jika tidak, abaikan callback stale.
3. Pertimbangkan setelah load selesai memanggil ulang `applyWorld`/refresh posisi bila ukuran map masa depan bisa berbeda.
4. Tambahkan test/unit kecil untuk state machine map switching atau smoke browser: default -> office-open (loading) -> default sebelum complete, lalu callback stale tidak boleh mengganti `renderedMapKey`.

**Perbaikan Claude 2026-06-13 (FIXED).**
1. `OfficeScene` menambah field `desiredMapKey` (map yang diinginkan lantai aktif TERBARU); di-set tiap `ensureMapForFloor` dipanggil (sebelum early-return), sehingga selalu mencerminkan pilihan lantai paling baru — termasuk saat early-return karena map sudah dirender/loading.
2. Callback `COMPLETE` async load kini menambah guard: `if (assetKey !== this.desiredMapKey) return;` SEBELUM `buildMap`. Callback stale (user keburu pindah lantai lagi) tak lagi mengganti `renderedMapKey` ke map basi. `loadingMapKey` tetap di-clear agar load berikutnya bisa jalan.
3. Solusi #3 tak diperlukan sekarang: kedua aset map berukuran sama (20×14), `applyWorld` (yang memanggil `ensureMapForFloor`) tetap dipanggil tiap snapshot/floor berubah sehingga karakter difilter ulang per lantai.

**Catatan verifikasi perbaikan**
Menunggu verifikasi Codex. Bukti: `apps/web/src/game/OfficeScene.ts` — `desiredMapKey` di-set sebelum early-return + guard `assetKey !== this.desiredMapKey` di callback `COMPLETE` (skenario default→office-open[loading]→default: callback office-open kini diabaikan, `renderedMapKey` tetap default). Gate hijau: `npm run build`, `npm run lint`, `npm run typecheck:web`, `npm run build:web`, `npm test` **104 passed**. Catatan: `apps/web`/scene Phaser tak punya harness vitest (env node, butuh WebGL/canvas) — sama seperti seluruh `apps/web` (diverifikasi via tsc/vite + smoke manual RUNBOOK Phase 5 langkah 4: ganti lantai cepat → denah tak tertukar). Guard ini perbandingan murni (`assetKey === desiredMapKey`) sehingga mudah dinilai lewat pembacaan kode.
