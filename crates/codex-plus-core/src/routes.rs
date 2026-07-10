use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{Value, json};

use codex_plus_storage::models::{
    DeleteResult, DeleteStatus, ExportResult, ExportStatus, SessionRef,
};
use crate::settings::{BackendSettings, SettingsStore};
use crate::status::StatusStore;
use crate::user_scripts::UserScriptManager;

pub type UserScriptEvaluator = Arc<dyn Fn(&str, &str) -> anyhow::Result<Value> + Send + Sync>;
pub type DevtoolsOpener = Arc<dyn Fn(&str) -> anyhow::Result<()> + Send + Sync>;

#[derive(Clone)]
pub struct BridgeContext {
    settings: Arc<dyn BridgeSettingsService>,
    runtime: Arc<dyn BridgeRuntimeService>,
    data: Arc<dyn BridgeDataService>,
}

impl BridgeContext {
    pub fn new(
        settings: Arc<dyn BridgeSettingsService>,
        runtime: Arc<dyn BridgeRuntimeService>,
        data: Arc<dyn BridgeDataService>,
    ) -> Self {
        Self {
            settings,
            runtime,
            data,
        }
    }

    pub fn core(runtime: Arc<dyn BridgeRuntimeService>) -> Self {
        Self::core_with_data(runtime, Arc::new(UnavailableDataService))
    }

    pub fn core_with_data(
        runtime: Arc<dyn BridgeRuntimeService>,
        data: Arc<dyn BridgeDataService>,
    ) -> Self {
        Self::new(Arc::new(CoreSettingsService::default()), runtime, data)
    }

    pub fn core_with_data_and_app_dir(
        runtime: Arc<dyn BridgeRuntimeService>,
        data: Arc<dyn BridgeDataService>,
        app_dir: PathBuf,
    ) -> Self {
        Self::new(
            Arc::new(CoreSettingsService::with_app_dir(app_dir)),
            runtime,
            data,
        )
    }
}

#[async_trait]
pub trait BridgeSettingsService: Send + Sync {
    async fn get_settings(&self) -> anyhow::Result<BackendSettings>;
    async fn set_settings(&self, payload: Value) -> anyhow::Result<BackendSettings>;

    async fn codex_app_version(&self) -> anyhow::Result<String> {
        Ok(String::new())
    }
}

#[async_trait]
pub trait BridgeRuntimeService: Send + Sync {
    async fn user_script_inventory(&self) -> anyhow::Result<Value>;
    async fn set_user_scripts_enabled(&self, enabled: bool) -> anyhow::Result<Value>;
    async fn set_user_script_enabled(&self, key: String, enabled: bool) -> anyhow::Result<Value>;
    async fn delete_user_script(&self, key: String) -> anyhow::Result<Value>;
    async fn reload_user_scripts(&self) -> anyhow::Result<Value>;
    async fn open_devtools(&self) -> anyhow::Result<Value>;
    async fn open_manager(&self) -> anyhow::Result<Value>;
    async fn backend_status(&self) -> anyhow::Result<Value>;
    async fn codex_model_catalog(&self) -> anyhow::Result<Value>;
    async fn ads(&self) -> anyhow::Result<Value>;
    async fn zed_remote_status(&self) -> anyhow::Result<Value>;
    async fn resolve_zed_remote_host(&self, payload: Value) -> anyhow::Result<Value>;
    async fn fallback_zed_remote_request(&self, payload: Value) -> anyhow::Result<Value>;
    async fn open_zed_remote(&self, payload: Value) -> anyhow::Result<Value>;
    async fn list_zed_remote_projects(&self, payload: Value) -> anyhow::Result<Value>;
    async fn remember_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value>;
    async fn forget_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value>;
    async fn upstream_worktree_status(&self) -> anyhow::Result<Value>;
    async fn upstream_worktree_defaults(&self, payload: Value) -> anyhow::Result<Value>;
    async fn upstream_worktree_prepare(&self, payload: Value) -> anyhow::Result<Value>;
    async fn upstream_worktree_create(&self, payload: Value) -> anyhow::Result<Value>;
}

#[async_trait]
pub trait BridgeDataService: Send + Sync {
    async fn delete(&self, session: SessionRef) -> anyhow::Result<DeleteResult>;
    async fn undo(&self, undo_token: String) -> anyhow::Result<DeleteResult>;
    async fn export_markdown(&self, session: SessionRef) -> anyhow::Result<ExportResult>;
    async fn thread_usage_history(&self, session: SessionRef) -> anyhow::Result<Value>;
    async fn find_archived_thread_by_title(
        &self,
        title: String,
    ) -> anyhow::Result<Option<SessionRef>>;
    async fn move_thread_workspace(
        &self,
        session: SessionRef,
        target_cwd: String,
    ) -> anyhow::Result<Value>;
    async fn thread_sort_key(&self, session: SessionRef) -> anyhow::Result<Value>;
    async fn thread_sort_keys(&self, sessions: Vec<SessionRef>) -> anyhow::Result<Value>;
}

