# Perbaikan 2026-06-10 — Ringkasan untuk Dipelajari

> Dikerjakan oleh **Claude Code (Fixer)** berdasarkan `docs/BUGLIST.md` (3 bug) dan
> `docs/CODE_REVIEW.md` (4 temuan kualitas) yang ditulis Codex.
> Semua perbaikan sudah lolos `build` + `test` (30 test hijau) + `lint`.
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

## Daftar isi cepat

| ID | Jenis | Severity | File utama | Inti perbaikan |
|---|---|---|---|---|
| BUG-001 | bug runtime | high | `apps/server/src/server.ts` | Webhook balas 200 **segera** + dedup `messageId` + proses di background |
| BUG-002 | bug logic | medium | `packages/agent-runtime/src/loop.ts` | `break` saat approval tertahan → tool berikutnya tidak ikut jalan |
| BUG-003 | bug runtime | medium | `packages/agent-runtime/src/loop.ts` | `try/catch` → status tidak nyangkut `working` saat error |
| CR-001 | kualitas (arsitektur) | medium | `apps/server/src/comms/frontDesk.ts` | Copy approval Phase 0 tidak lagi menjanjikan alur yang belum ada |
| CR-002 | kualitas (performa) | medium | `packages/agent-runtime/src/loop.ts` | Truncate memory per item → prompt tidak membengkak (biaya LLM) |
| CR-003 | kualitas (konsistensi) | medium | `apps/server/src/main.ts` | `web_search` mock dipilih via env + warning jelas di mode cloud |
| CR-004 | kualitas (kebersihan) | low | `packages/agent-runtime/src/loop.ts` | Event `skill_start` kini mengisi `args` (sanitized) |

---

## Cara kerja repo ini (konteks)

Pembagian peran (lihat `AGENTS.md`):

- **Codex** = Reviewer & Bug Hunter. Read-only; hanya menulis ke `docs/BUGLIST.md` & `docs/CODE_REVIEW.md`.
- **Claude (saya)** = Fixer. Mengubah source code, lalu menandai entri `FIXED` (bug) / `ADDRESSED` (code review).

Alur: Codex menulis bug terverifikasi 2x → Claude memperbaiki → Codex memverifikasi (`VERIFIED_FIXED`).

---

## BUG-001 — Webhook WhatsApp menunggu relay/LLM sebelum balas 200 (high)

**Masalah.** Komentar di `server.ts` berjanji "balas 200 cepat agar Meta tidak retry", tapi
handler POST melakukan `await deps.relay.handleInbound(msg)` di dalam request — dan relay itu
menjalankan agent loop + panggilan 9Router (timeout default 60 detik). Jadi respons HTTP baru
keluar **setelah** semua pemrosesan LLM selesai.

**Kenapa berbahaya.** Kalau 9Router lambat/offline, Meta menganggap webhook gagal lalu mengirim
ulang pesan yang sama → directive owner diproses berkali-kali, LLM dipanggil ulang, memory ganda,
balasan duplikat.

**Perbaikan** (`apps/server/src/server.ts`):
1. Parse payload → **dedup** berdasarkan `messageId` (cache FIFO terbatas, kelas `SeenMessageIds`,
   default kapasitas 1000) → langsung `reply.code(200).send({ received, accepted })`.
2. `relay.handleInbound()` dipanggil **tanpa `await`** (`void ...catch(log)`), jadi ack tidak
   menunggu LLM/9Router/kirim WhatsApp. Error background tetap di-log, tidak memengaruhi 200.

```ts
// SEBELUM: menunggu seluruh pemrosesan sebelum 200
for (const msg of messages) outcomes.push(await deps.relay.handleInbound(msg));
return reply.code(200).send({ received: messages.length, outcomes });

// SESUDAH: ack dulu, proses di background
const fresh = messages.filter(/* drop messageId yang sudah pernah masuk */);
for (const msg of fresh) {
  void deps.relay.handleInbound(msg).catch((err) => app.log.error(err));
}
return reply.code(200).send({ received: messages.length, accepted: fresh.length });
```

**Bukti.** `tests/server.test.ts`: (a) handler yang sengaja **tidak pernah resolve** → POST tetap
balas 200 (bukti tidak menunggu); (b) dua POST dengan `messageId` sama → handler hanya jalan sekali,
response kedua `accepted: 0`.

