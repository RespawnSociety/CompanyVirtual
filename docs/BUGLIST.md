# BUGLIST - Virtual Company Platform

> **Dirawat oleh: Codex (Reviewer & Bug Hunter).** Lihat aturan di `AGENTS.md`.
> Setiap entri harus lolos **verifikasi 2x**. Codex **tidak** mengubah source code - Claude yang memperbaiki, lalu Codex memverifikasi perbaikannya.
> Konvensi: prosa Bahasa Indonesia, identifier/file/path/data-model English.

> **Catatan pembersihan 2026-06-13:** entri `VERIFIED_FIXED` sudah dicek ulang dan dihapus dari daftar aktif. Yang tersisa di file ini hanya bug yang masih perlu keputusan/perbaikan.
> **Catatan sweep Phase 0-3 2026-06-13:** `packages/shared`, `packages/agent-runtime`, `packages/templates`, `apps/server`, dan `apps/web` direview ulang, dengan fokus tambahan `WorkflowEngine`, `workflow_runs`, approval gate, dan `WorkflowPanel`. Gate observasi: `npm run build`, `npm run lint`, `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm test` (57 passed). `BUG-107/108` tetap `OPEN` menunggu keputusan strategi auth Phase 4; temuan workflow baru dicatat sebagai `BUG-112` dan `BUG-113`.

## Legenda Status
`OPEN` (terverifikasi, belum dikerjakan) | `FIXING` (Claude kerjakan) | `FIXED` (Claude klaim, tunggu verifikasi) | `VERIFIED_FIXED` (Codex konfirmasi beres) | `REOPENED` (Codex tolak, ada bukti) | `FALSE_POSITIVE` | `WONTFIX`

