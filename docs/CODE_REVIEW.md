# CODE_REVIEW - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Berisi temuan **kualitas/kebersihan kode** (bukan bug fungsional - bug ada di `docs/BUGLIST.md`).
> Codex **tidak** mengubah source code - hanya menulis temuan + usulan; Claude yang menerapkan.

## Fokus penilaian
Optimal? Clean? Ada duplikasi / over-engineering? Penamaan jelas? Konsisten dengan kontrak `packages/shared`? Workflow data-driven (bukan hardcode)? Semua LLM lewat 9Router? Biaya/performa wajar?

## Legenda Status
`OPEN` (usulan, belum dikerjakan) | `ADDRESSED` (Claude klaim sudah dirapikan) | `VERIFIED` (Codex konfirmasi) | `WONTFIX`

## Ringkasan
| ID | Judul | Type | Severity | Status | Location |
|---|---|---|---|---|---|
| CR-001 | Copy approval inline sudah muncul, tetapi belum ada store/resume approval | architecture | medium | ADDRESSED | `apps/server/src/comms/frontDesk.ts:45` |
| CR-002 | Memory mentah dimasukkan ulang ke prompt tanpa batas ukuran | performance | medium | ADDRESSED | `packages/agent-runtime/src/loop.ts:296` |
| CR-003 | Server Cloud masih memakai provider `web_search` mock secara default | consistency | medium | ADDRESSED | `apps/server/src/main.ts:56` |
| CR-004 | Event `skill_start` punya field `args`, tetapi loop tidak mengisinya | cleanliness | low | ADDRESSED | `packages/agent-runtime/src/loop.ts:250` |

---

## Temuan

### CR-001 - Copy approval inline sudah muncul, tetapi belum ada store/resume approval

- **Type:** architecture
- **Severity:** medium
- **Location:** `apps/server/src/comms/frontDesk.ts:45-46`, `apps/server/src/comms/relay.ts:72-79`, `apps/server/src/main.ts:60-66`
- **Status:** ADDRESSED

**Temuan**
`frontDesk.ts` memberi instruksi ke owner untuk membalas `APPROVE` atau `REVISI` saat loop blocked:

```ts
if (res.status === "blocked" && res.pendingApproval) {
  return `Ada aksi yang butuh persetujuanmu: ${res.pendingApproval.summary}. Balas APPROVE atau REVISI.`;
}
```

Namun relay hanya mengirim setiap pesan owner ke handler baru (`relay.ts:72-79`), dan `main.ts:60-66` tidak memasang `requestApproval` custom maupun pending approval store. Untuk Phase 0 ini masih bisa disebut gate struktural, tetapi copy user-facing sudah menjanjikan alur approval inline.

**Kenapa penting**
Ini membingungkan saat skill risky mulai ditambahkan: owner melihat instruksi approval, tetapi balasan berikutnya diperlakukan sebagai directive baru, bukan keputusan atas approval pending. Karena approval inline dijadwalkan Phase 3, lebih bersih jika Phase 0 tidak memberi janji interaksi yang belum ada.

**Usulan perbaikan**
1. Pilih salah satu: implement pending approval store + route `APPROVE`/`REVISI` ke approval yang benar, atau ubah copy Phase 0 menjadi "approval tercatat pending" tanpa menyuruh owner membalas.
2. Saat implementasi penuh, simpan `ApprovalRequest.id`, `threadId`/sender, dan state resume agar approval tidak ambigu.

**Perbaikan Claude (2026-06-10)**
- Diambil opsi (1)-varian-ringan: pending-approval store/resume dijadwalkan Phase 3, jadi untuk Phase 0 cukup ubah copy agar tidak menjanjikan alur inline yang belum ada.
- `apps/server/src/comms/frontDesk.ts:45-51`: balasan blocked kini "Aksi ini butuh persetujuan dan sudah ditandai pending: …. Aku tahan dulu — alur approve/revisi via WhatsApp menyusul." (tidak lagi menyuruh owner balas `APPROVE`/`REVISI`).
- Store/resume `ApprovalRequest.id` + thread/sender tetap menjadi pekerjaan Phase 3 (di luar scope perbaikan ini).

### CR-002 - Memory mentah dimasukkan ulang ke prompt tanpa batas ukuran

- **Type:** performance
- **Severity:** medium
- **Location:** `packages/agent-runtime/src/loop.ts:296-298`, `packages/agent-runtime/src/loop.ts:323-338`
- **Status:** ADDRESSED

**Temuan**
Loop menyimpan user message dan final reply penuh ke memory:

```ts
text: `Arahan masuk: ${userMessage}`,
...
text: `Balasan agent: ${finalText}`,
```

Lalu retrieval memasukkan teks memory mentah kembali ke system prompt:

```ts
for (const m of recalled) lines.push(`- (${m.kind}) ${m.text}`);
```

Belum ada batas panjang per memory item, ringkasan, atau budget token prompt.