**Pelajaran.** Untuk webhook provider (Meta/Stripe/dll): **ack dulu, kerja belakangan**. Pisahkan
"menerima" dari "memproses". Dan selalu **idempoten** terhadap retry (dedup by id), karena retry itu
normal, bukan kejadian langka.

---

## BUG-002 — Approval gate tetap menjalankan tool berikutnya setelah aksi berisiko tertahan (medium)

**Masalah.** Bila model mengembalikan beberapa `tool_calls` dalam satu respons, loop memprosesnya
dalam `for (const call of calls)`. Saat tool risky tertahan approval, kode menandai `blocked = true`
tapi **tidak `break`** — sehingga tool berikutnya di batch yang sama tetap dieksekusi sebelum loop
berhenti. Approval gate seharusnya titik **pause**.

**Perbaikan** (`packages/agent-runtime/src/loop.ts`): `break` segera saat `outcome.blockedApproval`
terisi.

```ts
if (outcome.blockedApproval) {
  blocked = true;
  pendingApproval = outcome.blockedApproval;
  break; // PAUSE: jangan eksekusi tool berikutnya dalam batch yang sama
}
```

**Bukti.** `tests/loop.test.ts` ("BUG-002 ..."): satu respons berisi `publish` (risky) + `safe_note`
(non-risky) → `safe_note` **tidak** dieksekusi, `toolRuns` hanya 1, status `blocked`.

**Pelajaran.** Saat sebuah iterasi memutuskan "berhenti", set flag **dan** keluar dari loop di titik
itu juga. Flag tanpa `break` = efek samping yang tetap jalan. Untuk gate keamanan, ini bukan kosmetik.

---

## BUG-003 — Status agent nyangkut `working` saat router/memory error (medium)

**Masalah.** `runAgentLoop` emit status `working` di awal, tapi tanpa `try/catch/finally`. Kalau
`memory.retrieve()` atau `router.chat()` melempar, fungsi keluar sebelum emit status akhir → konsumen
event (UI/animasi) melihat agent terus `working` padahal sudah gagal.