pub async fn handle_bridge_request(
    ctx: BridgeContext,
    path: &str,
    payload: Value,
) -> serde_json::Value {
    let started = Instant::now();
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "bridge.request",
        json!({
            "path": path,
            "payload_keys": payload
                .as_object()
                .map(|object| object.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        }),
    );
    let result = match path {
        "/settings/get" => settings_value(&ctx, ctx.settings.get_settings().await).await,
        "/settings/set" => {
            settings_value(&ctx, ctx.settings.set_settings(payload.clone()).await).await
        }
        "/user-scripts/list" => ctx.runtime.user_script_inventory().await,
        "/user-scripts/set-enabled" => {
            let enabled = payload
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            ctx.runtime.set_user_scripts_enabled(enabled).await
        }
        "/user-scripts/set-script-enabled" => {
            let key = payload
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let enabled = payload
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            ctx.runtime.set_user_script_enabled(key, enabled).await
        }
        "/user-scripts/delete" => {
            let key = payload
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            ctx.runtime.delete_user_script(key).await
        }
        "/user-scripts/reload" => ctx.runtime.reload_user_scripts().await,
        "/devtools/open" => ctx.runtime.open_devtools().await,
        "/manager/open" => ctx.runtime.open_manager().await,
        "/backend/status" => ctx.runtime.backend_status().await,
        "/codex-model-catalog" | "/codex-config-model" => ctx.runtime.codex_model_catalog().await,
        "/diagnostics/log" => diagnostic_log_value(payload.clone()),
        "/ads" => ctx.runtime.ads().await,
        "/zed-remote/status" => ctx.runtime.zed_remote_status().await,
        "/zed-remote/resolve-host" => ctx.runtime.resolve_zed_remote_host(payload.clone()).await,
        "/zed-remote/fallback-request" => {
            ctx.runtime
                .fallback_zed_remote_request(payload.clone())
                .await
        }
        "/zed-remote/open" => ctx.runtime.open_zed_remote(payload.clone()).await,
        "/zed-remote/projects" => ctx.runtime.list_zed_remote_projects(payload.clone()).await,
        "/zed-remote/remember-project" => {
            ctx.runtime
                .remember_zed_remote_project(payload.clone())
                .await
        }
        "/zed-remote/forget-project" => {
            ctx.runtime.forget_zed_remote_project(payload.clone()).await
        }
        "/upstream-worktree/status" => ctx.runtime.upstream_worktree_status().await,
        "/upstream-worktree/defaults" => {
            ctx.runtime
                .upstream_worktree_defaults(payload.clone())
                .await
        }
        "/upstream-worktree/prepare" => {
            ctx.runtime.upstream_worktree_prepare(payload.clone()).await
        }
        "/upstream-worktree/create" => ctx.runtime.upstream_worktree_create(payload.clone()).await,
        "/stepwise/settings" => stepwise_settings_value(ctx.settings.get_settings().await),
        "/stepwise/generate" => {
            stepwise_generate_value(ctx.settings.get_settings().await, payload.clone()).await
        }
        "/stepwise/test" => {
            stepwise_test_value(ctx.settings.get_settings().await, payload.clone()).await
        }
        // ====== Manager 业务层（替代原 Tauri commands.rs） ======
        "/manager/backend-version" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::backend_version()).unwrap_or(Value::Null),
            "后端版本已读取。",
        )),
        "/manager/startup-options" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::startup_options()).unwrap_or(Value::Null),
            "启动参数已读取。",
        )),
        "/manager/load-overview" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::load_overview()).unwrap_or(Value::Null),
            "概览已加载。",
        )),
        "/manager/load-settings" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::load_settings()).unwrap_or(Value::Null),
            "设置已加载。",
        )),
        "/manager/save-settings" => manager_save_settings(payload.clone()),
        "/manager/reset-settings" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::reset_settings()).unwrap_or(Value::Null),
            "设置已重置。",
        )),
        "/manager/reset-image-overlay-settings" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::reset_image_overlay_settings()).unwrap_or(Value::Null),
            "图像覆盖配置已重置。",
        )),
        "/manager/load-watcher-state" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::load_watcher_state()).unwrap_or(Value::Null),
            "watcher 状态已加载。",
        )),
        "/manager/install-watcher" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::install_watcher()).unwrap_or(Value::Null),
            "watcher 已安装。",
        )),
        "/manager/uninstall-watcher" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::uninstall_watcher()).unwrap_or(Value::Null),
            "watcher 已卸载。",
        )),
        "/manager/enable-watcher" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::enable_watcher()).unwrap_or(Value::Null),
            "watcher 已启用。",
        )),
        "/manager/disable-watcher" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::disable_watcher()).unwrap_or(Value::Null),
            "watcher 已禁用。",
        )),
        "/manager/read-latest-logs" => {
            let lines = payload
                .get("lines")
                .and_then(Value::as_u64)
                .unwrap_or(crate::manager::default_log_lines() as u64)
                as usize;
            Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::read_latest_logs(lines)).unwrap_or(Value::Null),
            "日志已读取。",
        ))
        }
        "/manager/copy-diagnostics" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::copy_diagnostics()).unwrap_or(Value::Null),
            "诊断信息已生成。",
        )),
        "/manager/relay-status" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::relay_status()).unwrap_or(Value::Null),
            "供应商状态已读取。",
        )),
        "/manager/read-relay-files" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::read_relay_files()).unwrap_or(Value::Null),
            "配置文件内容已读取。",
        )),
        "/manager/save-relay-file" => manager_save_relay_file(payload.clone()),
        "/manager/switch-relay-profile" => manager_switch_relay_profile(payload.clone()),
        "/manager/backfill-relay-profile-from-live" => manager_backfill_relay_profile(payload.clone()),
        "/manager/list-context-entries" => manager_list_context_entries(payload.clone()),
        "/manager/read-live-context-entries" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::read_live_context_entries()).unwrap_or(Value::Null),
            "live context 已读取。",
        )),
        "/manager/upsert-context-entry" => manager_upsert_context_entry(payload.clone()),
        "/manager/sync-live-context-entries" => manager_sync_live_context_entries(payload.clone()),
        "/manager/delete-context-entry" => manager_delete_context_entry(payload.clone()),
        "/manager/extract-relay-common-config" => manager_extract_relay_common_config(payload.clone()),
        "/manager/check-env-conflicts" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::check_env_conflicts()).unwrap_or(Value::Null),
            "环境变量冲突已检测。",
        )),
        "/manager/remove-env-conflicts" => {
            let names: Vec<String> = payload
                .get("names")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::remove_env_conflicts(names)).unwrap_or(Value::Null),
            "环境变量已删除。",
        ))
        }
        "/manager/install-entrypoints" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::install_entrypoints().await).unwrap_or(Value::Null),
            "入口已安装。",
        )),
        "/manager/uninstall-entrypoints" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::uninstall_entrypoints().await).unwrap_or(Value::Null),
            "入口已卸载。",
        )),
        "/manager/repair-shortcuts" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::repair_shortcuts().await).unwrap_or(Value::Null),
            "快捷方式已修复。",
        )),
        "/manager/plugin-marketplace-status" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::plugin_marketplace_status()).unwrap_or(Value::Null),
            "插件市场状态已读取。",
        )),
        "/manager/remote-plugin-marketplace-status" => Ok(wrap_ok_value(
            serde_json::to_value(crate::manager::remote_plugin_marketplace_status()).unwrap_or(Value::Null),
            "远端插件市场状态已读取。",
        )),
        "/manager/test-relay-profile" => manager_test_relay_profile(payload.clone()).await,
        "/manager/test-stepwise-settings" => manager_test_stepwise_settings(payload.clone()).await,
        "/manager/apply-relay-injection" => Ok(crate::manager::apply_relay_injection()),
        "/manager/apply-pure-api-injection" => Ok(crate::manager::apply_pure_api_injection()),
        "/manager/clear-relay-injection" => Ok(crate::manager::clear_relay_injection()),
        "/manager/launch-codex-plus" => Ok(crate::manager::launch_codex_plus(
            payload.get("app_path").and_then(Value::as_str).unwrap_or(""),
            payload.get("debug_port").and_then(Value::as_u64).unwrap_or(crate::manager::default_debug_port() as u64) as u16,
            payload.get("helper_port").and_then(Value::as_u64).unwrap_or(crate::manager::default_helper_port() as u64) as u16,
        )),
        "/manager/restart-codex-plus" => Ok(crate::manager::restart_codex_plus(
            payload.get("app_path").and_then(Value::as_str).unwrap_or(""),
            payload.get("debug_port").and_then(Value::as_u64).unwrap_or(crate::manager::default_debug_port() as u64) as u16,
            payload.get("helper_port").and_then(Value::as_u64).unwrap_or(crate::manager::default_helper_port() as u64) as u16,
        )),
        "/manager/open-external-url" => {
            let url = payload.get("url").and_then(Value::as_str).unwrap_or("");
            Ok(crate::manager::open_external_url(url))
        }
        "/manager/write-diagnostic-event" => {
            let event = payload.get("event").and_then(Value::as_str).unwrap_or("");
            let detail = payload.get("detail").cloned().unwrap_or(Value::Null);
            Ok(crate::manager::write_diagnostic_event(event, detail))
        }
        // ====== 暂时 stub 的端点 ======
        "/manager/load-ccs-providers" => Ok(crate::manager::load_ccs_providers()),
        "/manager/import-ccs-providers" => Ok(crate::manager::import_ccs_providers().into_value()),
        "/manager/load-pending-provider-import" => Ok(crate::manager::load_pending_provider_import()),
        "/manager/confirm-pending-provider-import" => manager_confirm_pending_provider_import(payload.clone()),
        "/manager/dismiss-pending-provider-import" => Ok(crate::manager::dismiss_pending_provider_import()),
        "/sessions/list" => Ok(crate::manager::list_local_sessions()),
        "/sessions/delete" => manager_delete_local_session(payload.clone()),
        "/manager/fetch-relay-profile-models" => Ok(crate::manager::fetch_relay_profile_models(payload.clone()).await),
        "/manager/diagnose-relay-profile" => Ok(crate::manager::diagnose_relay_profile(payload.clone()).await),
        "/manager/repair-plugin-marketplace" => Ok(crate::manager::repair_plugin_marketplace()),
        "/manager/repair-remote-plugin-marketplace" => Ok(crate::manager::repair_remote_plugin_marketplace()),
        "/manager/refresh-script-market" => Ok(crate::manager::refresh_script_market().await),
        "/manager/install-market-script" => {
            let id = payload.get("id").and_then(Value::as_str).unwrap_or("");
            Ok(crate::manager::install_market_script(id).await)
        }
        "/manager/set-user-script-enabled" => {
            let key = payload.get("key").and_then(Value::as_str).unwrap_or("");
            let enabled = payload.get("enabled").and_then(Value::as_bool).unwrap_or(true);
            Ok(crate::manager::set_user_script_enabled(key, enabled))
        }
        "/manager/delete-user-script" => {
            let key = payload.get("key").and_then(Value::as_str).unwrap_or("");
            Ok(crate::manager::delete_user_script(key))
        }
        "/provider-sync/targets" => Ok(crate::manager::load_provider_sync_targets()),
        "/provider-sync/now" => manager_sync_providers_now(payload.clone()),
        "/delete" => result_value(ctx.data.delete(session_from_payload(&payload)).await),
        "/undo" => {
            let undo_token = payload
                .get("undo_token")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            result_value(ctx.data.undo(undo_token).await)
        }
        "/export-markdown" => result_value(
            ctx.data
                .export_markdown(session_from_payload(&payload))
                .await,
        ),
        "/thread-usage-history" => {
            ctx.data
                .thread_usage_history(session_from_payload(&payload))
                .await
        }
        "/archived-thread" => {
            let title = payload
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            archived_thread_value(ctx.data.find_archived_thread_by_title(title).await)
        }
        "/move-thread-workspace" => {
            let target_cwd = payload
                .get("target_cwd")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            ctx.data
                .move_thread_workspace(session_from_payload(&payload), target_cwd)
                .await
        }
        "/thread-sort-key" => {
            ctx.data
                .thread_sort_key(session_from_payload(&payload))
                .await
        }
        "/thread-sort-keys" => {
            ctx.data
                .thread_sort_keys(sessions_from_payload(&payload))
                .await
        }
        _ => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "bridge.unknown_path",
                json!({
                    "path": path
                }),
            );
            return json!({
                "status": "failed",
                "session_id": "",
                "message": "Unknown bridge path"
            });
        }
    };

    let response = result.unwrap_or_else(|error| failed_from_error(&payload.clone(), error));
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "bridge.response",
        json!({
            "path": path,
            "elapsed_ms": started.elapsed().as_millis() as u64,
            "status": response.get("status").and_then(Value::as_str).unwrap_or("")
        }),
    );
    response
}

