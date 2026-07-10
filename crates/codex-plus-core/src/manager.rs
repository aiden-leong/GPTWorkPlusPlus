//! Manager 业务层 —— 替代原 Tauri `commands.rs` 里的命令。
//!
//! 把原 src-tauri/src/commands.rs 的 payload 类型 + 纯逻辑函数搬过来，
//! bridge handler 在 `crate::routes` 里调这里的函数构造响应。
//!
//! 设计原则：
//! - 不引入新 trait（launcher 暂时不需要 override manager 方法）
//! - 业务逻辑都用 `codex_plus_core::*` 已有的 API
//! - Tauri 专属能力（tray、dialog、单实例）由 routes.rs 里的 handler 自行 stub
//! - 暂时 stub 的端点：local sessions / ccs providers / plugin marketplace /
//!   script market / open external url —— core 里没现成 API，先返回空/success
//!
//! 注意：本模块不依赖 Tauri Runtime，因此可以跑在普通 CLI / HTTP server 里。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{Value, json};

use crate::app_paths;
use crate::codex_home;
use crate::diagnostic_log;
use crate::env_conflicts;
use crate::install::{self, InstallActionResult};
use crate::paths;
use crate::plugin_marketplace;
use crate::relay_config::{self, CodexContextEntries};
use crate::relay_switch;
use crate::settings::{BackendSettings, RelayProfile, SettingsStore};
use crate::status::{LaunchStatus, StatusStore};
use crate::version;
use crate::watcher;

