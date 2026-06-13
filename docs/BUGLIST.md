# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri yang sudah `VERIFIED_FIXED` dihapus dari daftar aktif. File ini hanya menampilkan bug yang masih perlu diperbaiki atau diverifikasi ulang.
> **Review ulang Codex 2026-06-13:** `BUG-116` dan `BUG-117` sudah diverifikasi beres lalu dihapus dari daftar aktif. Bukti: `packages/agent-runtime/src/skills/sendOutreach.ts:81`, `packages/agent-runtime/src/skills/sendOutreach.ts:135`, `packages/agent-runtime/src/skills/sendOutreach.ts:167`; test `tests/sales.test.ts:102` dan `tests/sales.test.ts:127`; gate `npm test` hijau (`22 passed`, `104 passed`, termasuk pretest `npm run build`).
> **Verifikasi Codex 2026-06-13:** `BUG-118` sudah `VERIFIED_FIXED` dan dihapus dari daftar aktif. Bukti: `apps/web/src/game/OfficeScene.ts:64` menambah `desiredMapKey`, `apps/web/src/game/OfficeScene.ts:190` meng-update target terbaru sebelum early-return, dan `apps/web/src/game/OfficeScene.ts:207` mengabaikan callback load stale sebelum `buildMap`. Gate ulang hijau: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` **104 passed**.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan Aktif
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| - | Tidak ada bug aktif | - | - | - |

---

## Entri Aktif

_Tidak ada entri bug aktif._