#[derive(Default)]
pub struct CoreSettingsService {
    store: SettingsStore,
    app_dir: Option<PathBuf>,
}

impl CoreSettingsService {
    fn with_app_dir(app_dir: PathBuf) -> Self {
        Self {
            store: SettingsStore::default(),
            app_dir: Some(app_dir),
        }
    }
}

#[async_trait]
impl BridgeSettingsService for CoreSettingsService {
    async fn get_settings(&self) -> anyhow::Result<BackendSettings> {
        self.store.load()
    }

    async fn set_settings(&self, payload: Value) -> anyhow::Result<BackendSettings> {
        self.store.update(payload)
    }

    async fn codex_app_version(&self) -> anyhow::Result<String> {
        if let Some(app_dir) = self.app_dir.as_deref() {
            return Ok(crate::app_paths::codex_app_version(app_dir).unwrap_or_default());
        }
        let settings = self.store.load().unwrap_or_default();
        let app_dir = crate::app_paths::resolve_codex_app_dir_with_saved(
            None,
            Some(settings.codex_app_path.as_str()),
        );
        Ok(app_dir
            .as_deref()
            .and_then(crate::app_paths::codex_app_version)
            .unwrap_or_default())
    }
}

#[derive(Clone)]
pub struct CoreRuntimeService {
    debug_port: u16,
    status_store: StatusStore,
    user_scripts: Option<UserScriptManager>,
    websocket_url: Option<String>,
    user_script_evaluator: Option<UserScriptEvaluator>,
    devtools_opener: Option<DevtoolsOpener>,
    devtools_target_id: Option<String>,
}