**Kenapa penting**
Biaya LLM adalah fokus Phase 0/plan. Dengan percakapan panjang, lima memory item saja bisa membawa payload besar ke setiap request 9Router. Ini membuat biaya dan latency naik tanpa kontrol, terutama karena front-desk auto-reply dapat dipakai berulang lewat WhatsApp.

**Usulan perbaikan**
1. Tambahkan batas panjang saat menulis atau saat memasukkan memory ke prompt, misalnya truncate aman per item.
2. Simpan ringkasan terpisah untuk `result` panjang, bukan full reply.
3. Tambahkan opsi `memoryPromptBudgetChars`/`memoryPromptBudgetTokens` di deps/config agar mudah dituning.

**Perbaikan Claude (2026-06-10)**
- `packages/agent-runtime/src/loop.ts`: tambah opsi `RunAgentLoopDeps.memoryItemMaxChars` (default 500). Truncate diterapkan dua sisi: (a) `buildSystemPrompt` men-truncate tiap memory item yang di-inject ke prompt; (b) `persistMemory` menyimpan teks arahan/balasan yang sudah di-truncate (bukan full reply).
- Test baru di `tests/loop.test.ts` ("CR-002: memory panjang ..."): memory 5000 char + `memoryItemMaxChars: 100` → system prompt < 500 char dan tidak memuat teks utuh.
- Catatan: budget berbasis char (bukan token); opsi `memoryPromptBudgetTokens` bisa menyusul bila perlu kontrol lebih halus.

### CR-003 - Server Cloud masih memakai provider `web_search` mock secara default

- **Type:** consistency
- **Severity:** medium
- **Location:** `apps/server/src/main.ts:56`, `packages/agent-runtime/src/skills/webSearch.ts:47-60`, `apps/server/src/comms/frontDesk.ts:24-27`
- **Status:** ADDRESSED

**Temuan**
Server selalu mendaftarkan `createWebSearchSkill()` tanpa provider:

```ts
const skills = new SkillRegistry().register(createWebSearchSkill());
```

Default provider di `webSearch.ts` adalah mock deterministik yang mengembalikan URL `example.com`, sementara persona front desk menyuruh agent memakai tool bila perlu informasi terkini.

**Kenapa penting**
Untuk mode test, mock bagus. Untuk `WA_ADAPTER=cloud`, owner bisa menerima "hasil pencarian" palsu dari tool bernama `web_search`. Ini bukan hardcode departemen, tetapi nama skill dan copy persona membuat perilaku terlihat seperti pencarian nyata.

**Usulan perbaikan**
1. Pilih provider berdasarkan env, misalnya `WEB_SEARCH_PROVIDER=mock|real`.
2. Di mode cloud, gagal start jika provider real belum dikonfigurasi, atau ubah persona/copy agar jelas bahwa search masih mock.
3. Pertahankan mock untuk unit test dan spike deterministik.

**Perbaikan Claude (2026-06-10)**
- Memakai env yang sudah ada di `.env.example`: `WEB_SEARCH_MODE` (bukan var baru). `apps/server/src/main.ts` membaca `WEB_SEARCH_MODE` (default `mock`); nilai selain `mock` → server **gagal start** dengan pesan jelas (provider nyata = Phase 4+), jadi cloud tidak diam-diam memakai mock.
- Di mode `WA_ADAPTER=cloud`, tambah `console.warn` eksplisit bahwa `web_search` masih MOCK.
- Mock dipertahankan untuk unit test/spike (default). `.env.example` diperjelas bahwa kini hanya `mock` yang didukung.

### CR-004 - Event `skill_start` punya field `args`, tetapi loop tidak mengisinya

- **Type:** cleanliness
- **Severity:** low
- **Location:** `packages/shared/src/events.ts:24-28`, `packages/agent-runtime/src/loop.ts:250`
- **Status:** ADDRESSED

**Temuan**
Kontrak event menyediakan argumen ringkas pada `AgentSkillStartEvent`:

```ts
args?: Record<string, unknown>;
```

Namun loop mengemit `skill_start` tanpa argumen:

```ts
emit({ type: "skill_start", agentId: agent.id, at: now(), skill: name });
```

**Kenapa penting**
Observability Phase 0 sudah mulai ada lewat event bus. Tanpa argumen ringkas, Agent Inspector/log sulit menjelaskan tool dipanggil dengan input apa. Kontrak juga terlihat tidak konsisten dengan implementasi.

**Usulan perbaikan**
1. Isi `args` dengan versi sanitized/truncated dari argumen tool yang sudah di-parse.
2. Hindari memasukkan secret mentah; gunakan denylist/allowlist per skill bila perlu.

**Perbaikan Claude (2026-06-10)**
- `packages/agent-runtime/src/loop.ts`: emit `skill_start` kini menyertakan `args: summarizeArgs(args)`. Helper `summarizeArgs` me-redact key yang terlihat seperti secret (regex `token|secret|password|api[_-]?key|authorization|credential`) dan men-truncate nilai string panjang (120 char).
- Test baru di `tests/loop.test.ts` ("CR-004: skill_start membawa args ringkas") memverifikasi `args` berisi `{ query, limit }`.
