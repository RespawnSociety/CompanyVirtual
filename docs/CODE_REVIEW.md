# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED` umumnya dihapus dari daftar aktif setelah dicek ulang; entri verified yang masih tertulis dipertahankan sebagai bukti verifikasi terbaru.
> **Catatan review ulang Phase 0-3 2026-06-13:** build, lint, web typecheck, dan `npm test` (59 passed) lulus. Review ulang `WorkflowEngine`, `workflow_runs`, approval endpoints, runtime loop, router/skill path, dan `WorkflowPanel` tidak menemukan temuan kualitas-only baru yang cukup kuat untuk masuk file ini. `BUG-112/113` sudah diverifikasi beres dan dihapus dari daftar aktif `docs/BUGLIST.md`; saat itu `CR-101` masih menunggu keputusan strategi auth bersama `BUG-107/108`.
> **Catatan Phase 4 2026-06-13:** `CR-101` diverifikasi `VERIFIED`. Gate: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run build:web`, `npm test` **87 passed**. Review keamanan Phase 4 tidak menemukan temuan kualitas-only baru; temuan fungsional/security dicatat di `docs/BUGLIST.md`.

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`?
Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| CR-101 | Arsitektur auth REST/web/realtime belum satu jalur | architecture/security | high | VERIFIED | `apps/server/src/security/auth.ts`, `apps/server/src/server.ts`, `apps/server/src/realtime.ts`, `apps/web/src/api.ts`, `apps/web/src/socket.ts` |

---

## Temuan

### CR-101 - Arsitektur auth REST/web/realtime belum satu jalur

- **Type:** architecture / security
- **Severity:** high
- **Location:** `apps/server/src/security/auth.ts`, `apps/server/src/server.ts`, `apps/server/src/realtime.ts`, `apps/web/src/api.ts`, `apps/web/src/socket.ts`
- **Status:** VERIFIED

**Temuan**
REST kini punya bearer gate opsional via `API_AUTH_TOKEN`, dan `main.ts` menolak bind non-loopback tanpa token. Namun auth belum menjadi boundary bersama: web REST client belum mengirim token (`BUG-107`) dan realtime socket belum ikut divalidasi (`BUG-108`).

**Kenapa penting**
Plan pasal 8 menuntut least-privilege. Kalau REST, socket, dan web client memakai mekanisme berbeda, mudah ada jalur yang aman di satu protokol tetapi bocor di protokol lain.

**Usulan perbaikan**
Setelah `BUG-107` dan `BUG-108` diperbaiki, satukan helper auth untuk REST + Socket.IO, dokumentasikan mode dev vs hosting, dan tambahkan test lintas protokol.

**Diterapkan sebagian (Claude 2026-06-11)**
Mekanisme dasar sudah ada: bearer gate `/api/*` via `API_AUTH_TOKEN` (`apps/server/src/server.ts`), penolakan bind non-loopback tanpa token (`apps/server/src/main.ts`), header CORS `authorization`, dan dokumentasi `.env.example`. **Belum** ditutup: web client belum mengirim bearer (`BUG-107`) dan socket realtime belum tervalidasi (`BUG-108`). Keduanya butuh keputusan strategi auth web (token build-time vs reverse-proxy vs login) - CR-101 tetap `OPEN` sampai itu diputuskan.

**ADDRESSED (Claude 2026-06-13 — Phase 4).**
Owner memilih **token dev build-time**. Auth kini SATU jalur lintas-protokol:
1. Helper tunggal `apps/server/src/security/auth.ts` (`safeEqual`, `hasValidBearer`, `hasValidSocketToken`) dipakai BERSAMA oleh REST (`server.ts`) dan Socket.IO (`realtime.ts` `io.use`).
2. Web mengirim token yang sama untuk REST (`api.ts` `Authorization: Bearer`) **dan** socket (`socket.ts` `auth.token`), sumber tunggal `AUTH_TOKEN` (`VITE_API_AUTH_TOKEN`).
3. Test lintas-protokol: `tests/auth.test.ts` (unit helper + integrasi realtime tolak/terima).

Mode dev vs hosting terdokumentasi di `.env.example` (token bundle = dev/token bersama; produksi → reverse-proxy/login).

**VERIFIED (Codex 2026-06-13).**
Verifikasi kode: helper tunggal `apps/server/src/security/auth.ts:19-36` dipakai REST via `apps/server/src/server.ts:63` dan realtime via `apps/server/src/realtime.ts:37-46`; web memakai sumber token yang sama di `apps/web/src/api.ts:48-58` dan `apps/web/src/socket.ts:37`. Verifikasi observasi: `tests/auth.test.ts:19-30` menutup helper bearer/socket token, `tests/auth.test.ts:66-83` menutup socket tanpa token ditolak dan token valid diterima, serta gate Phase 4 lulus `npm test` **87 passed**.
