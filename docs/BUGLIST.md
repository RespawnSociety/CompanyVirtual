# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri sudah lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-001 | Webhook WhatsApp menunggu relay/LLM sebelum ack 200 | high | FIXED | `apps/server/src/server.ts:38` |
| BUG-002 | Approval gate tetap menjalankan tool call berikutnya setelah risky tool tertahan | medium | FIXED | `packages/agent-runtime/src/loop.ts:137` |
| BUG-003 | Agent status bisa tersangkut `working` saat router/memory melempar error | medium | FIXED | `packages/agent-runtime/src/loop.ts:79` |

---

## Entri

### BUG-001 - Webhook WhatsApp menunggu relay/LLM sebelum ack 200

- **Status:** FIXED
- **Severity:** high
- **Category:** runtime
- **Location:** `apps/server/src/server.ts:38`, `apps/server/src/server.ts:43`, `apps/server/src/server.ts:45`, `packages/agent-runtime/src/router/nineRouter.ts:69`
- **Ditemukan:** 2026-06-10 oleh Codex

**Deskripsi**
Endpoint POST webhook WhatsApp mengklaim akan membalas 200 cepat agar Meta tidak retry, tetapi handler HTTP menunggu seluruh `relay.handleInbound()` selesai. Pada jalur nyata, relay menjalankan agent loop dan panggilan 9Router sebelum response 200 dikirim.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:38`):
  ```ts
  // Inbound pesan (Meta POST). Selalu balas 200 cepat agar Meta tidak retry.
  app.post(path, async (req, reply) => {
    const messages = parseCloudWebhook(req.body);
    const outcomes = [];
    for (const msg of messages) {
      outcomes.push(await deps.relay.handleInbound(msg));
    }
    return reply.code(200).send({ received: messages.length, outcomes });
  });
  ```
- Jalur relay nyata dibuat dari agent loop (`apps/server/src/main.ts:60`):
  ```ts
  const handler = createAgentReplyHandler(manager, {
    router,
    skills,
    memory,
  });
  ```
- Router punya timeout default 60 detik per request (`packages/agent-runtime/src/router/nineRouter.ts:69`) dan loop default dapat memanggil router sampai 6 langkah (`packages/agent-runtime/src/loop.ts:76`, `packages/agent-runtime/src/loop.ts:116`).
- Observasi reproduksi read-only dengan `buildServer()` dan relay palsu yang delay 200 ms:
  ```json
  {
    "elapsedMs": 234,
    "statusCode": 200,
    "body": { "received": 1, "outcomes": [{ "authorized": true, "action": "replied" }] }
  }
  ```
- Alasan ini bug: kontrak lokal di komentar `server.ts:38` adalah ack cepat, tetapi latency response mengikuti waktu pemrosesan relay. Di Cloud API, jalur ini bisa menunggu LLM, fallback router, dan pengiriman balasan WhatsApp sebelum Meta menerima 200.

**Dampak**
Saat 9Router lambat/offline, provider WhatsApp bisa menganggap webhook gagal lalu retry. Akibatnya pesan owner dapat diproses ulang, LLM dipanggil berulang, memory ganda, dan balasan bisa duplikat.

**Verifikasi #1 (pembacaan kode)**
`server.ts:43-45` memakai `await deps.relay.handleInbound(msg)` di dalam request handler sebelum `reply.code(200)`. `main.ts:60-66` menghubungkan relay ke `runAgentLoop`, dan `nineRouter.ts:69` memberi timeout 60 detik per request, sehingga ack HTTP tidak independen dari kerja agent.

**Verifikasi #2 (sudut berbeda)**
Reproduksi lewat `app.inject()` dengan relay palsu yang hanya delay 200 ms menunjukkan response POST baru selesai setelah delay (`elapsedMs: 234`). Ini membuktikan endpoint menunggu handler, bukan meng-ack cepat lalu memproses async.

**Solusi yang diusulkan (untuk Claude)**
1. Ubah `apps/server/src/server.ts` agar POST webhook parse payload, simpan/enqueue message, lalu segera balas 200 tanpa menunggu LLM/send WhatsApp.
2. Jalankan `relay.handleInbound()` di worker/background task dengan error logging terpisah.
3. Tambahkan dedup berbasis `InboundMessage.messageId` sebelum enqueue agar retry Meta tidak menjalankan directive dua kali.
4. Update test server dengan relay delay untuk memastikan response POST tidak menunggu delay tersebut.

**Perbaikan Claude (2026-06-10)**
- `apps/server/src/server.ts`: POST webhook kini parse payload, dedup berbasis `messageId` (cache FIFO terbatas, kelas `SeenMessageIds`), lalu `reply.code(200).send({ received, accepted })` SEGERA. `relay.handleInbound()` dipanggil tanpa `await` (`void ...catch(log)`) sehingga ack tidak menunggu LLM/9Router/kirim WA.
- Test baru `tests/server.test.ts`: (a) handler yang sengaja tak pernah resolve → POST tetap balas 200 (bukti tidak menunggu); (b) dua POST `messageId` sama → `handler` hanya dipanggil sekali, response kedua `accepted: 0`.

**Catatan verifikasi perbaikan** (diisi Codex setelah FIXED)
<kosong>

### BUG-002 - Approval gate tetap menjalankan tool call berikutnya setelah risky tool tertahan

- **Status:** FIXED
- **Severity:** medium
- **Category:** logic
- **Location:** `packages/agent-runtime/src/loop.ts:137`, `packages/agent-runtime/src/loop.ts:148`, `packages/agent-runtime/src/loop.ts:154`
- **Ditemukan:** 2026-06-10 oleh Codex

**Deskripsi**
Jika model mengembalikan beberapa `tool_calls` dalam satu respons dan salah satunya adalah skill `risky` yang belum di-approve, loop menandai `blocked` tetapi tetap melanjutkan iterasi ke tool call berikutnya sebelum berhenti.

**Bukti**
- Kutipan kode (`packages/agent-runtime/src/loop.ts:137`):
  ```ts
  for (const call of calls) {
    const outcome = await handleToolCall(call, { ... });
    toolRuns.push(outcome.run);
    messages.push(outcome.toolMessage);
    if (outcome.blockedApproval) {
      blocked = true;
      pendingApproval = outcome.blockedApproval;
    }
  }

  if (blocked) {
    status = "blocked";
    break;
  }
  ```
- `handleToolCall()` memang mengembalikan `blockedApproval` saat risky skill tidak approved (`packages/agent-runtime/src/loop.ts:228-246`), tetapi caller baru berhenti setelah semua calls diproses.
- Observasi reproduksi read-only: router palsu mengembalikan `publish` (risky, pending) lalu `safe_note` (non-risky). Hasil:
  ```json
  {
    "status": "blocked",
    "toolRuns": [
      { "skill": "publish", "ok": false, "error": "menunggu approval" },
      { "skill": "safe_note", "ok": true }
    ],
    "safeExecuted": true
  }
  ```
- Alasan ini bug: plan pseudocode `virtual-company-platform-plan.md:105` menyatakan saat aksi risky belum approved harus `requestApproval(call); pause`. Implementasi saat ini tidak pause langsung.

**Dampak**
Setelah approval diminta, runtime masih bisa menjalankan tool lain dalam batch yang sama. Ini merusak invariant approval gate sebagai titik pause dan dapat memicu side effect/cost tambahan sebelum owner mengambil keputusan.

**Verifikasi #1 (pembacaan kode)**
`loop.ts:137-152` tidak `break` atau `return` saat `outcome.blockedApproval` ditemukan. Status `blocked` baru diproses di `loop.ts:154-157`, setelah seluruh tool call dalam respons assistant selesai diproses.

**Verifikasi #2 (sudut berbeda)**
Reproduksi dengan `MockRouter` manual menunjukkan tool kedua benar-benar dieksekusi (`safeExecuted: true`) meskipun status akhir `blocked` dan approval pertama masih `pending`.

**Solusi yang diusulkan (untuk Claude)**
1. Di `packages/agent-runtime/src/loop.ts`, hentikan pemrosesan batch segera setelah `outcome.blockedApproval` terisi.
2. Pastikan `messages` hanya berisi tool message untuk call yang sudah diproses sebelum pause.
3. Tambahkan test `runAgentLoop` dengan dua `tool_calls` dalam satu respons: risky pending harus membuat tool berikutnya tidak dieksekusi.

**Perbaikan Claude (2026-06-10)**
- `packages/agent-runtime/src/loop.ts`: di loop `for (const call of calls)`, begitu `outcome.blockedApproval` terisi → set `blocked`/`pendingApproval` lalu `break`. Tool berikutnya dalam batch yang sama tidak lagi dieksekusi; `messages` hanya berisi tool message untuk call yang sudah diproses.
- Test baru di `tests/loop.test.ts` ("BUG-002: dua tool_calls ..."): respons dengan `publish` (risky) + `safe_note` (non-risky) → `safeExecuted === false`, `toolRuns` hanya 1 (publish), status `blocked`.

**Catatan verifikasi perbaikan** (diisi Codex setelah FIXED)
<kosong>

### BUG-003 - Agent status bisa tersangkut `working` saat router/memory melempar error

- **Status:** FIXED
- **Severity:** medium
- **Category:** runtime
- **Location:** `packages/agent-runtime/src/loop.ts:79`, `packages/agent-runtime/src/loop.ts:116`, `packages/agent-runtime/src/loop.ts:168`, `apps/server/src/comms/frontDesk.ts:49`
- **Ditemukan:** 2026-06-10 oleh Codex

**Deskripsi**
`runAgentLoop()` mengemit status `working` di awal, tetapi tidak memakai `try/finally`. Jika `memory.retrieve()` atau `deps.router.chat()` melempar, fungsi keluar sebelum emit status akhir di `loop.ts:168-173`.

**Bukti**
- Kutipan kode (`packages/agent-runtime/src/loop.ts:79`):
  ```ts
  emit({ type: "status", agentId: agent.id, at: now(), status: "working" });
  ```
- Panggilan yang bisa melempar terjadi sebelum status akhir (`packages/agent-runtime/src/loop.ts:82`, `packages/agent-runtime/src/loop.ts:116`):
  ```ts
  const recalled = await deps.memory.retrieve(...);
  const res = await deps.router.chat({ messages, ... });
  ```
- Status akhir hanya dikirim jika fungsi mencapai bagian bawah (`packages/agent-runtime/src/loop.ts:168`):
  ```ts
  emit({
    type: "status",
    agentId: agent.id,
    at: now(),
    status: status === "blocked" ? "blocked" : "idle",
  });
  ```
- Observasi reproduksi read-only dengan router palsu yang throw:
  ```json
  {
    "threw": "router down",
    "events": [
      { "type": "status", "agentId": "a1", "at": 1000, "status": "working" }
    ]
  }
  ```
- Alasan ini bug: kontrak event menyediakan `AgentErrorEvent` (`packages/shared/src/events.ts:62-65`), dan front desk memang menganggap router bisa gagal (`apps/server/src/comms/frontDesk.ts:49-51`), tetapi loop tidak mengemit error/status pemulihan.

**Dampak**
Konsumen event bus/animasi dapat menampilkan agent terus `working` setelah 9Router offline atau memory store gagal. Ini membuat UI dan observability salah, walaupun front desk mengirim balasan graceful ke owner.

**Verifikasi #1 (pembacaan kode)**
Tidak ada `try/catch/finally` yang melindungi area setelah status `working`. Jika `deps.router.chat()` throw di `loop.ts:116`, eksekusi tidak mencapai status akhir di `loop.ts:168-173`.

**Verifikasi #2 (sudut berbeda)**
Reproduksi dengan router palsu yang selalu throw menghasilkan event tunggal `status: working`; tidak ada event `error`, `idle`, atau `blocked`.

**Solusi yang diusulkan (untuk Claude)**
1. Bungkus body utama `runAgentLoop()` dengan `try/catch/finally`.
2. Saat error, emit `{ type: "error", message }` lalu emit status pemulihan (`idle` atau `blocked`, pilih sesuai kontrak UI).
3. Pertahankan perilaku caller: boleh rethrow agar `frontDesk.ts` tetap mengirim pesan graceful, atau return result error eksplisit bila kontrak loop diperluas.
4. Tambahkan test router throw: event akhir tidak boleh berhenti di `working`.

**Perbaikan Claude (2026-06-10)**
- `packages/agent-runtime/src/loop.ts`: body utama (setelah emit `working`) dibungkus `try { ... } catch (err)`. Pada error: emit `{ type: "error", message }` lalu emit `{ type: "status", status: "idle" }`, kemudian `throw err` (re-throw) agar `frontDesk.ts` tetap mengirim balasan graceful ke owner.
- Test baru di `tests/loop.test.ts` ("BUG-003: router throw ..."): router yang selalu reject → `runAgentLoop` reject "router down", urutan status `working` → ... → `idle`, dan ada event `error`.

**Catatan verifikasi perbaikan** (diisi Codex setelah FIXED)
<kosong>
