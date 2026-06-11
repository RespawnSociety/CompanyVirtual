# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

> ⚠️ **Catatan sumber entri Phase 1 (BUG-101..105):** Codex CLI belum terpasang di environment build,
> jadi review 1.9 dijalankan sebagai **self-review oleh Claude** (multi-angle: line-by-line, removed-behavior,
> cross-file, cleanup) lalu **langsung di-fix**. Status entri = `FIXED` (klaim Claude) — **masih perlu
> verifikasi independen oleh Codex** untuk menjadi `VERIFIED_FIXED`.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-101 | Scene Phaser null saat boot → kantor tak pernah render karakter | critical | FIXED | `apps/web/src/game/bootGame.ts` |
| BUG-102 | `applyWorld` tak memindah karakter saat `deskPos` diedit | medium | FIXED | `apps/web/src/game/OfficeScene.ts` |
| BUG-103 | `listCommsByCompany` kembalikan comms semua company (bocor lintas-company) | medium | FIXED | `apps/server/src/db/store.ts` |
| BUG-104 | `clampTile` hasil negatif saat grid belum terbentuk | low | FIXED | `apps/web/src/game/OfficeScene.ts` |
| BUG-105 | Respons `getWorld` basi saat ganti company cepat | low | FIXED | `apps/web/src/App.tsx` |

---

## Entri

### BUG-101 — Scene Phaser null saat boot → kantor tak pernah render karakter

- **Status:** FIXED
- **Severity:** critical
- **Category:** runtime
- **Location:** `apps/web/src/game/bootGame.ts` (lama: ambil scene sinkron) → dampak di `apps/web/src/components/WorldView.tsx`
- **Ditemukan:** 2026-06-11 (self-review Phase 1)

**Deskripsi**
`bootGame` mengambil `game.scene.getScene("office")` **sinkron** tepat setelah `new Phaser.Game()`. Phaser meng-instansiasi scene config secara **asinkron** (diproses di `bootQueue` pada event `READY`, bukan saat konstruksi), sehingga `getScene` mengembalikan `null` dan `handle.scene` = null.

**Bukti**
- `node_modules/phaser/src/scene/SceneManager.js`: scene config masuk `_pending`, lalu `this.keys[key]` baru diisi di `bootQueue` (terikat `GameEvents.READY`); `getScene` mengembalikan null bila `keys[key]` belum ada.
- `WorldView` memanggil `handleRef.current.scene.applyWorld(world, ...)` → `TypeError: Cannot read properties of null`.
- Mekanisme `ready`/`pending` di `OfficeScene` jadi dead code karena React memegang ref null.

**Dampak**
Kantor 2D tak pernah menampilkan karakter — **melanggar DoD Fase 1** ("karakter muncul di lantai & bisa jalan"). Terpicu setiap kali tab Kantor dibuka. (Tak tertangkap smoke test karena smoke test hanya menguji REST + socket, bukan browser.)

**Verifikasi #1 (pembacaan kode)** Telusuri Phaser SceneManager: `_pending` → `bootQueue` (READY) → `keys`. `getScene` sebelum READY = null.
**Verifikasi #2 (cross-file)** Jejak pemanggil di `WorldView`: ref scene null saat `applyWorld` dipanggil → throw.

**Perbaikan yang diterapkan**
`bootGame` kini mengembalikan `getScene()` **lazy** (aman dipanggil kapan pun, null sampai siap). `WorldView` menyimpan world/floor di `ref`, mendaftar `game.events.once("ready", ...)` untuk apply pertama, dan tiap perubahan snapshot memanggil `getScene()?.applyWorld(...)` (buffer `pending` di scene menangani kasus create() belum jalan).

**Catatan verifikasi perbaikan** (diisi Codex) — _menunggu verifikasi browser oleh Codex._

---

### BUG-102 — `applyWorld` tak memindah karakter saat `deskPos` diedit

- **Status:** FIXED
- **Severity:** medium
- **Category:** logic
- **Location:** `apps/web/src/game/OfficeScene.ts` (cabang "existing" di `applyWorld`)
- **Ditemukan:** 2026-06-11 (self-review Phase 1)

**Deskripsi**
Saat snapshot baru masuk dan karakter sudah ada, cabang lama hanya meng-update label & tint — **tidak** memperbarui `obj.tile` maupun posisi container. Edit `deskPos` lewat Character Editor tak tercermin sampai scene dibangun ulang.

**Bukti** Kode lama: `existing.label.setText(...)`, `existing.sprite.setTint(...)` saja. `deskPos` tak dipakai untuk reposisi.