impl CoreRuntimeService {
    pub fn new(debug_port: u16, status_store: StatusStore) -> Self {
        Self {
            debug_port,
            status_store,
            user_scripts: None,
            websocket_url: None,
            user_script_evaluator: None,
            devtools_opener: None,
            devtools_target_id: None,
        }
    }

    pub fn with_user_scripts(mut self, user_scripts: UserScriptManager) -> Self {
        self.user_scripts = Some(user_scripts);
        self
    }

    pub fn with_websocket_url(mut self, websocket_url: impl Into<String>) -> Self {
        self.websocket_url = Some(websocket_url.into());
        self
    }

    pub fn with_user_script_evaluator(mut self, evaluator: UserScriptEvaluator) -> Self {
        self.user_script_evaluator = Some(evaluator);
        self
    }

    pub fn with_devtools_opener(mut self, opener: DevtoolsOpener) -> Self {
        self.devtools_opener = Some(opener);
        self
    }

    pub fn with_devtools_target_id(mut self, target_id: impl Into<String>) -> Self {
        self.devtools_target_id = Some(target_id.into());
        self
    }
}

#[async_trait]
impl BridgeRuntimeService for CoreRuntimeService {
    async fn user_script_inventory(&self) -> anyhow::Result<Value> {
        match &self.user_scripts {
            Some(user_scripts) => user_scripts.inventory(),
            None => Ok(empty_user_script_inventory()),
        }
    }