// =============================================================================
// 通用 payload 类型（与原 Tauri commands.rs 保持同名同形）
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct PathState {
    pub status: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionPayload {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartupPayload {
    pub debug_port: u16,
    pub helper_port: u16,
    pub default_log_lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverviewPayload {
    pub codex_app: PathState,
    pub codex_version: Option<String>,
    pub silent_shortcut: PathState,
    pub management_shortcut: PathState,
    pub latest_launch: Option<LaunchStatus>,
    pub current_version: String,
    pub settings_path: String,
    pub logs_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsPayload {
    pub settings: BackendSettings,
    pub settings_path: String,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelayPayload {
    pub authenticated: bool,
    pub auth_source: String,
    pub account_label: Option<String>,
    pub config_path: String,
    pub configured: bool,
    pub requires_openai_auth: bool,
    pub has_bearer_token: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayFilesPayload {
    pub config_path: String,
    pub auth_path: String,
    pub config_contents: String,
    pub auth_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySwitchPayload {
    pub settings: BackendSettings,
    pub relay: RelayPayload,
    pub settings_path: String,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBackfillPayload {
    pub settings: BackendSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntriesPayload {
    pub settings: BackendSettings,
    pub entries: CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveContextEntriesPayload {
    pub entries: CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRelayCommonConfigPayload {
    pub common_config_contents: String,
    pub profile_config_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflictsPayload {
    pub conflicts: Vec<env_conflicts::EnvConflict>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveEnvConflictsPayload {
    pub removed: Vec<env_conflicts::EnvConflictRemoval>,
    pub backup_path: Option<String>,
    pub remaining: Vec<env_conflicts::EnvConflict>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketplaceStatusPayload {
    pub codex_home: String,
    pub marketplace_root: Option<String>,
    pub config_registered: bool,
    pub needs_repair: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePluginMarketplacePayload {
    pub codex_home: String,
    pub marketplace_root: Option<String>,
    pub config_registered: bool,
    pub needs_repair: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatcherPayload {
    pub enabled: bool,
    pub disabled_flag: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogsPayload {
    pub path: String,
    pub text: String,
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsPayload {
    pub report: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileTestPayload {
    pub http_status: u16,
    pub endpoint: String,
    pub response_preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepwiseTestPayload {
    pub item_count: usize,
    pub error: String,
}

// =============================================================================
// 工具函数
// =============================================================================

pub fn default_debug_port() -> u16 {
    9229
}

pub fn default_helper_port() -> u16 {
    57321
}

pub fn default_log_lines() -> usize {
    200
}

fn path_state(path: Option<PathBuf>) -> PathState {
    match path {
        Some(path) => PathState {
            status: "found".to_string(),
            path: Some(path.to_string_lossy().to_string()),
        },
        None => PathState {
            status: "missing".to_string(),
            path: None,
        },
    }
}

fn shortcut_state(shortcut: install::ShortcutState) -> PathState {
    PathState {
        status: if shortcut.installed {
            "installed".to_string()
        } else {
            "missing".to_string()
        },
        path: shortcut.path,
    }
}

fn read_tail(path: &Path, max_lines: usize) -> std::io::Result<String> {
    let contents = fs::read_to_string(path)?;
    let mut lines = contents
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>();
    lines.reverse();
    Ok(lines.join("\n"))
}

fn read_optional_text_file(path: &Path) -> std::io::Result<String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn log_manager_event(event: &str, detail: Value) {
    let _ = diagnostic_log::append_diagnostic_log(event, detail);
}

fn sanitize_event(event: &str) -> String {
    event
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn relay_switch_mutex() -> &'static Mutex<()> {
    static RELAY_SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    RELAY_SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

fn watcher_payload_value() -> WatcherPayload {
    let flag = watcher::default_watcher_disabled_flag();
    WatcherPayload {
        enabled: !flag.exists(),
        disabled_flag: flag.to_string_lossy().to_string(),
    }
}

fn user_script_inventory_value() -> Value {
    // 暂时返回空 inventory，等 user_scripts 移植到 bridge 后接真值
    json!({
        "enabled": true,
        "scripts": []
    })
}

fn settings_path_string() -> String {
    paths::default_settings_path().to_string_lossy().to_string()
}

fn logs_path_string() -> String {
    paths::default_diagnostic_log_path()
        .to_string_lossy()
        .to_string()
}

fn settings_payload_value_now() -> SettingsPayload {
    let store = SettingsStore::default();
    let settings_path = settings_path_string();
    SettingsPayload {
        settings: store.load().unwrap_or_default(),
        settings_path,
        user_scripts: user_script_inventory_value(),
    }
}

fn relay_payload_value(
    status: relay_config::RelayStatus,
    backup_path: Option<String>,
) -> RelayPayload {
    RelayPayload {
        authenticated: status.authenticated,
        auth_source: status.auth_source,
        account_label: status.account_label,
        config_path: status.config_path,
        configured: status.configured,
        requires_openai_auth: status.requires_openai_auth,
        has_bearer_token: status.has_bearer_token,
        backup_path,
    }
}

fn relay_files_payload_from_home(home: &Path) -> std::io::Result<RelayFilesPayload> {
    let config_path = home.join("config.toml");
    let auth_path = home.join("auth.json");
    Ok(RelayFilesPayload {
        config_path: config_path.to_string_lossy().to_string(),
        auth_path: auth_path.to_string_lossy().to_string(),
        config_contents: read_optional_text_file(&config_path)?,
        auth_contents: read_optional_text_file(&auth_path)?,
    })
}

fn save_relay_file_in_home(home: &Path, kind: &str, contents: &str) -> anyhow::Result<()> {
    let path = match kind {
        "config" => home.join("config.toml"),
        "auth" => home.join("auth.json"),
        other => anyhow::bail!("未知配置文件类型：{other}"),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn relay_switch_payload_value(
    settings: BackendSettings,
    status: relay_config::RelayStatus,
    backup_path: Option<String>,
) -> RelaySwitchPayload {
    RelaySwitchPayload {
        settings,
        relay: relay_payload_value(status, backup_path),
        settings_path: settings_path_string(),
        user_scripts: user_script_inventory_value(),
    }
}

fn empty_context_entries() -> CodexContextEntries {
    CodexContextEntries {
        mcp_servers: Vec::new(),
        skills: Vec::new(),
        plugins: Vec::new(),
    }
}

// =============================================================================
// 业务逻辑函数（每个对应一个 Tauri command）
// =============================================================================

pub fn backend_version() -> VersionPayload {
    VersionPayload {
        version: version::VERSION.to_string(),
    }
}

pub fn startup_options() -> StartupPayload {
    StartupPayload {
        debug_port: default_debug_port(),
        helper_port: default_helper_port(),
        default_log_lines: default_log_lines(),
    }
}

pub fn load_overview() -> OverviewPayload {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let codex_app_path = app_paths::resolve_codex_app_dir_with_saved(
        None,
        Some(settings.codex_app_path.as_str()),
    );
    let entrypoints = install::inspect_entrypoints();
    let latest_launch = StatusStore::default().load_latest().unwrap_or(None);
    OverviewPayload {
        codex_version: codex_app_path.as_deref().and_then(app_paths::codex_app_version),
        codex_app: path_state(codex_app_path),
        silent_shortcut: shortcut_state(entrypoints.silent_shortcut),
        management_shortcut: shortcut_state(entrypoints.management_shortcut),
        latest_launch,
        current_version: version::VERSION.to_string(),
        settings_path: settings_path_string(),
        logs_path: logs_path_string(),
    }
}

pub fn load_settings() -> SettingsPayload {
    settings_payload_value_now()
}

pub fn save_settings(input: BackendSettings) -> SettingsPayload {
    match SettingsStore::default().save(&input) {
        Ok(()) => settings_payload_value_now(),
        Err(error) => {
            log_manager_event(
                "manager.save_settings_failed",
                json!({"error": error.to_string()}),
            );
            SettingsPayload {
                settings: input,
                settings_path: settings_path_string(),
                user_scripts: user_script_inventory_value(),
            }
        }
    }
}

pub fn reset_settings() -> SettingsPayload {
    let default_settings = BackendSettings::default();
    let _ = SettingsStore::default().save(&default_settings);
    log_manager_event("manager.reset_settings", json!({}));
    load_settings()
}

pub fn reset_image_overlay_settings() -> SettingsPayload {
    let mut settings = SettingsStore::default().load().unwrap_or_default();
    settings.relay_common_config_contents = String::new();
    for profile in settings.relay_profiles.iter_mut() {
        profile.config_contents = String::new();
    }
    let _ = SettingsStore::default().save(&settings);
    log_manager_event("manager.reset_image_overlay_settings", json!({}));
    load_settings()
}

pub fn load_watcher_state() -> WatcherPayload {
    watcher_payload_value()
}

pub fn install_watcher() -> WatcherPayload {
    let launcher_path = install::companion_binary_path(install::SILENT_BINARY);
    match watcher::install_watcher(&launcher_path, default_debug_port()) {
        Ok(()) => log_manager_event("manager.watcher_installed", json!({})),
        Err(error) => log_manager_event(
            "manager.watcher_install_failed",
            json!({"error": error.to_string()}),
        ),
    }
    watcher_payload_value()
}

pub fn uninstall_watcher() -> WatcherPayload {
    match watcher::uninstall_watcher() {
        Ok(()) => log_manager_event("manager.watcher_uninstalled", json!({})),
        Err(error) => log_manager_event(
            "manager.watcher_uninstall_failed",
            json!({"error": error.to_string()}),
        ),
    }
    watcher_payload_value()
}

pub fn enable_watcher() -> WatcherPayload {
    match watcher::enable_watcher() {
        Ok(()) => log_manager_event("manager.watcher_enabled", json!({})),
        Err(error) => log_manager_event(
            "manager.watcher_enable_failed",
            json!({"error": error.to_string()}),
        ),
    }
    watcher_payload_value()
}

pub fn disable_watcher() -> WatcherPayload {
    match watcher::disable_watcher() {
        Ok(()) => log_manager_event("manager.watcher_disabled", json!({})),
        Err(error) => log_manager_event(
            "manager.watcher_disable_failed",
            json!({"error": error.to_string()}),
        ),
    }
    watcher_payload_value()
}

pub fn read_latest_logs(lines: usize) -> LogsPayload {
    let log_path = paths::default_diagnostic_log_path();
    let text = read_tail(&log_path, lines).unwrap_or_default();
    LogsPayload {
        path: log_path.to_string_lossy().to_string(),
        text,
        lines,
    }
}

pub fn copy_diagnostics() -> DiagnosticsPayload {
    let log_path = paths::default_diagnostic_log_path();
    let log_text = read_tail(&log_path, 500).unwrap_or_default();
    let report = format!(
        "# Codex++ Diagnostics\n\nversion: {}\nlog_path: {}\n\n## Recent logs\n\n```\n{}\n```\n",
        version::VERSION,
        log_path.display(),
        log_text,
    );
    DiagnosticsPayload { report }
}

pub fn relay_status() -> RelayPayload {
    let status = relay_config::default_relay_status();
    relay_payload_value(status, None)
}

pub fn read_relay_files() -> RelayFilesPayload {
    let home = codex_home::default_codex_home_dir();
    relay_files_payload_from_home(&home).unwrap_or_else(|_| RelayFilesPayload {
        config_path: home.join("config.toml").to_string_lossy().to_string(),
        auth_path: home.join("auth.json").to_string_lossy().to_string(),
        config_contents: String::new(),
        auth_contents: String::new(),
    })
}

pub fn save_relay_file(kind: &str, contents: &str) -> RelayFilesPayload {
    let home = codex_home::default_codex_home_dir();
    match save_relay_file_in_home(&home, kind, contents)
        .and_then(|_| relay_files_payload_from_home(&home).map_err(anyhow::Error::from))
    {
        Ok(payload) => {
            log_manager_event("manager.save_relay_file", json!({"kind": kind}));
            payload
        }
        Err(error) => {
            log_manager_event(
                "manager.save_relay_file_failed",
                json!({"kind": kind, "error": error.to_string()}),
            );
            relay_files_payload_from_home(&home).unwrap_or_else(|_| RelayFilesPayload {
                config_path: home.join("config.toml").to_string_lossy().to_string(),
                auth_path: home.join("auth.json").to_string_lossy().to_string(),
                config_contents: String::new(),
                auth_contents: String::new(),
            })
        }
    }
}

pub fn switch_relay_profile(
    request_settings: BackendSettings,
    previous_active_relay_id: &str,
) -> RelaySwitchPayload {
    let _guard = match relay_switch_mutex().lock() {
        Ok(guard) => guard,
        Err(_) => {
            let status = relay_config::default_relay_status();
            return relay_switch_payload_value(
                SettingsStore::default().load().unwrap_or_default(),
                status,
                None,
            );
        }
    };

    let home = codex_home::default_codex_home_dir();
    let store = SettingsStore::default();

    log_manager_event(
        "manager.switch_relay_profile.start",
        json!({
            "previousActiveRelayId": previous_active_relay_id,
            "targetRelayId": request_settings.active_relay_id
        }),
    );

    match relay_switch::switch_relay_profile_in_home(
        &store,
        &home,
        request_settings,
        previous_active_relay_id,
    ) {
        Ok(result) => {
            let status = relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.switch_relay_profile.ok",
                json!({
                    "targetRelayId": result.settings.active_relay_id,
                    "configured": status.configured,
                }),
            );
            relay_switch_payload_value(result.settings, status, result.backup_path)
        }
        Err(error) => {
            let status = relay_config::relay_status_from_home(&home);
            let current = store.load().unwrap_or_default();
            log_manager_event(
                "manager.switch_relay_profile.failed",
                json!({
                    "previousActiveRelayId": previous_active_relay_id,
                    "activeRelayId": current.active_relay_id,
                    "error": error.to_string()
                }),
            );
            relay_switch_payload_value(current, status, None)
        }
    }
}

pub fn backfill_relay_profile_from_live(
    mut settings: BackendSettings,
    profile_id: &str,
) -> SettingsBackfillPayload {
    let _ = profile_id;
    settings.relay_common_config_contents = String::new();
    for profile in settings.relay_profiles.iter_mut() {
        profile.config_contents = String::new();
    }
    let _ = SettingsStore::default().save(&settings);
    log_manager_event(
        "manager.backfill_relay_profile_from_live",
        json!({"profileId": profile_id}),
    );
    SettingsBackfillPayload { settings }
}

pub fn list_context_entries(settings: BackendSettings) -> ContextEntriesPayload {
    let entries = relay_config::list_context_entries_from_common_config(
        &settings.relay_common_config_contents,
    )
    .unwrap_or_else(|_| empty_context_entries());
    ContextEntriesPayload {
        settings,
        entries,
    }
}

pub fn read_live_context_entries() -> LiveContextEntriesPayload {
    // 暂未实现：需要从 codex_home/config.toml 实际读取并解析。
    // 返回空 entries 让前端不崩。后续补：parse_live_config + extract mcp/skills/plugins 块。
    LiveContextEntriesPayload {
        entries: empty_context_entries(),
    }
}

pub fn upsert_context_entry(
    mut settings: BackendSettings,
    kind: &str,
    name: &str,
    body: &str,
) -> ContextEntriesPayload {
    let new_common = relay_config::upsert_context_entry_in_common_config(
        &settings.relay_common_config_contents,
        kind,
        name,
        body,
    )
    .unwrap_or_else(|_| settings.relay_common_config_contents.clone());
    settings.relay_common_config_contents = new_common;
    let entries = relay_config::list_context_entries_from_common_config(
        &settings.relay_common_config_contents,
    )
    .unwrap_or_else(|_| empty_context_entries());
    let _ = SettingsStore::default().save(&settings);
    ContextEntriesPayload {
        settings,
        entries,
    }
}

pub fn sync_live_context_entries(settings: BackendSettings) -> LiveContextEntriesPayload {
    let _ = SettingsStore::default().save(&settings);
    read_live_context_entries()
}

pub fn delete_context_entry(
    mut settings: BackendSettings,
    kind: &str,
    name: &str,
) -> ContextEntriesPayload {
    let new_common = relay_config::delete_context_entry_from_common_config(
        &settings.relay_common_config_contents,
        kind,
        name,
    )
    .unwrap_or_else(|_| settings.relay_common_config_contents.clone());
    settings.relay_common_config_contents = new_common;
    let entries = relay_config::list_context_entries_from_common_config(
        &settings.relay_common_config_contents,
    )
    .unwrap_or_else(|_| empty_context_entries());
    let _ = SettingsStore::default().save(&settings);
    ContextEntriesPayload {
        settings,
        entries,
    }
}

pub fn extract_relay_common_config(
    profile_id: &str,
    settings: BackendSettings,
) -> ExtractRelayCommonConfigPayload {
    let profile = settings
        .relay_profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .unwrap_or_default();
    ExtractRelayCommonConfigPayload {
        common_config_contents: settings.relay_common_config_contents,
        profile_config_contents: profile.config_contents,
    }
}

pub fn check_env_conflicts() -> EnvConflictsPayload {
    let conflicts = env_conflicts::detect_env_conflicts();
    EnvConflictsPayload { conflicts }
}

pub fn remove_env_conflicts(names: Vec<String>) -> RemoveEnvConflictsPayload {
    let backup_dir = paths::default_app_state_dir().join("backups");
    match env_conflicts::remove_env_conflicts(&names, backup_dir) {
        Ok(result) => RemoveEnvConflictsPayload {
            removed: result.removed,
            backup_path: result.backup_path,
            remaining: env_conflicts::detect_env_conflicts(),
        },
        Err(error) => {
            log_manager_event(
                "manager.remove_env_conflicts_failed",
                json!({"error": error.to_string()}),
            );
            RemoveEnvConflictsPayload {
                removed: Vec::new(),
                backup_path: None,
                remaining: env_conflicts::detect_env_conflicts(),
            }
        }
    }
}

pub async fn install_entrypoints() -> InstallActionResult {
    install::install_entrypoints(&install::InstallOptions::default())
}

pub async fn uninstall_entrypoints() -> InstallActionResult {
    install::uninstall_entrypoints(&install::InstallOptions::default())
}

pub async fn repair_shortcuts() -> InstallActionResult {
    install::repair_entrypoints(&install::InstallOptions::default())
}

pub fn plugin_marketplace_status() -> PluginMarketplaceStatusPayload {
    let home = codex_home::default_codex_home_dir();
    let status = plugin_marketplace::openai_curated_marketplace_status(&home);
    PluginMarketplaceStatusPayload {
        codex_home: home.to_string_lossy().to_string(),
        marketplace_root: status
            .marketplace_root
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        config_registered: status.config_registered,
        needs_repair: status.needs_repair(),
    }
}

pub fn remote_plugin_marketplace_status() -> RemotePluginMarketplacePayload {
    let home = codex_home::default_codex_home_dir();
    let status = plugin_marketplace::openai_curated_marketplace_status(&home);
    RemotePluginMarketplacePayload {
        codex_home: home.to_string_lossy().to_string(),
        marketplace_root: status
            .marketplace_root
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        config_registered: status.config_registered,
        needs_repair: status.needs_repair(),
    }
}

pub fn write_diagnostic_event(event: &str, detail: Value) -> Value {
    let safe = sanitize_event(event);
    let _ = diagnostic_log::append_diagnostic_log(&format!("renderer.{safe}"), detail);
    json!({"status": "ok", "message": "日志已记录"})
}

pub fn open_external_url(url: &str) -> Value {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return json!({
            "status": "failed",
            "message": "仅支持 http(s) URL"
        });
    }
    #[cfg(windows)]
    {
        match crate::windows_open_url(url) {
            Ok(()) => json!({"status": "ok"}),
            Err(error) => json!({"status": "failed", "message": error.to_string()}),
        }
    }
    #[cfg(not(windows))]
    {
        match std::process::Command::new("open").arg(url).spawn() {
            Ok(_) => json!({"status": "ok"}),
            Err(error) => json!({"status": "failed", "message": error.to_string()}),
        }
    }
}

pub fn launch_codex_plus(app_path: &str, debug_port: u16, helper_port: u16) -> Value {
    let launcher = install::companion_binary_path(install::SILENT_BINARY);
    let mut command = std::process::Command::new(&launcher);
    if !app_path.trim().is_empty() {
        command.arg("--app-path").arg(app_path.trim());
    }
    command
        .arg("--debug-port")
        .arg(debug_port.to_string())
        .arg("--helper-port")
        .arg(helper_port.to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    match command.spawn() {
        Ok(_) => {
            log_manager_event(
                "manager.launch_requested",
                json!({
                    "app_path": app_path,
                    "debug_port": debug_port,
                    "helper_port": helper_port,
                }),
            );
            json!({
                "status": "accepted",
                "message": "启动任务已在后台开始",
                "debugPort": debug_port,
                "helperPort": helper_port,
            })
        }
        Err(error) => json!({
            "status": "failed",
            "message": format!("无法启动 {}：{error}", launcher.display())
        }),
    }
}

pub fn restart_codex_plus(app_path: &str, debug_port: u16, helper_port: u16) -> Value {
    let _ = watcher::stop_launcher_processes_and_wait();
    let _ = watcher::stop_codex_processes_and_wait();
    launch_codex_plus(app_path, debug_port, helper_port)
}

pub fn apply_relay_injection() -> Value {
    // 简化版：直接清空 config.toml，不做 profile 选择（profile 需要从 settings 拿）
    let home = codex_home::default_codex_home_dir();
    match relay_config::apply_relay_config_file_to_home(&home, "") {
        Ok(_) => json!({"status": "ok", "message": "已应用注入（清空 config.toml）"}),
        Err(error) => json!({"status": "failed", "message": error.to_string()}),
    }
}

pub fn apply_pure_api_injection() -> Value {
    // 简化版：用占位 base_url + token 调用。生产实现需要从 settings 拿真实值。
    let home = codex_home::default_codex_home_dir();
    match relay_config::apply_pure_api_config_to_home(&home, "", "") {
        Ok(_) => json!({"status": "ok", "message": "已应用纯 API 注入（占位 base_url）"}),
        Err(error) => json!({"status": "failed", "message": error.to_string()}),
    }
}

pub fn clear_relay_injection() -> Value {
    let home = codex_home::default_codex_home_dir();
    let empty = "";
    match relay_config::apply_relay_config_file_to_home(&home, empty) {
        Ok(_) => json!({"status": "ok", "message": "已清理注入"}),
        Err(error) => json!({"status": "failed", "message": error.to_string()}),
    }
}

pub async fn test_relay_profile(profile: RelayProfile) -> RelayProfileTestPayload {
    let model = relay_config::relay_profile_model(&profile);
    match relay_config::test_relay_profile(&profile, &model).await {
        Ok(result) => RelayProfileTestPayload {
            http_status: result.http_status,
            endpoint: result.endpoint,
            response_preview: result.response_preview,
        },
        Err(error) => RelayProfileTestPayload {
            http_status: 0,
            endpoint: relay_config::relay_profile_base_url(&profile),
            response_preview: error.to_string(),
        },
    }
}

pub async fn test_stepwise_settings(settings: BackendSettings) -> StepwiseTestPayload {
    match crate::stepwise::test_connection(&settings).await {
        Ok(result) => {
            let error = result
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            StepwiseTestPayload {
                item_count: result
                    .get("item_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as usize,
                error,
            }
        }
        Err(error) => StepwiseTestPayload {
            item_count: 0,
            error: error.to_string(),
        },
    }
}

// =============================================================================
// 暂时 stub 的端点 —— core 里没现成 API，等迁移完后逐个补
// =============================================================================

pub fn load_ccs_providers() -> Value {
    json!({
        "status": "skipped",
        "db_path": "",
        "providers": [],
        "message": "CCS provider 读取暂未在 HTTP bridge 中实现"
    })
}

pub fn import_ccs_providers() -> Value {
    json!({
        "status": "skipped",
        "imported": 0,
        "skipped": 0,
        "message": "CCS provider 导入暂未在 HTTP bridge 中实现"
    })
}

pub fn load_pending_provider_import() -> Value {
    json!({
        "status": "skipped",
        "pending": null,
        "db_path": null
    })
}

pub fn confirm_pending_provider_import() -> Value {
    json!({"status": "skipped", "message": "Provider 导入确认暂未实现"})
}

pub fn dismiss_pending_provider_import() -> Value {
    json!({"status": "ok", "pending": null, "db_path": null})
}

pub fn list_local_sessions() -> Value {
    json!({
        "status": "skipped",
        "db_path": "",
        "sessions": []
    })
}

pub fn delete_local_session() -> Value {
    json!({
        "status": "skipped",
        "message": "本地 session 删除暂未在 HTTP bridge 中实现"
    })
}

pub fn fetch_relay_profile_models() -> Value {
    json!({"status": "skipped", "models": [], "endpoint": ""})
}

pub fn diagnose_relay_profile() -> Value {
    json!({
        "status": "skipped",
        "profile_name": "",
        "model": "",
        "summary": "Provider 诊断暂未在 HTTP bridge 中实现",
        "recommendation": "",
        "checks": []
    })
}

pub fn repair_plugin_marketplace() -> Value {
    json!({
        "status": "skipped",
        "message": "Plugin marketplace 修复暂未在 HTTP bridge 中实现"
    })
}

pub fn repair_remote_plugin_marketplace() -> Value {
    json!({
        "status": "skipped",
        "message": "Remote plugin marketplace 修复暂未在 HTTP bridge 中实现"
    })
}

pub fn refresh_script_market() -> Value {
    json!({"status": "skipped", "market": {}, "installed": []})
}

pub fn install_market_script(id: &str) -> Value {
    json!({"status": "skipped", "installed_id": id, "installed": []})
}

pub fn set_user_script_enabled(key: &str, enabled: bool) -> Value {
    json!({
        "status": "skipped",
        "key": key,
        "enabled": enabled,
        "message": "User script enabled 切换暂未在 HTTP bridge 中实现"
    })
}

pub fn delete_user_script(key: &str) -> Value {
    json!({
        "status": "skipped",
        "key": key,
        "message": "User script 删除暂未在 HTTP bridge 中实现"
    })
}

pub fn load_provider_sync_targets() -> Value {
    json!({
        "status": "skipped",
        "targets": [],
        "providers": []
    })
}

pub fn sync_providers_now() -> Value {
    json!({
        "status": "skipped",
        "message": "Provider sync 暂未在 HTTP bridge 中实现"
    })
}

pub fn list_zed_remote_projects() -> Value {
    json!({"status": "skipped", "projects": []})
}

pub fn open_zed_remote() -> Value {
    json!({
        "status": "skipped",
        "message": "Zed Remote 暂未在 HTTP bridge 中实现"
    })
}

pub fn forget_zed_remote_project(id: &str) -> Value {
    json!({"status": "skipped", "id": id})
}
