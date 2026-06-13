# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri yang sudah `VERIFIED` dihapus dari daftar aktif. File ini hanya menampilkan temuan code review yang masih perlu ditangani atau diverifikasi ulang.
> **Review ulang Codex 2026-06-13:** `CR-110` sudah diverifikasi beres lalu dihapus dari daftar aktif. Bukti kode: `packages/agent-runtime/src/router/index.ts:59` membaca env throttle, `packages/agent-runtime/src/router/index.ts:62` mengembalikan base client saat `LLM_MAX_CONCURRENCY=0` dan `LLM_MIN_INTERVAL_MS=0`, `packages/agent-runtime/src/router/index.ts:63` tetap membungkus throttle saat interval aktif. Probe runtime `npx tsx` mengonfirmasi mode off menghasilkan `NineRouterClient` dan bukan `ThrottledRouterClient`.

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`?
Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan Aktif
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| CR-111 | `recordLoopUsage` diklaim fire-and-forget tetapi caller tetap menunggu insert KPI | performance / consistency | low | OPEN | `apps/server/src/registry/dispatcher.ts:155`, `apps/server/src/workflow/engine.ts:314` |

---

## Temuan Aktif

### CR-111 - `recordLoopUsage` diklaim fire-and-forget tetapi caller tetap menunggu insert KPI

- **Type:** performance / consistency
- **Severity:** low
- **Location:** `apps/server/src/kpi/recordUsage.ts:4`, `apps/server/src/registry/dispatcher.ts:155`, `apps/server/src/workflow/engine.ts:314`
- **Status:** OPEN

**Temuan**
Komentar kontrak menyebut pencatatan usage sebagai fire-and-forget, tetapi dua caller utama tetap `await` proses insert usage.

Bukti:
```ts
// apps/server/src/kpi/recordUsage.ts:4
// Fire-and-forget di pemanggil: kegagalan pencatatan biaya TIDAK boleh menggagalkan kerja agent.

// apps/server/src/registry/dispatcher.ts:155
await recordLoopUsage(

// apps/server/src/workflow/engine.ts:314
await recordLoopUsage(
```

**Kenapa penting**
Error memang sudah di-`catch`, tetapi latency/keterlambatan DB `usage_events` tetap ikut menahan penyelesaian task/directive/workflow step. Ini juga membuat komentar dan perilaku runtime tidak sinkron, sehingga fixer berikutnya bisa salah mengasumsikan pencatatan KPI tidak berada di jalur kritis.

**Usulan perbaikan**
Pilih salah satu kontrak:
1. Jika benar ingin fire-and-forget, ubah caller menjadi `void recordLoopUsage(...).catch(...)` dan pastikan logging error tetap ada.
2. Jika sengaja ingin menunggu agar usage pasti tersimpan sebelum status final, ubah komentar `recordUsage.ts` dan komentar caller supaya tidak menyebut fire-and-forget.
3. Tambahkan test kecil dengan store `addUsageEvent` yang tertahan/reject untuk memastikan perilaku yang dipilih: tidak menunda jalur kerja, atau sengaja menunggu.
