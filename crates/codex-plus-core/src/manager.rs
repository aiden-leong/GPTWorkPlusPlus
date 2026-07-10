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
use crate::ccs_import;
use crate::codex_home;
use crate::diagnostic_log;
use crate::env_conflicts;
use crate::install::{self, InstallActionResult};
use crate::paths;
use crate::plugin_marketplace;
use crate::provider_import;
use crate::relay_config::{self, CodexContextEntries};
use crate::relay_switch;
use crate::script_market;
use crate::settings::{BackendSettings, RelayProfile, SettingsStore};
use crate::status::{LaunchStatus, StatusStore};
use crate::user_scripts::UserScriptManager;
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

impl SettingsPayload {
    /// 转成裸 Value，方便在 bridge path handler 里 `Ok(value.into_value())` 一行搞定。
    pub fn into_value(self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDoctorCheck {
    pub id: String,
    pub title: String,
    pub status: String,
    pub detail: String,
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
    default_user_script_manager()
        .inventory()
        .unwrap_or_else(|error| {
            json!({
                "enabled": true,
                "scripts": [],
                "error": error.to_string()
            })
        })
}

fn default_user_script_manager() -> UserScriptManager {
    UserScriptManager::new(
        paths::default_app_state_dir().join("builtin-scripts"),
        paths::default_app_state_dir().join("user-scripts"),
        paths::default_app_state_dir().join("user-scripts.json"),
    )
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
// CCS providers（cc-switch / Claude Code Switch 供应商导入）
// =============================================================================

pub fn load_ccs_providers() -> Value {
    let db_path = ccs_import::default_ccs_db_path();
    match ccs_import::list_codex_providers_from_default_db() {
        Ok(providers) => json!({
            "dbPath": db_path.to_string_lossy().to_string(),
            "providers": providers,
        }),
        Err(error) => {
            log_manager_event(
                "manager.load_ccs_providers_failed",
                json!({"error": error.to_string()}),
            );
            json!({
                "dbPath": db_path.to_string_lossy().to_string(),
                "providers": [],
                "error": error.to_string(),
            })
        }
    }
}

pub fn import_ccs_providers() -> SettingsPayload {
    let providers = match ccs_import::list_codex_providers_from_default_db() {
        Ok(providers) => providers,
        Err(error) => {
            log_manager_event(
                "manager.import_ccs_providers_failed",
                json!({"error": error.to_string()}),
            );
            return load_settings();
        }
    };

    let store = SettingsStore::default();
    let mut settings = store.load().unwrap_or_default();
    let mut existing_keys: Vec<String> = settings
        .relay_profiles
        .iter()
        .map(ccs_import::imported_provider_identity)
        .collect();
    let mut existing_ids: Vec<String> = settings
        .relay_profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect();
    let mut imported = 0usize;

    for provider in providers {
        let key = ccs_import::provider_identity_from_ccs(&provider);
        if existing_keys.iter().any(|existing| existing == &key) {
            continue;
        }
        let profile = ccs_import::relay_profile_from_ccs(&provider, &existing_ids);
        existing_ids.push(profile.id.clone());
        existing_keys.push(key);
        settings.relay_profiles.push(profile);
        imported += 1;
    }

    let _ = store.save(&settings);
    log_manager_event(
        "manager.import_ccs_providers",
        json!({"imported": imported}),
    );
    load_settings()
}

pub fn load_pending_provider_import() -> Value {
    let db_path = ccs_import::default_ccs_db_path();
    match provider_import::load_pending_provider_import() {
        Ok(pending) => json!({
            "pending": pending,
            "dbPath": db_path.to_string_lossy().to_string(),
        }),
        Err(error) => {
            log_manager_event(
                "manager.load_pending_provider_import_failed",
                json!({"error": error.to_string()}),
            );
            json!({
                "pending": null,
                "dbPath": db_path.to_string_lossy().to_string(),
                "error": error.to_string(),
            })
        }
    }
}

pub fn confirm_pending_provider_import(request: provider_import::ProviderImportRequest) -> SettingsPayload {
    match provider_import::import_provider(request) {
        Ok(_result) => {
            log_manager_event("manager.confirm_provider_import", json!({}));
            load_settings()
        }
        Err(error) => {
            log_manager_event(
                "manager.confirm_provider_import_failed",
                json!({"error": error.to_string()}),
            );
            load_settings()
        }
    }
}

pub fn dismiss_pending_provider_import() -> Value {
    match provider_import::clear_pending_provider_import() {
        Ok(()) => json!({"pending": null}),
        Err(error) => {
            log_manager_event(
                "manager.dismiss_pending_provider_import_failed",
                json!({"error": error.to_string()}),
            );
            json!({"pending": null, "error": error.to_string()})
        }
    }
}

// =============================================================================
// Script market + user scripts
// =============================================================================

pub async fn refresh_script_market() -> Value {
    let url = script_market::DEFAULT_MARKET_INDEX_URL;
    match script_market::fetch_market_manifest(url).await {
        Ok(manifest) => {
            let manager = default_user_script_manager();
            let installed = manager.load_config().market.values().cloned().collect::<Vec<_>>();
            json!({
                "market": serde_json::to_value(&manifest).unwrap_or(Value::Null),
                "installed": installed,
            })
        }
        Err(error) => {
            log_manager_event(
                "manager.refresh_script_market_failed",
                json!({"error": error.to_string()}),
            );
            json!({
                "market": {"version": 0, "scripts": []},
                "installed": [],
                "error": error.to_string(),
            })
        }
    }
}

pub async fn install_market_script(id: &str) -> Value {
    let url = script_market::DEFAULT_MARKET_INDEX_URL;
    let manager = default_user_script_manager();
    let manifest = match script_market::fetch_market_manifest(url).await {
        Ok(m) => m,
        Err(error) => {
            log_manager_event(
                "manager.install_market_script_failed",
                json!({"id": id, "stage": "fetch_manifest", "error": error.to_string()}),
            );
            return json!({
                "error": error.to_string(),
                "installed": [],
            });
        }
    };
    let Some(script) = manifest.scripts.into_iter().find(|s| s.id == id) else {
        return json!({
            "error": format!("market 中没有 id={id} 的脚本"),
            "installed": [],
        });
    };
    match script_market::install_market_script(&manager, &script).await {
        Ok(()) => {
            let _ = manager.record_market_install(&script);
            log_manager_event(
                "manager.install_market_script",
                json!({"id": id}),
            );
            json!({
                "installed": [{"id": id}],
            })
        }
        Err(error) => {
            log_manager_event(
                "manager.install_market_script_failed",
                json!({"id": id, "stage": "install", "error": error.to_string()}),
            );
            json!({
                "error": error.to_string(),
                "installed": [],
            })
        }
    }
}

pub fn set_user_script_enabled(key: &str, enabled: bool) -> Value {
    let manager = default_user_script_manager();
    match manager.set_script_enabled(key, enabled) {
        Ok(_config) => {
            log_manager_event(
                "manager.set_user_script_enabled",
                json!({"key": key, "enabled": enabled}),
            );
            user_script_inventory_value()
        }
        Err(error) => {
            log_manager_event(
                "manager.set_user_script_enabled_failed",
                json!({"key": key, "error": error.to_string()}),
            );
            json!({
                "key": key,
                "enabled": enabled,
                "error": error.to_string(),
            })
        }
    }
}

pub fn delete_user_script(key: &str) -> Value {
    let manager = default_user_script_manager();
    match manager.delete_user_script(key) {
        Ok(_config) => {
            log_manager_event(
                "manager.delete_user_script",
                json!({"key": key}),
            );
            user_script_inventory_value()
        }
        Err(error) => {
            log_manager_event(
                "manager.delete_user_script_failed",
                json!({"key": key, "error": error.to_string()}),
            );
            json!({
                "key": key,
                "error": error.to_string(),
            })
        }
    }
}

// =============================================================================
// Local sessions（用 codex-plus-storage 的 SQLiteStorageAdapter）
// =============================================================================

pub fn list_local_sessions() -> Value {
    let db_path = codex_plus_storage::codex_sqlite::codex_session_db_path();
    let backup_store = codex_plus_storage::BackupStore::new(
        paths::default_app_state_dir().join("backups"),
    );
    let adapter = codex_plus_storage::SQLiteStorageAdapter::new(db_path.clone(), backup_store);
    let sessions = adapter.list_local_sessions().unwrap_or_else(|error| {
        log_manager_event(
            "manager.list_local_sessions_failed",
            json!({"error": error.to_string()}),
        );
        Vec::new()
    });
    json!({
        "dbPath": db_path.to_string_lossy().to_string(),
        "sessions": sessions,
    })
}

pub fn delete_local_session(request: DeleteLocalSessionRequest) -> Value {
    let db_paths = if let Some(specific) = request.db_path.as_deref() {
        vec![PathBuf::from(specific)]
    } else {
        codex_plus_storage::codex_sqlite::codex_session_db_paths_from_home(
            &codex_home::default_codex_home_dir(),
        )
    };
    let backup_store = codex_plus_storage::BackupStore::new(
        paths::default_app_state_dir().join("backups"),
    );
    let session_ref = codex_plus_storage::models::SessionRef {
        session_id: request.session_id.clone(),
        title: request.title.clone(),
    };
    let result = codex_plus_storage::delete_local_from_paths(
        db_paths,
        backup_store,
        &session_ref,
    );
    log_manager_event(
        "manager.delete_local_session",
        json!({
            "sessionId": request.session_id,
            "title": request.title,
        }),
    );
    serde_json::to_value(&result).unwrap_or(Value::Null)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLocalSessionRequest {
    pub session_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub db_path: Option<String>,
}

// =============================================================================
// 仍然 stub 的端点
// =============================================================================

pub async fn fetch_relay_profile_models(payload: Value) -> Value {
    let profile = match parse_relay_profile_payload(&payload) {
        Ok(p) => p,
        Err(error) => {
            return json!({
                "status": "failed",
                "models": [],
                "endpoint": String::new(),
                "message": format!("解析 profile 失败：{error}"),
            });
        }
    };
    let profile_name = if profile.name.trim().is_empty() {
        "未命名供应商"
    } else {
        profile.name.trim()
    };
    match crate::model_catalog::fetch_relay_profile_model_ids(&profile).await {
        Ok((models, endpoint)) => json!({
            "status": "ok",
            "models": models,
            "endpoint": endpoint,
            "message": format!("已从「{profile_name}」获取 {} 个模型。", models.len()),
        }),
        Err(error) => json!({
            "status": "failed",
            "models": [],
            "endpoint": String::new(),
            "message": format!("从「{profile_name}」获取模型失败：{error}"),
        }),
    }
}

pub async fn diagnose_relay_profile(payload: Value) -> Value {
    let profile = match parse_relay_profile_payload(&payload) {
        Ok(p) => p,
        Err(error) => {
            return json!({
                "status": "failed",
                "profileName": "",
                "model": "",
                "summary": format!("解析 profile 失败：{error}"),
                "recommendation": "检查 profile JSON 结构。",
                "checks": [],
            });
        }
    };
    let profile_name = if profile.name.trim().is_empty() {
        "未命名供应商".to_string()
    } else {
        profile.name.trim().to_string()
    };
    let settings = SettingsStore::default().load().unwrap_or_default();
    let test_model = if !profile.test_model.trim().is_empty() {
        profile.test_model.trim().to_string()
    } else {
        let from_profile = relay_config::relay_profile_model(&profile);
        if from_profile.trim().is_empty() {
            settings.relay_test_model.trim().to_string()
        } else {
            from_profile
        }
    };
    let mut checks: Vec<ProviderDoctorCheck> = Vec::new();

    if profile.relay_mode == crate::settings::RelayMode::Official && !profile.official_mix_api_key {
        checks.push(ProviderDoctorCheck {
            id: "config".to_string(),
            title: "配置完整性".to_string(),
            status: "ok".to_string(),
            detail: "官方登录供应商不需要 Base URL / API Key。".to_string(),
        });
        return json!({
            "status": "ok",
            "profileName": profile_name,
            "model": test_model,
            "summary": "官方登录供应商无需 API 诊断。",
            "recommendation": "如果 GPT Work 官方账号可用，直接使用官方登录模式即可。",
            "checks": checks,
        });
    }

    if relay_config::relay_profile_base_url(&profile).trim().is_empty()
        || relay_config::relay_profile_api_key(&profile).trim().is_empty()
    {
        checks.push(ProviderDoctorCheck {
            id: "config".to_string(),
            title: "配置完整性".to_string(),
            status: "failed".to_string(),
            detail: "Base URL 或 API Key 为空。".to_string(),
        });
        return json!({
            "status": "failed",
            "profileName": profile_name,
            "model": test_model,
            "summary": "配置不完整，无法发起上游诊断。",
            "recommendation": "先填写 Base URL 和 API Key；如果是官方账号，请切换到官方登录模式。",
            "checks": checks,
        });
    }

    checks.push(ProviderDoctorCheck {
        id: "config".to_string(),
        title: "配置完整性".to_string(),
        status: "ok".to_string(),
        detail: format!(
            "{} ({})",
            relay_config::relay_profile_base_url(&profile),
            match profile.protocol {
                crate::settings::RelayProtocol::Responses => "Responses API",
                crate::settings::RelayProtocol::ChatCompletions => "Chat Completions",
            }
        ),
    });

    match crate::model_catalog::fetch_relay_profile_model_ids(&profile).await {
        Ok((models, endpoint)) => {
            let contains_model = !test_model.trim().is_empty()
                && models.iter().any(|model| model == test_model.trim());
            let status = if models.is_empty() {
                "failed"
            } else if contains_model || test_model.trim().is_empty() {
                "ok"
            } else {
                "warning"
            };
            let detail = if models.is_empty() {
                format!("{endpoint} 返回 0 个模型。")
            } else if contains_model || test_model.trim().is_empty() {
                format!("{endpoint} 返回 {} 个模型。", models.len())
            } else {
                format!(
                    "{endpoint} 返回 {} 个模型，但未看到测试模型「{}」。",
                    models.len(),
                    test_model
                )
            };
            checks.push(ProviderDoctorCheck {
                id: "models".to_string(),
                title: "模型列表".to_string(),
                status: status.to_string(),
                detail,
            });
        }
        Err(error) => checks.push(ProviderDoctorCheck {
            id: "models".to_string(),
            title: "模型列表".to_string(),
            status: "failed".to_string(),
            detail: error.to_string(),
        }),
    }

    match relay_config::test_relay_profile(&profile, &test_model).await {
        Ok(result) => {
            let status = if result.http_status < 400 { "ok" } else { "failed" };
            let preview = result.response_preview.trim();
            checks.push(ProviderDoctorCheck {
                id: "request".to_string(),
                title: "真实请求".to_string(),
                status: status.to_string(),
                detail: if preview.is_empty() {
                    format!(
                        "{} 返回 HTTP {}，响应内容为空。",
                        result.endpoint, result.http_status
                    )
                } else {
                    format!(
                        "{} 返回 HTTP {}：{}",
                        result.endpoint, result.http_status, preview
                    )
                },
            });
        }
        Err(error) => checks.push(ProviderDoctorCheck {
            id: "request".to_string(),
            title: "真实请求".to_string(),
            status: "failed".to_string(),
            detail: error.to_string(),
        }),
    }

    let failed_count = checks.iter().filter(|c| c.status == "failed").count();
    let warning_count = checks.iter().filter(|c| c.status == "warning").count();
    let overall = if failed_count > 0 { "failed" } else { "ok" };
    let summary = if failed_count > 0 {
        format!("发现 {failed_count} 项失败，GPT Work 可能无法使用该供应商。")
    } else if warning_count > 0 {
        format!("基础连接可用，但有 {warning_count} 项需要确认。")
    } else {
        "供应商基础诊断通过。".to_string()
    };
    let recommendation = provider_doctor_recommendation(&checks);
    log_manager_event(
        "manager.diagnose_relay_profile",
        json!({
            "profileName": profile_name,
            "failedCount": failed_count,
            "warningCount": warning_count,
        }),
    );
    json!({
        "status": overall,
        "profileName": profile_name,
        "model": test_model,
        "summary": summary,
        "recommendation": recommendation,
        "checks": checks,
    })
}

/// 解析 fetch / diagnose 接口里的 `profile` 字段 —— 兼容：
/// - 直接是 RelayProfile JSON
/// - 包在 `{ "profile": { ... } }` 里
/// - 包在 `{ "profile": { relayProfiles, activeRelayId } }`（从 active 取）
fn parse_relay_profile_payload(payload: &Value) -> anyhow::Result<RelayProfile> {
    if let Some(profile) = payload.get("profile") {
        if let Ok(p) = serde_json::from_value::<RelayProfile>(profile.clone()) {
            return Ok(p);
        }
        if let Ok(settings) = serde_json::from_value::<BackendSettings>(profile.clone()) {
            if let Some(p) = settings
                .relay_profiles
                .into_iter()
                .find(|p| p.id == settings.active_relay_id)
            {
                return Ok(p);
            }
        }
    }
    if let Ok(p) = serde_json::from_value::<RelayProfile>(payload.clone()) {
        return Ok(p);
    }
    anyhow::bail!("无法解析 RelayProfile，期望 {{profile: {{...}}}} 或裸 RelayProfile JSON")
}

fn provider_doctor_recommendation(checks: &[ProviderDoctorCheck]) -> String {
    if checks
        .iter()
        .any(|c| c.id == "config" && c.status == "failed")
    {
        return "先补齐 Base URL 和 API Key；如果使用官方账号，请切换到官方登录模式。".to_string();
    }
    if checks
        .iter()
        .any(|c| c.id == "models" && c.status == "failed")
    {
        return "优先检查 Base URL 是否包含正确的 /v1 前缀，以及供应商是否支持 /v1/models。"
            .to_string();
    }
    if checks
        .iter()
        .any(|c| c.id == "request" && c.status == "failed")
    {
        return "优先检查测试模型名称、上游协议选择和 Key 权限；如果 Chat Completions 可用，请切到对应协议。"
            .to_string();
    }
    if checks.iter().any(|c| c.status == "warning") {
        return "模型列表可用，但测试模型没找到；可在供应商配置中调整测试模型或确认上游确实支持该模型。"
            .to_string();
    }
    String::new()
}

pub fn repair_plugin_marketplace() -> Value {
    // plugin_marketplace::ensure_openai_curated_marketplace_config 现成 API
    let home = codex_home::default_codex_home_dir();
    match plugin_marketplace::ensure_openai_curated_marketplace_config(&home) {
        Ok(_configured) => {
            log_manager_event("manager.repair_plugin_marketplace", json!({}));
            json!({
                "status": "ok",
                "codexHome": home.to_string_lossy().to_string(),
                "message": "插件市场已检查/配置。"
            })
        }
        Err(error) => {
            log_manager_event(
                "manager.repair_plugin_marketplace_failed",
                json!({"error": error.to_string()}),
            );
            json!({
                "status": "failed",
                "codexHome": home.to_string_lossy().to_string(),
                "message": error.to_string()
            })
        }
    }
}

pub fn repair_remote_plugin_marketplace() -> Value {
    let home = codex_home::default_codex_home_dir();
    match plugin_marketplace::ensure_openai_curated_remote_marketplace_config(&home) {
        Ok(_configured) => {
            log_manager_event("manager.repair_remote_plugin_marketplace", json!({}));
            json!({
                "status": "ok",
                "codexHome": home.to_string_lossy().to_string(),
                "message": "远端插件市场已检查/配置。"
            })
        }
        Err(error) => {
            log_manager_event(
                "manager.repair_remote_plugin_marketplace_failed",
                json!({"error": error.to_string()}),
            );
            json!({
                "status": "failed",
                "codexHome": home.to_string_lossy().to_string(),
                "message": error.to_string()
            })
        }
    }
}

pub fn load_provider_sync_targets() -> Value {
    let home = codex_home::default_codex_home_dir();
    let list = codex_plus_storage::load_provider_sync_targets(Some(&home));
    json!({
        "status": "ok",
        "currentProvider": list.current_provider,
        "targets": list.targets,
    })
}

pub fn sync_providers_now(target_provider: Option<String>) -> Value {
    let home = codex_home::default_codex_home_dir();
    let result = codex_plus_storage::run_provider_sync_with_target(
        Some(&home),
        target_provider.as_deref(),
    );
    json!({
        "status": match result.status {
            codex_plus_storage::ProviderSyncStatus::Synced => "synced",
            codex_plus_storage::ProviderSyncStatus::Skipped => "skipped",
            codex_plus_storage::ProviderSyncStatus::Disabled => "disabled",
        },
        "message": result.message,
        "targetProvider": result.target_provider,
        "changedSessionFiles": result.changed_session_files,
        "sqliteRowsUpdated": result.sqlite_rows_updated,
    })
}
