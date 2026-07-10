pub mod app_paths;
pub mod assets;
pub mod bridge;
pub mod ccs_import;
pub mod cdp;
pub mod codex_local_storage;
mod computer_use_guard;
pub mod env_conflicts;
pub mod http_api;
pub mod http_client;
pub mod install;
pub mod launcher;
pub mod manager;
pub mod model_catalog;

// 这几个模块搬到 codex-plus-storage（解开 core ↔ data 循环依赖），
// core 这里 re-export 一下保持下游代码（manager / routes 等）不改。
pub use codex_plus_storage::{codex_home, codex_sqlite, diagnostic_log, model_suffix, paths};
pub mod native_menu;
pub mod plugin_marketplace;
pub mod ports;
pub mod protocol_proxy;
pub mod provider_import;
pub mod proxy;
pub mod relay_config;
pub mod relay_rotation;
pub mod relay_switch;
pub mod routes;
pub mod script_market;
pub mod settings;
pub mod status;
pub mod stepwise;
pub mod upstream_worktree;
pub mod user_scripts;
pub mod version;
pub mod watcher;
#[cfg(windows)]
mod windows_integration;
pub mod zed_remote;

#[cfg(windows)]
pub fn windows_create_no_window() -> u32 {
    windows_integration::CREATE_NO_WINDOW
}

#[cfg(windows)]
pub fn windows_open_url(url: &str) -> anyhow::Result<()> {
    windows_integration::open_url(url)
}

#[cfg(windows)]
pub fn windows_activate_process_window(process_id: u32) -> bool {
    windows_integration::activate_process_window(process_id)
}

#[cfg(windows)]
pub fn windows_apply_codexplusplus_icon_to_process_window(
    process_id: u32,
    icon_resource_path: std::path::PathBuf,
) -> bool {
    windows_integration::apply_codexplusplus_icon_to_process_window(process_id, icon_resource_path)
}

#[cfg(windows)]
pub fn windows_enumerate_processes() -> Vec<windows_integration::WindowsProcessInfo> {
    windows_integration::enumerate_processes()
}