**Perbaikan** (`packages/agent-runtime/src/loop.ts`): bungkus body utama dengan `try/catch`. Saat
error: emit `{ type: "error", message }` lalu `{ type: "status", status: "idle" }`, kemudian
**re-throw** agar `frontDesk.ts` tetap mengirim balasan graceful ke owner (kontrak caller dijaga).

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  emit({ type: "error", agentId: agent.id, at: now(), message });
  emit({ type: "status", agentId: agent.id, at: now(), status: "idle" });
  throw err; // front desk yang ubah jadi pesan ramah
}
```

**Bukti.** `tests/loop.test.ts` ("BUG-003 ..."): router yang selalu reject → urutan status
`working → idle`, ada event `error`, dan fungsi tetap reject (caller bisa menangani).

**Pelajaran.** State yang "dinyalakan" di awal (status, spinner, lock) butuh jaminan "dimatikan"
di semua jalur keluar — itulah gunanya `try/catch/finally`. Pisahkan **observability** (emit error)
dari **propagasi** (re-throw) supaya kontrak pemanggil tidak berubah.

---

## CR-001 — Copy approval menjanjikan alur yang belum ada (kualitas, medium)

**Masalah.** Saat blocked, front desk membalas "Balas APPROVE atau REVISI", padahal Phase 0 belum
punya pending-approval store / resume. Balasan owner berikutnya diperlakukan sebagai directive baru,
bukan keputusan approval → membingungkan.

**Keputusan.** Approval inline dijadwalkan **Phase 3**. Daripada membangun store/resume sekarang
(di luar scope Phase 0), saya pilih merapikan **copy** agar tidak menjanjikan interaksi yang belum
ada.

**Perbaikan** (`apps/server/src/comms/frontDesk.ts`): balasan jadi
*"Aksi ini butuh persetujuan dan sudah ditandai pending: …. Aku tahan dulu — alur approve/revisi via
WhatsApp menyusul."* Store/resume `ApprovalRequest.id` + thread/sender tetap pekerjaan Phase 3.

**Pelajaran.** Jangan menulis copy yang menjanjikan fitur yang belum diimplementasi. Untuk MVP/Phase
awal, lebih jujur bilang "tercatat, menyusul" daripada memberi instruksi yang tidak akan berfungsi.

---

## CR-002 — Memory mentah dimasukkan ke prompt tanpa batas ukuran (kualitas, medium)

**Masalah.** Loop menyimpan arahan & balasan **penuh** ke memory, lalu memasukkan teks memory mentah
kembali ke system prompt tanpa batas. Percakapan panjang → payload besar ke tiap request 9Router →
biaya & latency naik tanpa kontrol.

**Perbaikan** (`packages/agent-runtime/src/loop.ts`):
- Opsi baru `RunAgentLoopDeps.memoryItemMaxChars` (default 500).
- Truncate dua sisi: saat **inject** ke prompt (`buildSystemPrompt`) dan saat **menyimpan**
  (`persistMemory`).

**Bukti.** `tests/loop.test.ts` ("CR-002 ..."): memory 5000 char + `memoryItemMaxChars: 100` →
system prompt < 500 char, teks utuh tidak ikut.

**Pelajaran.** Apa pun yang masuk ke prompt LLM = biaya nyata per token, per request. Beri **budget
eksplisit** (dan bisa dituning) untuk konteks yang di-inject, jangan biarkan tumbuh ikut data.

---

## CR-003 — Server cloud diam-diam pakai `web_search` mock (kualitas, medium)

**Masalah.** Server selalu mendaftarkan `createWebSearchSkill()` tanpa provider → default mock
(hasil `example.com`). Di `WA_ADAPTER=cloud`, owner bisa menerima "hasil pencarian" palsu yang
terlihat nyata.

**Perbaikan** (`apps/server/src/main.ts`): baca env `WEB_SEARCH_MODE` (sudah ada di `.env.example`),
default `mock`. Nilai selain `mock` → server **gagal start** dengan pesan jelas (provider nyata =
Phase 4+), jadi cloud tidak diam-diam pakai mock. Di mode cloud, tambah `console.warn` eksplisit
bahwa `web_search` masih MOCK.

**Pelajaran.** Default yang aman untuk test (mock) bisa jadi jebakan di produksi. Buat pilihan
**eksplisit lewat config**, dan **fail fast** kalau diminta mode yang belum didukung — lebih baik
gagal start daripada diam-diam memberi data palsu.

---

## CR-004 — Event `skill_start` punya field `args` tapi tidak diisi (kualitas, low)

**Masalah.** Kontrak `AgentSkillStartEvent` menyediakan `args?`, tapi loop emit tanpa argumen →
Agent Inspector/log tidak tahu tool dipanggil dengan input apa.

**Perbaikan** (`packages/agent-runtime/src/loop.ts`): emit `skill_start` dengan
`args: summarizeArgs(args)`. Helper `summarizeArgs` me-**redact** key yang terlihat seperti secret
(`token|secret|password|api[_-]?key|authorization|credential`) dan men-**truncate** nilai string
panjang (120 char).

**Bukti.** `tests/loop.test.ts` ("CR-004 ..."): `args` berisi `{ query, limit }`.

**Pelajaran.** Observability itu fitur. Tapi saat melog argumen, **sanitasi dulu** (redact secret,
batasi ukuran) — log bukan tempat kebocoran kredensial.

---

## Cara memverifikasi sendiri

```bash
npm run build      # tsc --build → harus tanpa error
npm test           # vitest → 30 test hijau (otomatis build dulu)
npm run lint       # eslint → bersih
```

File test yang relevan: `tests/loop.test.ts` (BUG-002, BUG-003, CR-002, CR-004) dan
`tests/server.test.ts` (BUG-001 ack cepat + dedup).

## Berkas yang berubah

- `packages/agent-runtime/src/loop.ts` — BUG-002, BUG-003, CR-002, CR-004
- `apps/server/src/server.ts` — BUG-001
- `apps/server/src/comms/frontDesk.ts` — CR-001
- `apps/server/src/main.ts` — CR-003
- `.env.example` — klarifikasi `WEB_SEARCH_MODE`
- `tests/loop.test.ts`, `tests/server.test.ts` — test regresi
- `docs/BUGLIST.md`, `docs/CODE_REVIEW.md` — status `FIXED`/`ADDRESSED` + catatan
