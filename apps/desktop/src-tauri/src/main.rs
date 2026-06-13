// Di Windows rilis, jangan buka jendela konsol di belakang aplikasi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vc_desktop_lib::run();
}