    async fn set_user_scripts_enabled(&self, enabled: bool) -> anyhow::Result<Value> {
        match &self.user_scripts {
            Some(user_scripts) => {
                user_scripts.set_global_enabled(enabled)?;
                user_scripts.inventory()
            }
            None => {
                let mut inventory = empty_user_script_inventory();
                inventory["enabled"] = json!(enabled);
                Ok(inventory)
            }
        }
    }

    async fn set_user_script_enabled(&self, key: String, enabled: bool) -> anyhow::Result<Value> {
        match &self.user_scripts {
            Some(user_scripts) => {
                user_scripts.set_script_enabled(&key, enabled)?;
                user_scripts.inventory()
            }
            None => Ok(empty_user_script_inventory()),
        }
    }

    async fn delete_user_script(&self, key: String) -> anyhow::Result<Value> {
        match &self.user_scripts {
            Some(user_scripts) => {
                user_scripts.delete_user_script(&key)?;
                user_scripts.inventory()
            }
            None => Ok(empty_user_script_inventory()),
        }
    }

    async fn reload_user_scripts(&self) -> anyhow::Result<Value> {
        if let (Some(user_scripts), Some(websocket_url), Some(evaluator)) = (
            &self.user_scripts,
            self.websocket_url.as_deref(),
            &self.user_script_evaluator,
        ) {
            let bundle = user_scripts.build_enabled_bundle()?;
            if !bundle.trim().is_empty() {
                evaluator(websocket_url, &bundle)?;
            }
        }
        self.user_script_inventory().await
    }

