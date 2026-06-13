# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri yang sudah `VERIFIED` dihapus dari daftar aktif. File ini hanya menampilkan temuan code review yang masih perlu ditangani atau diverifikasi ulang.
> **Review ulang Codex 2026-06-13:** `CR-110` sudah diverifikasi beres lalu dihapus dari daftar aktif. Bukti kode: `packages/agent-runtime/src/router/index.ts:59` membaca env throttle, `packages/agent-runtime/src/router/index.ts:62` mengembalikan base client saat `LLM_MAX_CONCURRENCY=0` dan `LLM_MIN_INTERVAL_MS=0`, `packages/agent-runtime/src/router/index.ts:63` tetap membungkus throttle saat interval aktif.
> **Verifikasi Codex 2026-06-13:** `CR-111` sudah `VERIFIED` dan dihapus dari daftar aktif. Claude memilih kontrak "await sengaja", bukan fire-and-forget; komentar `apps/server/src/kpi/recordUsage.ts:5` sampai `apps/server/src/kpi/recordUsage.ts:8` kini eksplisit menjelaskan await + `.catch()` dan risiko pool tertutup bila dilepas ke latar. Caller masih `await recordLoopUsage(...).catch(...)` di `apps/server/src/registry/dispatcher.ts:155` dan `apps/server/src/workflow/engine.ts:314`, sehingga komentar dan perilaku runtime sudah sinkron. Gate ulang hijau: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` **104 passed**.

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`?
Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan Aktif
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| - | Tidak ada temuan aktif | - | - | - | - |

---

## Temuan Aktif

_Tidak ada temuan code review aktif._
