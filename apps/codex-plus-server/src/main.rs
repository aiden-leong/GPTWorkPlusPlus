//! `codex-plus-server` — CodexPlusPlus 的 Axum HTTP API 入口。
//!
//! 启动：
//! 1. 复用 `codex-plus-core::launcher::launch_and_inject_with_hooks` 启动
//!    Codex 应用并注入 helper（保持注入流程不变，端口 57321）。
//! 2. 并行启动 Axum HTTP API（端口 8787），给前端（Node + Vite + React
//!    Router）使用。
//!
//! API 行为完全沿用 `codex-plus-core::routes::handle_bridge_request`，
//! 旧 Tauri 端的 `BridgeSettingsService` / `BridgeRuntimeService` /
//! `BridgeDataService` trait 在 core 内部不变。
//!
//! 用法：
//!   codex-plus-server [--api-port 8787]
//!                     [--debug-port 9229]
//!                     [--helper-port 57321]
//!                     [--allowed-origin http://localhost:5173]
//!                     [--app-path /path/to/Codex.app]
//!                     [--no-launch]    # 不启动 Codex，只跑 API

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::Parser;
use codex_plus_core::http_api::{DEFAULT_ALLOWED_ORIGINS, DEFAULT_API_PORT, serve_api};
use codex_plus_core::launcher::{
    self, DefaultLaunchHooks, IntoLaunchHooks, LaunchOptions,
};
use codex_plus_core::routes::{BridgeContext, CoreRuntimeService};
use codex_plus_core::status::StatusStore;
use codex_plus_core::user_scripts::UserScriptManager;

#[derive(Debug, Parser)]
#[command(name = "codex-plus-server", about = "CodexPlusPlus HTTP API server")]
struct Cli {
    /// HTTP API 端口（前端 fetch 用）。
    #[arg(long, default_value_t = DEFAULT_API_PORT)]
    api_port: u16,

    /// Codex 调试端口（CDP / 注入用）。
    #[arg(long, default_value_t = 9229)]
    debug_port: u16,

    /// 注入 helper 端口（Codex 内部 JS 调用）。
    #[arg(long, default_value_t = 57321)]
    helper_port: u16,

    /// 允许的 CORS origin，可重复指定。
    #[arg(long, value_name = "URL", num_args = 0..)]
    allowed_origin: Vec<String>,

    /// 显式 Codex 应用目录。
    #[arg(long)]
    app_path: Option<String>,

    /// 仅启动 HTTP API，不启动 Codex 进程。
    /// 用于 dev 时前后端解耦调试。
    #[arg(long, default_value_t = false)]
    no_launch: bool,

    /// 仅启动 helper HTTP server 和 Codex 注入，不跑 API。
    /// （保留旧 launcher 行为，用于兼容性测试。）
    #[arg(long, default_value_t = false)]
    helper_only: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let cli = Cli::parse();

    let allowed_origins = if cli.allowed_origin.is_empty() {
        DEFAULT_ALLOWED_ORIGINS
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        cli.allowed_origin.clone()
    };

    // 单实例 guard：复用 launcher 风格 — 返回 `None` 表示已有实例在跑。
    let _guard = match acquire_single_instance_guard(cli.debug_port) {
        Ok(Some(guard)) => Some(guard),
        Ok(None) => {
            tracing::info!("another launcher instance is already running; exiting");
            return Ok(());
        }
        Err(error) => {
            return Err(error).context("failed to acquire launcher guard port");
        }
    };

    // 构造 BridgeContext。
    let bridge = build_bridge_context();

    if cli.helper_only {
        // 兼容模式：只启动 helper + Codex，不开 API。
        let options = build_launch_options(&cli);
        let hooks = ServerLaunchHooks::new(bridge.clone());
        let handle = launcher::launch_and_inject_with_hooks(options, hooks).await?;
        handle.wait_for_codex_exit().await?;
        return Ok(());
    }

    // 并行启动：(A) HTTP API  (B) Codex + helper（除非 --no-launch）
    let api_handle = tokio::spawn({
        let bridge = bridge.clone();
        let allowed = allowed_origins.clone();
        async move { serve_api(bridge, cli.api_port, &allowed).await }
    });

    if cli.no_launch {
        tracing::info!("--no-launch specified; API server only (Codex not started)");
        api_handle.await??;
        return Ok(());
    }

    let options = build_launch_options(&cli);
    let hooks = ServerLaunchHooks::new(bridge.clone());
    let launch_handle = launcher::launch_and_inject_with_hooks(options, hooks).await?;

    // 等 Codex 退出，关闭 helper；Axum API 持续提供直到主进程退出。
    tokio::select! {
        result = launch_handle.wait_for_codex_exit() => {
            result?;
        }
        result = api_handle => {
            result??;
        }
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("received Ctrl-C, shutting down");
        }
    }
    Ok(())
}

fn build_launch_options(cli: &Cli) -> LaunchOptions {
    LaunchOptions {
        app_dir: cli.app_path.as_deref().map(PathBuf::from),
        debug_port: cli.debug_port,
        helper_port: cli.helper_port,
        status_store: StatusStore::default(),
    }
}

/// 构造 `BridgeContext`。
///
/// Server 模式下 `data` service 没有业务实现，沿用 core 自带的
/// `UnavailableDataService`（前端调用会拿到 "unavailable" 状态）。
fn build_bridge_context() -> BridgeContext {
    let status_store = StatusStore::default();
    let user_scripts = default_user_script_manager();
    let runtime = Arc::new(
        CoreRuntimeService::new(9229, status_store).with_user_scripts(user_scripts),
    );
    BridgeContext::core(runtime)
}