    async fn open_devtools(&self) -> anyhow::Result<Value> {
        let target_id = self
            .devtools_target_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("No DevTools target configured"))?;
        let url = devtools_url(self.debug_port, target_id);
        if let Some(opener) = &self.devtools_opener {
            opener(&url)?;
        }
        Ok(json!({
            "status": "ok",
            "target_id": target_id,
            "url": url
        }))
    }

    async fn open_manager(&self) -> anyhow::Result<Value> {
        let manager_path = manager_exe_path();
        if !manager_path.exists() {
            anyhow::bail!("未找到管理工具：{}", manager_path.display());
        }
        spawn_manager(&manager_path)?;
        Ok(json!({
            "status": "ok",
            "path": manager_path.to_string_lossy()
        }))
    }

    async fn backend_status(&self) -> anyhow::Result<Value> {
        let _ = self.status_store.load_latest();
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "bridge.backend_status_ok",
            json!({
                "debug_port": self.debug_port,
                "version": crate::version::VERSION
            }),
        );
        Ok(json!({"status": "ok", "message": "后端已连接", "version": crate::version::VERSION}))
    }

    async fn codex_model_catalog(&self) -> anyhow::Result<Value> {
        Ok(crate::model_catalog::read_codex_model_catalog().await)
    }

    async fn ads(&self) -> anyhow::Result<Value> {
        // 默认实现：返回空广告列表。具体投放逻辑可由调用方（如 launcher）
        // 在自定义 `BridgeRuntimeService` 实现中覆盖。
        Ok(serde_json::json!({
            "version": 1,
            "ads": []
        }))
    }

    async fn zed_remote_status(&self) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::zed_remote_status())
    }

    async fn resolve_zed_remote_host(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::resolve_ssh_target_response(&payload))
    }

    async fn fallback_zed_remote_request(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::fallback_open_request_response(&payload))
    }

    async fn open_zed_remote(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::open_zed_remote(&payload))
    }

    async fn list_zed_remote_projects(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::list_zed_remote_projects_response(
            &payload,
        ))
    }

    async fn remember_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::remember_zed_remote_project_response(
            &payload,
        ))
    }

    async fn forget_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::zed_remote::forget_zed_remote_project_response(
            &payload,
        ))
    }

    async fn upstream_worktree_status(&self) -> anyhow::Result<Value> {
        Ok(crate::upstream_worktree::status_response())
    }

    async fn upstream_worktree_defaults(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::upstream_worktree::defaults_response(&payload))
    }

    async fn upstream_worktree_prepare(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::upstream_worktree::prepare_response(&payload))
    }

    async fn upstream_worktree_create(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(crate::upstream_worktree::create_response(&payload))
    }
}

struct UnavailableDataService;

#[async_trait]
impl BridgeDataService for UnavailableDataService {
    async fn delete(&self, session: SessionRef) -> anyhow::Result<DeleteResult> {
        Ok(DeleteResult {
            status: DeleteStatus::Failed,
            session_id: session.session_id,
            message: "Delete service is not wired in core launcher hooks".to_string(),
            undo_token: None,
            backup_path: None,
        })
    }

    async fn undo(&self, undo_token: String) -> anyhow::Result<DeleteResult> {
        Ok(DeleteResult {
            status: DeleteStatus::Failed,
            session_id: String::new(),
            message: "Undo service is not wired in core launcher hooks".to_string(),
            undo_token: Some(undo_token),
            backup_path: None,
        })
    }

    async fn export_markdown(&self, session: SessionRef) -> anyhow::Result<ExportResult> {
        Ok(ExportResult {
            status: ExportStatus::Failed,
            session_id: session.session_id,
            message: "Markdown export service is not wired in core launcher hooks".to_string(),
            filename: None,
            markdown: None,
        })
    }

    async fn thread_usage_history(&self, session: SessionRef) -> anyhow::Result<Value> {
        Ok(json!({
            "status": "failed",
            "session_id": session.session_id,
            "message": "Thread usage history service is not wired in core launcher hooks",
            "history": []
        }))
    }

    async fn find_archived_thread_by_title(
        &self,
        _title: String,
    ) -> anyhow::Result<Option<SessionRef>> {
        Ok(None)
    }

    async fn move_thread_workspace(
        &self,
        session: SessionRef,
        _target_cwd: String,
    ) -> anyhow::Result<Value> {
        Ok(json!({
            "status": "failed",
            "session_id": session.session_id,
            "message": "Move workspace service is not wired in core launcher hooks"
        }))
    }

    async fn thread_sort_key(&self, session: SessionRef) -> anyhow::Result<Value> {
        Ok(json!({
            "status": "failed",
            "session_id": session.session_id,
            "message": "Thread sort service is not wired in core launcher hooks"
        }))
    }

    async fn thread_sort_keys(&self, _sessions: Vec<SessionRef>) -> anyhow::Result<Value> {
        Ok(json!({
            "status": "failed",
            "message": "Thread sort service is not wired in core launcher hooks",
            "sort_keys": []
        }))
    }
}

fn manager_exe_path() -> PathBuf {
    crate::install::option_or_current_exe(&None, crate::install::MANAGER_BINARY)
}

fn spawn_manager(manager_path: &Path) -> anyhow::Result<()> {
    let mut command = std::process::Command::new(manager_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::windows_create_no_window());
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| anyhow::anyhow!("启动管理工具失败：{error}"))
}

