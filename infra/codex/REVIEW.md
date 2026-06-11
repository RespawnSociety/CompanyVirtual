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
- Konsistensi kontrak `@vc/shared` ↔ mapping SQLite (`apps/server/src/db/store.ts`).
- Engine **data-driven**: tak ada hardcode "marketing" di `apps/server` (hanya DATA di `packages/templates`).
- Validasi input REST (`apps/server/src/api/routes.ts`); CORS/secrets; **owner-auth absen di REST** (lihat CR-101).
- `node:sqlite` round-trip; clone workflow di seed; boot/lifecycle Phaser (`apps/web/src/game`).
