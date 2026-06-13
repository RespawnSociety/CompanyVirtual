//! Manajer layanan lokal untuk shell desktop (Phase 6.1).
//!
//! - **START**: menjalankan orchestrator (apps/server) sebagai proses anak Node.
//! - **MONITOR**: cek apakah port server (8787), 9Router (20128) & MySQL (3306) hidup
//!   (TCP connect singkat). Hasilnya diekspos ke UI lewat command `service_status`.
//!
//! 9Router (decolua/9router) & MySQL (XAMPP) adalah layanan eksternal yang dijalankan terpisah
//! oleh owner — shell hanya MEMANTAU keduanya. Yang DIJALANKAN shell adalah orchestrator milik
//! kita (yang menggerakkan agent-runtime + REST/realtime untuk web).

use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

// Default host/port (selaras docs + .env.example). Override port server via VC_SERVER_PORT.
const SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_SERVER_PORT: u16 = 8787;
const NINEROUTER_HOST: &str = "127.0.0.1";
const NINEROUTER_PORT: u16 = 20128;
const DB_HOST: &str = "127.0.0.1";
const DB_PORT: u16 = 3306;

/// Laporan status (cermin `ServiceStatus` di apps/web/src/desktop.ts).
#[derive(Serialize, Clone)]
pub struct StatusReport {
    /// Orchestrator (apps/server) — true bila port-nya menerima koneksi.
    pub server: bool,
    /// 9Router lokal — true bila port-nya hidup.
    pub ninerouter: bool,
    /// MySQL/MariaDB — true bila port-nya hidup.
    pub database: bool,
    /// True bila proses orchestrator dijalankan oleh shell ini (bukan sekadar dipantau).
    pub managed: bool,
}

/// Mengelola siklus hidup orchestrator lokal + pengecekan status.
pub struct ServiceManager {
    app: AppHandle,
    server: Option<Child>,
}

impl ServiceManager {
    pub fn new(app: AppHandle) -> Self {
        Self { app, server: None }
    }

    /// Jalankan orchestrator (`node <apps/server/dist/main.js>`) bila belum jalan.
    /// Bila sudah ada server yang mendengar di port (mis. `npm run dev:server` manual), tidak
    /// men-spawn dobel — cukup membiarkannya dipantau.
    pub fn start_server(&mut self) -> Result<(), String> {
        if self.server.is_some() {
            return Ok(());
        }
        if port_open(SERVER_HOST, server_port()) {
            // Sudah ada orchestrator lain yang hidup → pantau saja, jangan spawn dobel.
            return Ok(());
        }
        let entry = resolve_server_entry(&self.app).ok_or_else(|| {
            "entry orchestrator (apps/server/dist/main.js) tak ditemukan; jalankan `npm run build` \
             dulu, atau set VC_SERVER_ENTRY ke path main.js"
                .to_string()
        })?;
        let cwd = repo_root(&entry);
        let node = node_bin();
        let mut cmd = Command::new(&node);
        cmd.arg(&entry);
        if let Some(dir) = &cwd {
            // cwd = root repo agar server menemukan .env, data/, dan node_modules (hoisted).
            cmd.current_dir(dir);
        }
        let child = cmd.spawn().map_err(|e| {
            format!("gagal spawn `{node}`: {e}. Pastikan Node.js >=20 ada di PATH (atau set VC_NODE_BIN).")
        })?;
        self.server = Some(child);
        Ok(())
    }

    /// Hentikan proses anak orchestrator (bila ada).
    pub fn stop_server(&mut self) {
        if let Some(mut child) = self.server.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Restart orchestrator (stop lalu start).
    pub fn restart_server(&mut self) -> Result<(), String> {
        self.stop_server();
        self.start_server()
    }

    /// Snapshot status semua layanan lokal.
    pub fn status(&self) -> StatusReport {
        StatusReport {
            server: port_open(SERVER_HOST, server_port()),
            ninerouter: port_open(NINEROUTER_HOST, NINEROUTER_PORT),
            database: port_open(DB_HOST, DB_PORT),
            managed: self.server.is_some(),
        }
    }
}

impl Drop for ServiceManager {
    fn drop(&mut self) {
        self.stop_server();
    }
}

/// Port orchestrator: override VC_SERVER_PORT, default 8787.
fn server_port() -> u16 {
    std::env::var("VC_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_SERVER_PORT)
}

/// True bila ada yang mendengar di host:port (TCP connect singkat).
fn port_open(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    match addr.to_socket_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .any(|a| TcpStream::connect_timeout(&a, Duration::from_millis(400)).is_ok()),
        Err(_) => false,
    }
}

/// Binary Node: override `VC_NODE_BIN`, default `node` dari PATH.
fn node_bin() -> String {
    std::env::var("VC_NODE_BIN").unwrap_or_else(|_| "node".to_string())
}

/// Resolusi entry orchestrator, urut prioritas:
/// 1. env `VC_SERVER_ENTRY` (path absolut ke main.js);
/// 2. resource bundle `<resources>/server/main.js` (produksi — bila di-bundle);
/// 3. telusuri ke atas dari cwd lalu lokasi exe untuk `apps/server/dist/main.js` (dev / repo lokal).
fn resolve_server_entry(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("VC_SERVER_ENTRY") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("server").join("main.js");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    let rel = Path::new("apps").join("server").join("dist").join("main.js");
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    for root in roots {
        let mut cur: Option<&Path> = Some(root.as_path());
        while let Some(dir) = cur {
            let candidate = dir.join(&rel);
            if candidate.is_file() {
                return Some(candidate);
            }
            cur = dir.parent();
        }
    }
    None
}

/// Root repo untuk cwd proses server: env `VC_REPO_ROOT`, else naik dari entry
/// (`<root>/apps/server/dist/main.js` → `<root>`).
fn repo_root(entry: &Path) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("VC_REPO_ROOT") {
        return Some(PathBuf::from(p));
    }
    entry.ancestors().nth(4).map(|p| p.to_path_buf())
}