fn settings_payload_value(
    settings: BackendSettings,
    codex_app_version: String,
) -> anyhow::Result<Value> {
    let mut value = serde_json::to_value(settings)?;
    if let Some(object) = value.as_object_mut() {
        object.remove("codexAppStepwiseApiKey");
        object.insert(
            "codexAppVersion".to_string(),
            Value::String(codex_app_version),
        );
    }
    Ok(value)
}

async fn settings_value(
    ctx: &BridgeContext,
    result: anyhow::Result<BackendSettings>,
) -> anyhow::Result<Value> {
    let settings = result?;
    let codex_app_version = ctx.settings.codex_app_version().await.unwrap_or_default();
    let value = settings_payload_value(settings, codex_app_version)?;
    Ok(wrap_ok_value(value, "设置已加载。"))
}

fn result_value<T>(result: anyhow::Result<T>) -> anyhow::Result<Value>
where
    T: serde::Serialize,
{
    Ok(serde_json::to_value(result?)?)
}

/// 把 handler 返回的 `Value` 包装成 Tauri `CommandResult` 形状：
/// `{"status": "ok", "message": "...", ...原有字段}`
/// 如果 Value 不是 object，则包成 `{"status": "ok", "message": "...", "value": <Value>}`
/// —— 这样前端 `r.status === "ok"` 判定能正常工作。
fn wrap_ok_value(value: Value, message: &str) -> Value {
    let mut obj = match value {
        Value::Object(map) => map,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), other);
            map
        }
    };
    obj.entry("status".to_string())
        .or_insert(Value::String("ok".to_string()));
    obj.insert("message".to_string(), Value::String(message.to_string()));
    Value::Object(obj)
}

fn stepwise_settings_value(result: anyhow::Result<BackendSettings>) -> anyhow::Result<Value> {
    let settings = result?;
    Ok(json!({
        "status": "ok",
        "settings": crate::stepwise::public_settings(&settings),
    }))
}

async fn stepwise_generate_value(
    result: anyhow::Result<BackendSettings>,
    payload: Value,
) -> anyhow::Result<Value> {
    let settings = result?;
    let request = payload.get("request").cloned().unwrap_or(payload);
    let request =
        serde_json::from_value::<crate::stepwise::StepwiseRequest>(request).unwrap_or_default();
    crate::stepwise::generate(request, &settings).await
}

async fn stepwise_test_value(
    result: anyhow::Result<BackendSettings>,
    payload: Value,
) -> anyhow::Result<Value> {
    let settings = crate::stepwise::settings_with_payload(result?, &payload);
    crate::stepwise::test_connection(&settings).await
}

fn diagnostic_log_value(payload: Value) -> anyhow::Result<Value> {
    let event = payload
        .get("event")
        .and_then(Value::as_str)
        .map(sanitize_diagnostic_event)
        .unwrap_or_else(|| "event".to_string());
    crate::diagnostic_log::append_diagnostic_log(&format!("renderer.{event}"), payload)?;
    Ok(json!({
        "status": "ok",
        "message": "日志已记录"
    }))
}

fn sanitize_diagnostic_event(event: &str) -> String {
    let sanitized = event
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "event".to_string()
    } else {
        sanitized
    }
}

fn archived_thread_value(result: anyhow::Result<Option<SessionRef>>) -> anyhow::Result<Value> {
    Ok(match result? {
        Some(session) => json!({"session_id": session.session_id, "title": session.title}),
        None => json!({"session_id": "", "title": ""}),
    })
}

fn failed_from_error(payload: &Value, error: anyhow::Error) -> Value {
    json!({
        "status": "failed",
        "session_id": payload
            .get("session_id")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "message": error.to_string()
    })
}

