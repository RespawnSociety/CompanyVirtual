# SPIKES — Virtual Company Platform (Phase 0)

> Catatan hasil spike integrasi berisiko sebelum bangun berat (plan §11, roadmap §0).
> Tiga spike Phase 0: **9Router tool-calling**, **agent loop minimal**, **WhatsApp + Owner Auth**.
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

---

## Ringkasan status

| Spike | Tema | Status | Bukti / cara uji |
|---|---|---|---|
| 0.3 | 9Router tool/function calling | ✅ **terbukti LIVE** ke 9Router lokal | `npm run spike:router` (live) · `tests/router.test.ts` (fallback) |
| 0.4 | Agent loop minimal + web_search + memory | ✅ terbukti (mock & struktur live) | `npm run spike:loop` · `tests/loop.test.ts` |
| 0.5 | WhatsApp adapter + Owner Auth + auto-reply | ✅ terbukti (mock & jalur HTTP cloud) | `npm run spike:wa` · `tests/relay.test.ts`, `tests/cloudWebhook.test.ts` |

Catatan: spike 0.3 jalur **live** butuh layanan 9Router benar-benar berjalan di
`NINEROUTER_BASE_URL`. Logika klien (fallback 3-tier, parsing tool_calls) sudah
diverifikasi lewat unit test dengan `fetch` di-stub, jadi tidak bergantung jaringan.

---

## Spike 0.3 — 9Router (tool/function calling + fallback)

**Tujuan (DoD):** kirim prompt + 1 tool def → dapat `tool_calls` valid; fallback 3-tier.

**Implementasi:**
- `packages/agent-runtime/src/router/nineRouter.ts` — `NineRouterClient` (OpenAI-compatible).
- Endpoint: `POST {NINEROUTER_BASE_URL}/chat/completions` (default `http://localhost:20128/v1`).
- **Fallback 3-tier:** urutan default `subscription → cheap → free`. Tier tanpa model
  (env `NINEROUTER_MODEL_*` kosong) otomatis dilewati. Gagal (network/non-OK/timeout)
  → coba tier berikut; semua gagal → `RouterError` dengan detail tiap percobaan.
- Timeout per request via `AbortController` (default 60 dtk).
- `req.model` eksplisit mem-bypass pemetaan tier; `req.tier` mulai dari tier itu lalu lanjut.

**Temuan / keputusan:**
- 9Router OpenAI-compatible → format request/response mengikuti OpenAI Chat Completions.
  Bila versi 9Router terbaru berbeda, sesuaikan **hanya** di `nineRouter.ts` (isolasi terjaga).
- ⚠️ **TEMUAN PENTING — streaming default.** 9Router lokal (instance yang dites) mengembalikan
  **SSE streaming** (`data: {…}\n\ndata: [DONE]`) untuk sebagian provider (mis. `kr/claude-*`)
  **meski `stream` tidak diset**. `res.json()` gagal mem-parse itu. **Fix:** klien WAJIB mengirim
  `stream: false` eksplisit → 9Router membalas satu objek JSON utuh. Sudah diterapkan di
  `nineRouter.ts`. (Dukungan SSE streaming bila diperlukan = enhancement Phase 2+.)
- **Model yang terbukti jalan + tool calling:** `kr/claude-sonnet-4.5`, `kr/claude-haiku-4.5`
  (uji `GET /v1/models` untuk daftar lengkap; banyak model cloud lain butuh kredit/kena
  rate-limit 429, mis. `gemini/*`, `openrouter/*:free`).
- **Kontrak router final** ada di `@vc/shared` (`RouterClient`, `ChatRequest`, `ChatResponse`,
  `ToolDefinition`, `ToolCall`, `ChatMessage`). Semua LLM platform WAJIB lewat kontrak ini.
- **Saran tier (.env)** terbukti: `SUBSCRIPTION=kr/claude-sonnet-4.5`, `CHEAP=kr/claude-haiku-4.5`.
  Bukti live: `→ tool_calls: get_weather({"city":"Jakarta"})` dari `claude-sonnet-4.5`.

**Cara uji:**
- Live: isi `NINEROUTER_MODEL_*` di `.env`, pastikan 9Router jalan, `npm run spike:router`.
- Logika (tanpa jaringan): `npm test` → `tests/router.test.ts`.

**Terbuka / TODO lanjutan:**
- Verifikasi nama param `tool_choice`/`max_tokens` terhadap versi 9Router terpasang
  (GitHub `decolua/9router`). Embeddings (untuk memory) menyusul lewat 9Router (Phase 2+).

---

## Spike 0.4 — Agent loop minimal

**Tujuan (DoD):** pesan → LLM via 9Router → 1 skill nyata (`web_search`) → balas; memory tersimpan.