**Dampak** Setelah PATCH agent (Meja X/Y) + broadcast `world:sync`, karakter tetap di meja lama; klik meja baru tak memilihnya. Membingungkan & tampak seperti config tak tersimpan.

**Verifikasi #1** Baca cabang existing — tak ada penggunaan `deskPos`. **Verifikasi #2** Alur PATCH→onMutate→world:sync→applyWorld terbukti memanggil cabang existing.

**Perbaikan yang diterapkan** Cabang existing kini menghitung tile dari `deskPos` (via `clampTile`); bila berbeda, hentikan tween aktif, set `obj.tile`, dan `container.setPosition(...)` ke meja baru.

**Catatan verifikasi perbaikan** — _menunggu Codex._

---

### BUG-103 — `listCommsByCompany` kembalikan comms semua company (bocor lintas-company)

- **Status:** FIXED
- **Severity:** medium
- **Category:** data-loss / security (isolation)
- **Location:** `apps/server/src/db/store.ts`
- **Ditemukan:** 2026-06-11 (self-review Phase 1)

**Deskripsi**
`listCommsByCompany(_companyId)` mengabaikan parameter dan menjalankan `SELECT * FROM comms_messages` tanpa `WHERE` → mengembalikan pesan **semua** company.

**Bukti** Parameter `_companyId` tak terpakai; query tanpa filter. `GET /api/companies/:id/comms` memanggilnya.

**Dampak** Begitu tabel `comms_messages` terisi (Phase 3), Comms Viewer company A akan menampilkan percakapan company B. Latent di Phase 1 (tabel kosong) tapi salah secara kontrak.

**Verifikasi #1** Baca query — tak ada filter company. **Verifikasi #2** Skema `comms_messages` belum punya kolom `company_id` / pemetaan thread→company, jadi scoping memang belum mungkin sekarang.

**Perbaikan yang diterapkan** Karena belum ada pemetaan thread→company dan belum ada produsen comms di Phase 1, method kini mengembalikan `[]` (dengan komentar TODO: scoping per company menyusul Phase 3 bersama tabel `threads`). Aman-secara-default (tak membocorkan apa pun).

**Catatan verifikasi perbaikan** — _menunggu Codex._

---

### BUG-104 — `clampTile` hasil negatif saat grid belum terbentuk

- **Status:** FIXED
- **Severity:** low
- **Category:** logic
- **Location:** `apps/web/src/game/OfficeScene.ts`
- **Ditemukan:** 2026-06-11 (self-review Phase 1)

**Deskripsi** `this.gridW - 2 || 1` → saat `gridW = 0`, hasilnya `-2` (truthy), bukan `1`. Batas atas jadi `-2`, mengembalikan koordinat negatif.

**Bukti** `Math.min(Math.max(1, x), -2)` = `-2`. Terjadi bila tileset gagal register (`addTilesetImage` null) sehingga `buildGrid` dilewati.

**Dampak** Skenario degeneratif (aset map gagal): seluruh klik ditolak / spawn di koordinat negatif — scene mati senyap tanpa error. Robustness.

**Verifikasi #1** Evaluasi ekspresi `gridW-2 || 1` untuk gridW=0. **Verifikasi #2** Jejak: `create()` melewati `buildGrid` saat `tileset` null → gridW tetap 0.

**Perbaikan yang diterapkan** `const maxX = Math.max(1, this.gridW - 2)` (dan maxY) — aman walau grid 0.

**Catatan verifikasi perbaikan** — _menunggu Codex._

---

### BUG-105 — Respons `getWorld` basi saat ganti company cepat

- **Status:** FIXED
- **Severity:** low
- **Category:** concurrency
- **Location:** `apps/web/src/App.tsx`
- **Ditemukan:** 2026-06-11 (self-review Phase 1)

**Deskripsi** Effect pemuat world (`[companyId]`) tak mem-guard respons `api.getWorld(prev)` yang datang setelah company berganti.

**Bukti** `api.getWorld(companyId).then(setWorld)` tanpa pembatalan; promise lama bisa resolve setelah pilihan berubah.

**Dampak** Ganti A→B cepat: snapshot A bisa men-`setWorld` saat UI menampilkan B → render company salah sesaat + churn reset floorId/departmentId.

**Verifikasi #1** Baca effect — tak ada flag ignore. **Verifikasi #2** Skenario async standar (resolve out-of-order).

**Perbaikan yang diterapkan** Tambah flag `ignore` di cleanup effect; respons lama diabaikan.

**Catatan verifikasi perbaikan** — _menunggu Codex._