fn session_from_payload(payload: &Value) -> SessionRef {
    SessionRef {
        session_id: payload
            .get("session_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        title: payload
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

fn sessions_from_payload(payload: &Value) -> Vec<SessionRef> {
    payload
        .get("sessions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_object())
                .map(|item| SessionRef {
                    session_id: item
                        .get("session_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    title: item
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn devtools_url(debug_port: u16, target_id: &str) -> String {
    format!(
        "http://127.0.0.1:{debug_port}/devtools/inspector.html?ws=127.0.0.1:{debug_port}/devtools/page/{target_id}"
    )
}

fn empty_user_script_inventory() -> Value {
    json!({
        "enabled": true,
        "scripts": []
    })
}

// ====== Manager bridge handlers（包装 manager.rs 的纯函数） ======

fn manager_save_settings(payload: Value) -> anyhow::Result<Value> {
    let settings: BackendSettings = serde_json::from_value(
        payload.get("settings").cloned().unwrap_or(payload),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let result = crate::manager::save_settings(settings);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "设置已保存。"))
}

fn manager_save_relay_file(payload: Value) -> anyhow::Result<Value> {
    let kind = payload
        .get("file")
        .or_else(|| payload.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let contents = payload
        .get("contents")
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::save_relay_file(kind, contents);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "配置文件已保存。"))
}

fn manager_switch_relay_profile(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let previous = request
        .get("previousActiveRelayId")
        .or_else(|| request.get("previous_active_relay_id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::switch_relay_profile(settings, previous);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "供应商已切换。"))
}

fn manager_backfill_relay_profile(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let profile_id = request
        .get("profileId")
        .or_else(|| request.get("profile_id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::backfill_relay_profile_from_live(settings, profile_id);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "profile 已从 live 回填。"))
}

fn manager_list_context_entries(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let result = crate::manager::list_context_entries(settings);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "context 条目已读取。"))
}

fn manager_upsert_context_entry(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let kind = request
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = request
        .get("id")
        .or_else(|| request.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let body = request
        .get("entry")
        .or_else(|| request.get("tomlBody"))
        .or_else(|| request.get("toml_body"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::upsert_context_entry(settings, kind, name, body);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "context 条目已写入。"))
}

fn manager_sync_live_context_entries(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let result = crate::manager::sync_live_context_entries(settings);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "live context 已同步。"))
}

fn manager_delete_context_entry(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let kind = request
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = request
        .get("id")
        .or_else(|| request.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::delete_context_entry(settings, kind, name);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "context 条目已删除。"))
}

fn manager_extract_relay_common_config(payload: Value) -> anyhow::Result<Value> {
    let request = payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let settings: BackendSettings = serde_json::from_value(
        request.get("settings").cloned().unwrap_or(request.clone()),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let profile_id = request
        .get("profileId")
        .or_else(|| request.get("profile_id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = crate::manager::extract_relay_common_config(profile_id, settings);
    Ok(wrap_ok_value(serde_json::to_value(result).unwrap_or(Value::Null), "common config 已提取。"))
}

async fn manager_test_relay_profile(payload: Value) -> anyhow::Result<Value> {
    // 兼容：profile 字段可以是 RelayProfile 或 BackendSettings
    let profile_value = payload.get("profile").cloned().unwrap_or(payload);
    let relay_profile = serde_json::from_value::<crate::settings::RelayProfile>(profile_value)
        .ok()
        .or_else(|| {
            serde_json::from_value::<BackendSettings>(serde_json::Value::Null)
                .ok()
                .and_then(|settings| {
                    settings
                        .relay_profiles
                        .into_iter()
                        .find(|p| p.id == settings.active_relay_id)
                })
        })
        .unwrap_or_default();
    let result = crate::manager::test_relay_profile(relay_profile).await;
    Ok(wrap_ok_value(
        serde_json::to_value(result).unwrap_or(Value::Null),
        "profile 测试完成。",
    ))
}

async fn manager_test_stepwise_settings(payload: Value) -> anyhow::Result<Value> {
    let settings: BackendSettings = serde_json::from_value(
        payload.get("settings").cloned().unwrap_or(payload),
    )
    .map_err(|error| anyhow::anyhow!("解析 settings 失败：{error}"))?;
    let result = crate::manager::test_stepwise_settings(settings).await;
    Ok(wrap_ok_value(
        serde_json::to_value(result).unwrap_or(Value::Null),
        "stepwise 测试完成。",
    ))
}

fn manager_confirm_pending_provider_import(payload: Value) -> anyhow::Result<Value> {
    let request: crate::provider_import::ProviderImportRequest = serde_json::from_value(
        payload.get("request").cloned().unwrap_or(payload),
    )
    .map_err(|error| anyhow::anyhow!("解析 request 失败：{error}"))?;
    let result = crate::manager::confirm_pending_provider_import(request);
    Ok(wrap_ok_value(result.into_value(), "provider 已导入。"))
}

fn manager_delete_local_session(payload: Value) -> anyhow::Result<Value> {
    let request: crate::manager::DeleteLocalSessionRequest = serde_json::from_value(
        payload.get("request").cloned().unwrap_or(payload),
    )
    .map_err(|error| anyhow::anyhow!("解析 request 失败：{error}"))?;
    let result = crate::manager::delete_local_session(request);
    Ok(wrap_ok_value(result, "本地 session 已处理。"))
}

fn manager_sync_providers_now(payload: Value) -> anyhow::Result<Value> {
    let target_provider = payload
        .get("targetProvider")
        .or_else(|| payload.get("target_provider"))
        .and_then(Value::as_str)
        .map(String::from);
    let result = crate::manager::sync_providers_now(target_provider);
    Ok(wrap_ok_value(result, "provider sync 已处理。"))
}
