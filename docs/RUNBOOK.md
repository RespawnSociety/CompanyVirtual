# RUNBOOK — Virtual Company Platform

> Cara menjalankan & **menguji manual** tiap kemampuan. Satu DoD per task (roadmap §0).
> Konvensi: prosa Bahasa Indonesia, identifier/path English.

---

## Prasyarat

- **Node.js ≥ 20** (dites di Node 25). Cek: `node --version`.
- Paket dependency lewat **npm workspaces** (pnpm tidak wajib).

## Setup

```bash
npm install            # pasang dependency semua workspace
cp .env.example .env   # lalu isi nilai (Windows: copy .env.example .env)
npm run build          # tsc --build (kompilasi semua package → dist/)
```

> `npm test` dan `npm run spike:*` otomatis menjalankan `npm run build` lebih dulu
> (lewat hook `pre*`), jadi langkah `build` manual hanya perlu sekali untuk memastikan.

---

## Verifikasi cepat (semua logika Phase 0, tanpa layanan eksternal)

```bash
npm run typecheck      # semua tipe ter-compile (kontrak @vc/shared konsisten)
npm test               # unit test: router fallback, loop, memory, owner auth, webhook, relay
npm run spike:loop     # demo agent loop (mock): web_search → balas → memory tersimpan
npm run spike:wa       # demo owner auth: owner dibalas; nomor lain ditolak
```

Ketiganya **deterministik** dan tidak butuh 9Router/WhatsApp hidup.

---

## DoD per task

### 0.3 — 9Router tool/function calling (jalur live)
1. Pastikan 9Router berjalan di `NINEROUTER_BASE_URL` (default `http://localhost:20128/v1`).
2. Isi minimal satu model di `.env`: `NINEROUTER_MODEL_SUBSCRIPTION` / `_CHEAP` / `_FREE`.
3. Jalankan: `npm run spike:router`.
4. **Lolos bila:** output menampilkan `tool_calls` (mis. `get_weather(...)`).
   Bila model tak mendukung function calling, ganti model di `.env`.
- Logika fallback 3-tier (tanpa 9Router): `npm test` → `tests/router.test.ts`.

### 0.4 — Agent loop minimal
1. `npm run spike:loop` (mock) atau `npm run spike:loop -- --live` (pakai 9Router).
2. **Lolos bila:** status `done`, `web_search` terpanggil & sukses, ada balasan final,
   dan `memory tersimpan: ≥1 item`. Skrip mencetak `✓ DoD TERPENUHI`.

### 0.5 — WhatsApp auto-reply + Owner Auth

**A. Cepat (deterministik, tanpa WhatsApp):**
1. `npm run spike:wa`.
2. **Lolos bila:** Kasus 1 (owner) → `action: replied` + ada balasan terkirim;
   Kasus 2 (nomor lain) → `rejected_unknown_*` dan handler tidak dipanggil. `✓ DoD TERPENUHI`.

**B. Jalur HTTP (mode mock, uji webhook lokal):**
1. Set `.env`: `WA_ADAPTER=mock`, `WA_OWNER_NUMBERS=+62812...` (nomormu).
2. `npm run -w @vc/server dev` → server di `http://127.0.0.1:8787`.
3. Kirim payload webhook ala Cloud API (POST) — contoh PowerShell:
   ```powershell
   $body = @{ entry = @(@{ changes = @(@{ value = @{
     metadata = @{ display_phone_number = "15550009999" }
     messages = @(@{ from = "62812..."; id = "wamid.1"; timestamp = "1700000000"; type = "text"; text = @{ body = "halo" } })
   } }) }) } | ConvertTo-Json -Depth 8
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/webhook/whatsapp -Body $body -ContentType "application/json"
   ```
4. **Lolos bila:** response berisi `outcomes` dengan `action: replied` untuk nomor owner;
   ganti `from` ke nomor lain → `rejected_unknown_*`. (Balasan tidak benar-benar terkirim di mode mock.)

**C. Jalur produksi (WhatsApp Cloud API resmi):**
1. Set `.env`: `WA_ADAPTER=cloud`, `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_ACCESS_TOKEN`,
   `WA_CLOUD_VERIFY_TOKEN`, `WA_OWNER_NUMBERS`.
2. Ekspos server ke internet (mis. tunnel) → daftarkan webhook URL di Meta dengan verify token sama.
3. Verifikasi handshake: Meta `GET /webhook/whatsapp` → server balas `hub.challenge`.
4. Chat dari nomormu ke nomor perusahaan → balasan otomatis. Chat dari nomor lain → balasan default.

---

## Struktur perintah workspace

```bash
npm run -w @vc/shared build
npm run -w @vc/agent-runtime build
npm run -w @vc/server dev          # start orchestrator (tsx, hot)
npm run lint                        # eslint
```

## Keamanan (selalu)
- **Jangan** commit `.env` atau kredensial apa pun (sudah diblokir `.gitignore`).
- Token WhatsApp & API key hanya lewat env/Vault (Vault asli di Phase 4).