**Implementasi:**
- `packages/agent-runtime/src/loop.ts` — `runAgentLoop(agent, userMessage, deps)`.
  - Bangun system prompt dari `AgentProfile.description` + guardrails + memory yang di-recall.
  - Ekspos tools sesuai `agent.skillScope` (defense-in-depth: tool di luar scope ditolak).
  - Think→act sampai `maxSteps`; eksekusi tool, sisipkan hasil, lanjut sampai model balas final.
  - **Approval gate struktural:** skill `risky` ditahan sampai di-approve (Phase 0: tanpa
    approver → `blocked`). web_search tidak risky.
  - Simpan memory: observation (arahan) + result (balasan).
- `skills/webSearch.ts` — skill `web_search`, provider pluggable (default **mock** deterministik).
- `memory/store.ts` — `InMemoryMemoryStore`, retrieval keyword (relevance + recency + importance).

**Temuan / keputusan:**
- Loop **generik** — tidak tahu departemen/role. Persona & tools sepenuhnya data-driven dari
  `AgentProfile`. Tidak ada hardcode "marketing".
- Semua dependensi di-inject (`router`, `skills`, `memory`, `now`, `genId`) → mudah di-test
  deterministik dengan `MockRouterClient`.
- **Kontrak skill final** di `@vc/shared` (`Skill`, `SkillContext`, `JsonSchema`, `VaultReader`,
  `ApprovalDraft`). Menambah skill = menambah file di `skills/`, tidak menyentuh loop.

**Cara uji:** `npm run spike:loop` (mock) · `npm run spike:loop -- --live` (9Router) · `npm test`.

---

## Spike 0.5 — WhatsApp adapter + Owner Auth + auto-reply

**Tujuan (DoD):** chat dari nomormu → agent auto-reply lewat nomor perusahaan;
chat dari nomor lain ditolak.

**Implementasi:**
- `apps/server/src/comms/` :
  - `types.ts` — `ChannelAdapter`, `InboundMessage`, `OutboundMessage`.
  - `ownerAuth.ts` — `OwnerAuth` (normalisasi nomor → bandingkan digit; whitelist).
  - `cloudAdapter.ts` — `CloudApiAdapter` (Meta Cloud API: send + verify webhook) +
    `parseCloudWebhook` (payload webhook → InboundMessage, ambil teks saja).
  - `mockAdapter.ts` — `MockWhatsAppAdapter` (uji lokal; pesan keluar dicatat).
  - `relay.ts` — `WaRelay`: **inti** — owner auth → handler (auto-reply) → kirim balasan;
    nomor tak dikenal → balasan default atau diabaikan, **tidak** menyetir agent.
  - `frontDesk.ts` — Manager "wajah" perusahaan; bungkus `runAgentLoop` jadi handler.
- `apps/server/src/server.ts` — Fastify: `GET/POST /webhook/whatsapp` + `/health`.

**Keputusan adapter (open decision §13.3):**
- Phase 0 mengimplementasi **Cloud API resmi** (jalur produksi) + **Mock** (uji lokal
  deterministik). **Baileys** (proto QR) ditunda — dependensi berat & rawan blokir; abstraksi
  `ChannelAdapter` sudah menyiapkan tempatnya bila dibutuhkan.
- **Owner Auth NON-NEGOTIABLE**: default semua nomor ditolak bila `WA_OWNER_NUMBERS` kosong.
- **Auto-reply ≠ auto-action**: relay membalas otomatis, tapi aksi eksternal tetap approval-gated (loop).

**Catatan keamanan:**
- Access token & verify token dari env/Vault — `.gitignore` memblokir `.env`, `auth_info/`, dll.
- Log menyamarkan nomor (`62***90`), tidak mencetak nomor penuh.

**Cara uji:** `npm run spike:wa` (deterministik) · `npm test` (`relay`, `cloudWebhook`, `ownerAuth`).
Jalur HTTP/Cloud nyata: jalankan server lalu daftarkan webhook (lihat RUNBOOK).

---

## Kontrak yang dikunci di Phase 0

- **`@vc/shared`** — sumber kebenaran tipe: data model (plan §9), `AgentEvent`, kontrak
  `Skill`/`SkillContext`, kontrak `RouterClient`/`ChatRequest`/`ChatResponse`.
- **Router contract** & **Skill contract** dianggap **final** untuk lanjut ke Phase 1–2
  (boleh ditambah field, hindari breaking change tanpa alasan kuat).

## Keputusan terbuka yang tersentuh (plan §13)

- §13.2 9Router dipakai langsung — **ya** (klien OpenAI-compatible).
- §13.3 WhatsApp awal — **Cloud API + Mock**; Baileys ditunda.
- §13.6 Comms — **satu nomor, Manager sebagai wajah** (default diikuti).
- §13.7 Owner/whitelist — via `WA_OWNER_NUMBERS` (banyak nomor didukung).
