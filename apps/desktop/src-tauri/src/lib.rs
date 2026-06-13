//! Shell desktop Tauri (Phase 6.1).
//!
//! Tugas shell: (1) memuat web (FACE) — di dev dari Vite (`devUrl`), di rilis dari aset
//! `frontendDist`; (2) **menjalankan** orchestrator lokal (apps/server) sebagai proses anak
//! Node; (3) **memantau** orchestrator + 9Router + MySQL dan mengeksposnya ke UI lewat command
//! `service_status`. DoD: dobel-klik → service lokal hidup → platform jalan.

mod service;

use std::sync::Mutex;

use service::{ServiceManager, StatusReport};
use tauri::{Manager, WindowEvent};

/// State global aplikasi: manajer layanan lokal.
struct AppState {
    services: Mutex<ServiceManager>,
}

/// Status layanan lokal (dipanggil dari web via `window.__TAURI__.core.invoke("service_status")`).
#[tauri::command]
fn service_status(state: tauri::State<'_, AppState>) -> StatusReport {
    let mgr = state.services.lock().expect("services lock");
    mgr.status()
}

/// Restart orchestrator lokal (dipanggil dari web bila service mati / butuh muat ulang).
#[tauri::command]
fn restart_server(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut mgr = state.services.lock().expect("services lock");
    mgr.restart_server()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let mut services = ServiceManager::new(app.handle().clone());
            // Mulai orchestrator lokal. Kegagalan start (mis. Node tak ada / belum `npm run build`)
            // TIDAK menggagalkan UI — status akan menampilkannya & owner bisa Restart dari panel.
            if let Err(err) = services.start_server() {
                eprintln!("[desktop] gagal start orchestrator: {err}");
            }
            app.manage(AppState {
                services: Mutex::new(services),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Saat jendela ditutup, hentikan proses anak orchestrator agar tak menggantung.
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if let Ok(mut mgr) = state.services.lock() {
                        mgr.stop_server();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![service_status, restart_server])
        .run(tauri::generate_context!())
        .expect("error saat menjalankan aplikasi Tauri");
}