## Ringkasan
| ID | Judul | Severity | Status | Location |
|---|---|---|---|---|
| BUG-107 | `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer | high | OPEN | `apps/web/src/api.ts:41`, `apps/server/src/server.ts:60` |
| BUG-108 | Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token | high | OPEN | `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:60` |
| BUG-112 | Review loop menganggap kuota revisi habis sebagai lanjut ke approval | medium | FIXED | `apps/server/src/workflow/engine.ts:180`, `apps/server/src/workflow/engine.ts:188` |
| BUG-113 | `approvalId` default berbasis timestamp bisa tabrakan antar workflow run | high | FIXED | `apps/server/src/workflow/engine.ts:269`, `apps/server/src/db/store.ts:816` |

---

## Entri

### BUG-107 - `API_AUTH_TOKEN` membuat REST terlindungi, tetapi web client tidak pernah mengirim bearer

- **Status:** OPEN
- **Severity:** high
- **Category:** runtime
- **Location:** `apps/web/src/api.ts:41`, `apps/server/src/server.ts:60`, `apps/server/src/main.ts:143`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Server sudah mendukung `API_AUTH_TOKEN` dan bahkan mewajibkannya saat bind non-loopback, tetapi klien web bawaan tidak punya mekanisme untuk mengirim `Authorization: Bearer <token>`. Akibatnya mode deployment yang aman membuat UI resmi gagal memanggil semua endpoint `/api/*`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:60`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/main.ts:143-148`):
  ```ts
  const apiAuthToken = env.API_AUTH_TOKEN?.trim() || undefined;
  if (!apiAuthToken && !isLoopbackHost(host)) {
    throw new Error(
      `Server bind ke host non-loopback '${host}' tanpa API_AUTH_TOKEN. ` +
        "REST /api/* akan terbuka tanpa auth. Set API_AUTH_TOKEN di .env sebelum expose ke jaringan.",
  ```
- Kutipan kode (`apps/web/src/api.ts:40-41`):
  ```ts
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
  ```
- Kontrak env (`.env.example:55-58`) menyatakan klien harus mengirim `Authorization: Bearer <token>`, tetapi tidak ada `VITE_*`/config/token path di `apps/web`.
- Observasi: `buildServer({ apiAuthToken: "secret" })` mengembalikan `{"noAuth":401,"auth":200}` untuk `GET /api/companies`; request tanpa header sama dengan perilaku `api.ts`.

**Dampak**
Begitu operator mengikuti instruksi aman untuk hosting non-lokal (`API_AUTH_TOKEN` wajib), web app tidak bisa memuat company/template/world/CRUD karena semua request REST dikirim tanpa bearer. Ini memblokir Phase 1 UI pada mode aman.

**Verifikasi #1 (pembacaan kode)**
Server menolak `/api/*` tanpa bearer saat `apiAuthToken` diset, sementara `apps/web/src/api.ts` hanya mengirim `content-type` untuk semua request dan tidak membaca konfigurasi token apa pun.

**Verifikasi #2 (observasi runtime)**
Fastify inject pada server in-memory dengan `apiAuthToken: "secret"` menunjukkan request tanpa `Authorization` mendapat 401, sedangkan request dengan `Authorization: Bearer secret` mendapat 200.

**Solusi yang diusulkan (untuk Claude)**
1. Tentukan strategi auth web resmi: token dev via `VITE_API_AUTH_TOKEN`, reverse-proxy yang menyuntik header, atau session/login ringan.
2. Implementasikan satu jalur eksplisit di `apps/web/src/api.ts` untuk menyertakan bearer ketika mode token aktif.
3. Update `.env.example` dan `docs/RUNBOOK.md` agar operator tahu cara web client mendapat token.
4. Tambahkan test untuk `buildServer({ apiAuthToken })` dan dokumentasikan smoke test web dengan token.

**Catatan Claude 2026-06-11 - DITUNDA (butuh keputusan).**
Solusi #1 menuntut pilihan strategi auth web (token build-time `VITE_API_AUTH_TOKEN` yang ter-embed di bundle vs reverse-proxy yang menyuntik header vs login ringan) - trade-off keamanan yang harus diputuskan owner, bukan default sepihak. Dikerjakan bersama `BUG-108` (auth socket) sebagai satu boundary auth (lihat CR-101). Status tetap `OPEN` sampai strategi dipilih.

**Catatan verifikasi perbaikan**
Kosong sampai Claude menandai `FIXED`.

---

### BUG-108 - Socket realtime tetap bisa mengambil `world:sync` tanpa auth saat REST sudah dilindungi token

- **Status:** OPEN
- **Severity:** high
- **Category:** security
- **Location:** `apps/server/src/realtime.ts:33`, `apps/server/src/server.ts:60`, `apps/web/src/socket.ts:33`
- **Ditemukan:** 2026-06-11 oleh Codex

**Deskripsi**
Bearer auth hanya diterapkan pada URL yang diawali `/api/`. Socket.IO `/socket.io` tidak dicek token, dan `RealtimeHub` langsung menerima `world:subscribe` lalu mengirim snapshot company. Jadi saat REST sudah dilindungi token, world snapshot masih bisa diambil lewat socket tanpa auth bila penyerang mengetahui `companyId`.

**Bukti**
- Kutipan kode (`apps/server/src/server.ts:60`):
  ```ts
  if (apiToken && req.url.startsWith("/api/") && !hasValidBearer(req.headers.authorization, apiToken)) {
  ```
- Kutipan kode (`apps/server/src/realtime.ts:33-44`):
  ```ts
  socket.on("world:subscribe", (companyId: Id) => {
    const target = room(companyId);
    const stale = [...socket.rooms].filter((r) => r.startsWith("company:") && r !== target);
    for (const r of stale) void socket.leave(r);
    void socket.join(target);
    void this.store
      .getWorldSnapshot(companyId)
      .then((snap) => {
        if (snap) socket.emit("world:sync", snap);
      })
  });
  ```
- Kutipan kode (`apps/web/src/socket.ts:33`, `apps/web/src/socket.ts:37`):
  ```ts
  const socket: WorldSocket = io({ autoConnect: true });
  ...
  socket.emit("world:subscribe", companyId);
  ```
- Observasi: server in-memory dengan `apiAuthToken: "secret"` + `RealtimeHub` menerima socket tanpa token dan mengirim `{"company":"A","agents":1}` setelah `world:subscribe`.
- Alasan ini bug: proteksi REST tidak menutup channel realtime yang membawa data company yang sama (`WorldSnapshot` berisi company, floors, departments, agents).

**Dampak**
Mode hosting aman masih punya jalur baca tanpa auth untuk snapshot konfigurasi perusahaan. Ini membocorkan nama company, struktur lantai/departemen, dan profil agent ke client yang bisa menebak/memperoleh `companyId`.

**Verifikasi #1 (pembacaan kode)**
Auth hook di `server.ts` hanya memeriksa `/api/`, sedangkan `RealtimeHub` tidak menerima token, tidak memasang middleware Socket.IO, dan tidak memvalidasi handshake sebelum mengirim `world:sync`.

**Verifikasi #2 (observasi runtime)**
Script Node lokal membuat server dengan `apiAuthToken`, attach `RealtimeHub`, lalu connect via `socket.io-client` tanpa `auth`/header. Setelah emit `world:subscribe`, client tetap menerima snapshot.

**Solusi yang diusulkan (untuk Claude)**
1. Teruskan `apiAuthToken` ke `RealtimeHub`.
2. Tambahkan Socket.IO middleware (`io.use`) yang memvalidasi token dari `socket.handshake.auth.token` atau header `Authorization`.
3. Update `apps/web/src/socket.ts` agar mengirim token dengan mekanisme yang sama seperti REST.
4. Tambahkan test realtime: tanpa token tidak menerima `world:sync`; token valid berhasil subscribe.

**Catatan Claude 2026-06-11 - DITUNDA (butuh keputusan).**
Tergantung strategi auth web yang sama dengan `BUG-107` (token diteruskan ke `RealtimeHub` via `io.use` + `socket.handshake.auth.token`). Test realtime juga butuh `socket.io-client` di root (kini hanya ada di `apps/web`). Status tetap `OPEN` sampai strategi auth dipilih; akan dikerjakan satu paket dengan `BUG-107` + CR-101.

**Catatan verifikasi perbaikan**
Kosong sampai Claude menandai `FIXED`.

---

### BUG-112 - Review loop menganggap kuota revisi habis sebagai lanjut ke approval

- **Status:** FIXED
- **Severity:** medium
- **Category:** logic
- **Location:** `apps/server/src/workflow/engine.ts:180`, `apps/server/src/workflow/engine.ts:188`, `docs/RUNBOOK.md:189`, `tests/workflow.test.ts:99`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
Pada step `loop_until_pass`, reviewer yang masih menjawab `REVISI` setelah `maxReviewRounds` tercapai diperlakukan sama seperti `PASS`: engine lanjut ke step berikutnya dan akhirnya masuk `approval_gate`. Cap revisi seharusnya mencegah loop tak terbatas, bukan mengubah hasil review gagal menjadi jalur approval normal.

**Bukti**
- Kutipan kode (`apps/server/src/workflow/engine.ts:180-188`):
  ```ts
  if (step.next === "loop_until_pass") {
    const revise = /revisi/i.test(out.finalText) && !/^\s*(pass|lolos|layak)\b/i.test(out.finalText);
    if (revise && run.reviewRounds < maxReviewRounds) {
      run = (await store.updateWorkflowRun(run.id, { reviewRounds: run.reviewRounds + 1 }))!;
      pendingNote = `Revisi dari ${step.role}: ${out.finalText}`;
      i = contentStepIndex(steps); // ulang dari step konten
      continue;
    }
    i += 1; // PASS atau kuota revisi habis -> lanjut
  ```
- Kontrak operasional (`docs/RUNBOOK.md:189-190`) mendeskripsikan `loop_until_pass` sebagai `REVISI -> ulang step konten` dan `PASS -> lanjut`.
- Coverage saat ini hanya menguji satu `REVISI` lalu lanjut (`tests/workflow.test.ts:99-125`), bukan kondisi reviewer tetap `REVISI` sampai cap habis.
- Observasi probe runtime dengan `maxReviewRounds: 1` dan reviewer selalu menjawab `REVISI: masih belum layak.`:
  ```json
  {"runStatus":"awaiting_approval","directiveStatus":"awaiting_approval","reviewRounds":1,"approvalId":"appr_1781351613581","currentStepId":"wf-step_701c5a84-6bf5-412d-b668-2fafdebfee49"}
  ```
- Alasan ini bug: output terakhir reviewer masih menolak konten, tetapi state run dan directive masuk `awaiting_approval` seolah konten sudah lolos review.

**Dampak**
Konten yang belum lolos review bisa masuk approval/publish path setelah kuota revisi habis. Pada Phase 3 publish masih stub, tetapi saat Phase 4 menghubungkan aksi publish nyata, failure mode ini bisa mengirim draft yang reviewer eksplisit minta revisi.

**Verifikasi #1 (pembacaan kode)**
Cabang `revise && run.reviewRounds < maxReviewRounds` hanya mengulang saat kuota belum habis. Begitu kuota habis, tidak ada cabang error/blocked/escalation; eksekusi jatuh ke `i += 1` dan melanjutkan workflow.

**Verifikasi #2 (observasi runtime + cakupan test)**
Probe runtime memakai engine asli, template marketing asli, dan MySQL test DB menunjukkan state akhir `awaiting_approval` meski reviewer selalu `REVISI`. Test Phase 3 yang ada membuktikan happy path revisi sekali (`tests/workflow.test.ts:99`) tetapi belum menutup skenario cap habis.

**Solusi yang diusulkan (untuk Claude)**
1. Di `apps/server/src/workflow/engine.ts`, bila `revise` masih true dan `reviewRounds >= maxReviewRounds`, jangan lanjut `i += 1`.
2. Pilih state eksplisit: paling sederhana set `WorkflowRun.status` dan `Directive.status` ke `"blocked"` dengan pesan alasan "review cap exhausted"; alternatif produk: status khusus `needs_owner_review` bila owner memang boleh override draft gagal.
3. Emit event/message post-persist agar UI tahu workflow berhenti karena review cap, bukan menunggu approval normal.
4. Tambahkan test di `tests/workflow.test.ts`: reviewer selalu `REVISI` sampai cap habis -> run tidak punya `approvalId`, tidak `awaiting_approval`, dan directive tidak `awaiting_approval`.

**Diperbaiki (Claude 2026-06-13) — FIXED (menunggu verifikasi Codex).**
`apps/server/src/workflow/engine.ts` (cabang `loop_until_pass`): bila `revise` masih true DAN
`reviewRounds >= maxReviewRounds` → tidak lagi `i += 1` ke approval. Memanggil helper baru
`blockRun(run, dept, reason)` yang set `WorkflowRun.status` + `Directive.status` = `"blocked"`,
meng-clear `approvalId`, dan emit `message` ke owner ("Workflow berhenti (perlu perhatian): kuota revisi
habis tapi … masih minta REVISI"). Test `tests/workflow.test.ts` ("BUG-112 …", `maxReviewRounds:1`,
reviewer selalu REVISI): run & directive `blocked`, `approvalId` undefined. Gate: `npm test` 59/59, build/lint hijau.

**Catatan verifikasi perbaikan**
Kosong sampai Codex memverifikasi.

---

### BUG-113 - `approvalId` default berbasis timestamp bisa tabrakan antar workflow run

- **Status:** FIXED
- **Severity:** high
- **Category:** concurrency
- **Location:** `apps/server/src/workflow/engine.ts:269`, `apps/server/src/db/store.ts:816`, `apps/server/src/db/schema.ts:128`, `apps/server/src/db/schema.ts:134`, `apps/server/src/main.ts:143`
- **Ditemukan:** 2026-06-13 oleh Codex

**Deskripsi**
`pauseForApproval` membuat `approvalId` default dari `Date.now()` (`appr_<timestamp>`) bila dependency `genId` tidak diberikan. Runtime production di `main.ts` membuat `WorkflowEngine` tanpa `genId`, sementara tabel `workflow_runs` hanya memberi index biasa pada `approval_id`. Dua workflow yang pause pada milidetik sama bisa memiliki `approvalId` identik; endpoint resume lalu hanya mengambil satu row arbitrer dari `SELECT * WHERE approval_id = ?`.

**Bukti**
- Kutipan kode (`apps/server/src/main.ts:143`):
  ```ts
  const workflowEngine = new WorkflowEngine({ store, router, skills, memory, emitAgentEvent });
  ```
- Kutipan kode (`apps/server/src/workflow/engine.ts:268-270`):
  ```ts
  const now = this.deps.now ?? Date.now;
  const genId = this.deps.genId ?? ((p: string) => `${p}_${now()}`);
  const approvalId = genId("appr");
  ```
- Kutipan kode (`apps/server/src/db/store.ts:816-818`):
  ```ts
  async findWorkflowRunByApproval(approvalId: Id): Promise<WorkflowRun | undefined> {
    const row = await this.one("SELECT * FROM workflow_runs WHERE approval_id = ?", [approvalId]);
    return row ? this.rowToWorkflowRun(row) : undefined;
  }
  ```
- Kutipan skema (`apps/server/src/db/schema.ts:128`, `apps/server/src/db/schema.ts:134`):
  ```sql
  approval_id     VARCHAR(64) NULL,
  INDEX idx_wfruns_approval (approval_id),
  ```
- Observasi probe runtime dengan `now: () => 1234567890` dan `genId` tidak diberikan:
  ```json
  {"approvalIds":["appr_1234567890","appr_1234567890"],"same":true,"pendingBefore":[{"id":"run_3b895ea4-9be3-46f2-9257-fc395629c293","approvalId":"appr_1234567890","status":"awaiting_approval"},{"id":"run_80bb9059-d524-4851-9945-8ceaa4dc43ad","approvalId":"appr_1234567890","status":"awaiting_approval"}],"resumedRunId":"run_3b895ea4-9be3-46f2-9257-fc395629c293","after":[{"id":"run_3b895ea4-9be3-46f2-9257-fc395629c293","status":"done"},{"id":"run_80bb9059-d524-4851-9945-8ceaa4dc43ad","approvalId":"appr_1234567890","status":"awaiting_approval"}]}
  ```
- Alasan ini bug: `approvalId` adalah identity boundary untuk keputusan owner. Jika dua pending card punya ID sama, `POST /api/approvals/:approvalId` tidak bisa membedakan run mana yang sedang disetujui.

**Dampak**
Pada beban paralel atau test/runtime dengan clock yang sama, klik approve/revise untuk satu workflow bisa meresume workflow lain yang memiliki `approvalId` identik. Ini merusak approval gate: keputusan owner tidak lagi terikat ke draft/run yang dimaksud.

**Verifikasi #1 (pembacaan kode)**
Production `WorkflowEngine` tidak menerima `genId`, sehingga fallback timestamp aktif. `findWorkflowRunByApproval` mencari hanya berdasarkan `approval_id` tanpa `status = 'awaiting_approval'`, tanpa `ORDER BY`, dan tanpa constraint unik di skema.

**Verifikasi #2 (observasi runtime)**
Probe runtime membuat dua workflow marketing yang sama-sama pause approval dengan `now` tetap dan `genId` kosong. Keduanya mendapat `approvalId` identik; satu panggilan `resumeByApproval("appr_1234567890", "approve")` hanya menyelesaikan satu run, sementara run lain tetap `awaiting_approval` dengan ID yang sama.

**Solusi yang diusulkan (untuk Claude)**
1. Gunakan generator ID unik yang sama dengan runtime lain: import/pakai `defaultGenId("appr")` sebagai fallback di `pauseForApproval`, bukan `${Date.now()}`.
2. Pertimbangkan constraint unik untuk `workflow_runs.approval_id` saat non-null, atau setidaknya deteksi collision dan regenerate sebelum persist.
3. Ubah `findWorkflowRunByApproval` agar memfilter `status = 'awaiting_approval'` dan gagal eksplisit bila ada lebih dari satu row aktif dengan ID yang sama.
4. Tambahkan test di `tests/workflow.test.ts`: dua run yang pause pada clock sama tetap mendapatkan `approvalId` berbeda, dan resume menargetkan run yang benar.

**Diperbaiki (Claude 2026-06-13) — FIXED (menunggu verifikasi Codex).**
1. `apps/server/src/workflow/engine.ts` `pauseForApproval`: fallback `genId` kini `defaultGenId`
   (uuid-based dari `@vc/agent-runtime`), BUKAN `${prefix}_${Date.now()}`. Dua run yang pause pada
   milidetik sama tetap mendapat `approvalId` unik.
2. `apps/server/src/db/store.ts` `findWorkflowRunByApproval`: query difilter `AND status = 'awaiting_approval' ORDER BY created_at, id LIMIT 1` → hanya run yang benar-benar menunggu yang bisa di-resume, deterministik.
3. Test `tests/workflow.test.ts` ("BUG-113 …"): dua run pause dengan `now` tetap (`() => 1234567890`)
   tanpa `genId` → `approvalId` berbeda; `resumeByApproval(r1)` hanya menyelesaikan r1, r2 tetap `awaiting_approval`.
Gate: `npm test` 59/59, build/lint hijau. (Catatan: unique-constraint DB pada `approval_id` dipertimbangkan
tapi tak wajib karena id sudah unik + query terfilter; bisa ditambah saat hardening Phase 4.)

**Catatan verifikasi perbaikan**
Kosong sampai Codex memverifikasi.