fn default_user_script_manager() -> UserScriptManager {
    let config_dir = default_user_scripts_config_dir();
    UserScriptManager::new(
        default_user_scripts_builtin_dir(),
        config_dir.join("user_scripts"),
        config_dir.join("user_scripts.json"),
    )
}

fn default_user_scripts_builtin_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
        .map(|path| path.join("user_scripts"))
        .unwrap_or_else(|| std::path::PathBuf::from("user_scripts"))
}

fn default_user_scripts_config_dir() -> std::path::PathBuf {
    if cfg!(windows) {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            return std::path::PathBuf::from(roaming).join("Codex++");
        }
        if let Some(home) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
            return home.join("AppData").join("Roaming").join("Codex++");
        }
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".config")))
        .unwrap_or_else(|| std::path::PathBuf::from(".config"))
        .join("Codex++")
}

/// 包装 `DefaultLaunchHooks`，把 server 的 BridgeContext 透传给 `LaunchHooks::bridge_context`。
struct ServerLaunchHooks {
    inner: DefaultLaunchHooks,
    bridge: BridgeContext,
}

impl ServerLaunchHooks {
    fn new(bridge: BridgeContext) -> Self {
        Self {
            inner: DefaultLaunchHooks::default(),
            bridge,
        }
    }
}

impl IntoLaunchHooks for ServerLaunchHooks {
    fn into_launch_hooks(self) -> Arc<dyn launcher::LaunchHooks> {
        Arc::new(self)
    }
}

#[async_trait::async_trait(?Send)]
impl launcher::LaunchHooks for ServerLaunchHooks {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&std::path::Path>,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> Result<std::path::PathBuf> {
        self.inner.resolve_app_dir(app_dir, settings)
    }

    fn select_debug_port(&self, requested: u16) -> u16 {
        self.inner.select_debug_port(requested)
    }

    fn select_helper_port(&self, requested: u16) -> u16 {
        self.inner.select_helper_port(requested)
    }

    async fn load_settings(&self) -> Result<codex_plus_core::settings::BackendSettings> {
        self.inner.load_settings().await
    }

    async fn run_provider_sync(&self) -> Result<()> {
        self.inner.run_provider_sync().await
    }

    async fn apply_active_relay_profile(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> Result<()> {
        self.inner.apply_active_relay_profile(settings).await
    }

    async fn ensure_computer_use_config(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> Result<()> {
        self.inner.ensure_computer_use_config(settings).await
    }

    async fn ensure_plugin_marketplace_config(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> Result<()> {
        self.inner.ensure_plugin_marketplace_config(settings).await
    }

    async fn start_helper(&self, helper_port: u16) -> Result<()> {
        self.inner.start_helper(helper_port).await
    }

    async fn launch_codex(
        &self,
        app_dir: &std::path::Path,
        debug_port: u16,
        settings: &codex_plus_core::settings::BackendSettings,
        extra_args: &[String],
    ) -> Result<launcher::CodexLaunch> {
        self.inner
            .launch_codex(app_dir, debug_port, settings, extra_args)
            .await
    }

    async fn bridge_context(
        &self,
        _debug_port: u16,
        _app_dir: &std::path::Path,
    ) -> Result<Option<BridgeContext>> {
        Ok(Some(self.bridge.clone()))
    }

    async fn inject(&self, debug_port: u16, helper_port: u16) -> Result<()> {
        self.inner.inject(debug_port, helper_port).await
    }

    async fn inject_bridge(
        &self,
        debug_port: u16,
        helper_port: u16,
        _ctx: BridgeContext,
    ) -> Result<()> {
        self.inner.inject(debug_port, helper_port).await
    }

    async fn ensure_injection(&self, debug_port: u16, helper_port: u16, app_dir: &std::path::Path) -> bool {
        self.inner.ensure_injection(debug_port, helper_port, app_dir).await
    }

    async fn start_bridge_watchdog(&self, debug_port: u16, helper_port: u16) -> Result<()> {
        self.inner.start_bridge_watchdog(debug_port, helper_port).await
    }

    async fn start_computer_use_guard_watchdog(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> Result<()> {
        self.inner.start_computer_use_guard_watchdog(settings).await
    }

    async fn write_status(&self, status: &str) {
        self.inner.write_status(status).await
    }

    async fn wait_for_codex_exit(&self, launch: &launcher::CodexLaunch) -> Result<()> {
        self.inner.wait_for_codex_exit(launch).await
    }

    async fn shutdown_helper(&self, helper_port: u16) {
        self.inner.shutdown_helper(helper_port).await
    }

    async fn terminate_codex(&self, launch: &launcher::CodexLaunch) {
        self.inner.terminate_codex(launch).await
    }
}

fn acquire_single_instance_guard(
    _debug_port: u16,
) -> Result<Option<codex_plus_core::ports::LoopbackPortGuard>> {
    match codex_plus_core::ports::acquire_resilient_loopback_port_guard(
        codex_plus_core::ports::launcher_guard_port(),
    ) {
        Ok(guard) => Ok(Some(guard)),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn init_tracing() {
    use tracing_subscriber::{EnvFilter, fmt};
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,codex_plus_core=info,codex_plus_server=info"));
    let _ = fmt().with_env_filter(filter).try_init();
}
