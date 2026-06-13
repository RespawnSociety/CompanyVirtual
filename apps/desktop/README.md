# @vc/desktop — Shell Desktop Tauri (Phase 6)

Membungkus web (FACE) menjadi aplikasi desktop yang **dobel-klik → service lokal hidup → platform jalan**.
Shell ini:

1. **Memuat web** — di dev dari Vite dev server (`http://localhost:5173`); di rilis dari aset hasil
   `vite build` (`apps/web/dist`).
2. **Menjalankan orchestrator lokal** — men-spawn `node apps/server/dist/main.js` sebagai proses anak
   saat app start, dan menghentikannya saat jendela ditutup (lihat `src-tauri/src/service.rs`).
3. **Memantau** orchestrator (`:8787`), 9Router (`:20128`), dan MySQL (`:3306`) → status tampil di
   pojok kanan topbar (indikator hijau/merah). Command Tauri: `service_status`, `restart_server`.

> Karena webview rilis di-host dari custom protocol (`tauri://localhost`), web memakai **URL absolut**
> ke `http://127.0.0.1:8787` lewat build mode `desktop` (`apps/web/.env.desktop` → `VITE_API_BASE_URL`).
> Di dev (`tauri dev`) web di-load dari Vite (`:5173`) dan memakai proxy relatif seperti biasa.

---

## Prasyarat (sekali per mesin)

Tauri butuh toolchain **Rust** + dependensi native OS. Di mesin ini Rust **belum terpasang**
(`cargo --version` → not found), jadi langkah build di bawah dijalankan oleh owner.

- **Rust** (stable) — <https://rustup.rs> (`rustup` → `cargo`, `rustc`).
- **Windows:** Microsoft C++ Build Tools (Desktop development with C++) + **WebView2 Runtime**
  (umumnya sudah ada di Windows 11).
- **Node.js ≥ 20** (sudah jadi prasyarat repo) + **MySQL/MariaDB** (XAMPP) + **9Router** lokal —
  lihat `docs/RUNBOOK.md`.

CLI Tauri (`@tauri-apps/cli`) sudah terdaftar sebagai devDependency → terpasang via `npm install`.

---

## Menjalankan (dev)

Dari **root repo**:

```bash
npm install            # sekali (memasang @tauri-apps/cli + wiring workspace)
npm run build          # kompilasi backend → apps/server/dist/main.js (yang di-spawn shell)
npm run dev:desktop    # = tauri dev (start Vite + jendela desktop + spawn orchestrator)
```

Pastikan MySQL & 9Router hidup (sama seperti `docs/RUNBOOK.md`). Jendela terbuka → web tampil →
indikator status di topbar menunjukkan Server/9Router/DB.

## Build aplikasi yang bisa diklik (rilis)

```bash
# 1) Sekali: turunkan set ikon platform dari ikon sumber (.ico/.icns/png):
npm --prefix apps/desktop run tauri icon apps/desktop/src-tauri/icons/icon.png

# 2) Build installer/binari:
npm run build          # backend (server dist) lebih dulu
npm run build:desktop  # = tauri build → installer di apps/desktop/src-tauri/target/release/bundle/
```

> **Catatan distribusi (follow-up):** build rilis saat ini mengasumsikan **Node.js terpasang di PATH**
> mesin target dan menemukan orchestrator dari repo lokal (resolusi di `service.rs`). Untuk distribusi
> ke mesin tanpa repo, bundle `apps/server/dist` + `node_modules` sebagai Tauri **resource** (atau
> kemas server jadi binari) lalu arahkan via `VC_SERVER_ENTRY`/resource `server/main.js`. Belum
> dikerjakan agar bundle tidak membengkak; lihat `docs/ROADMAP.md` Phase 6.

---

## Override (env)

- `VC_SERVER_ENTRY` — path absolut ke `main.js` orchestrator (lewati resolusi otomatis).
- `VC_REPO_ROOT` — cwd untuk proses server (default: naik dari entry).
- `VC_NODE_BIN` — path biner Node (default `node` dari PATH).
- `VC_SERVER_PORT` — port orchestrator yang dipantau (default `8787`).
