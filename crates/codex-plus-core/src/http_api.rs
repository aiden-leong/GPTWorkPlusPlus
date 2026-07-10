//! Axum HTTP API 适配层。
//!
//! 把 [`crate::routes::handle_bridge_request`]（按 path 派发到
//! `BridgeSettingsService` / `BridgeRuntimeService` / `BridgeDataService`）
//! 暴露成 HTTP API。给前端（Vite + React Router）用。
//!
//! 设计要点：
//! - 单入口 `POST /api/bridge`，body = `{"path": "/settings/get", ...}`
//! - 复用现有 `handle_bridge_request`，行为/响应结构与原 Tauri 命令一致
//! - 包含一个 `GET /api/health` 供前端启动时探测
//! - 默认允许 `http://localhost:5173`（Vite dev）跨域，可通过 builder 配置
//!
//! 注意：注入到 Codex 内部 JS 用的 helper HTTP server（端口 57321）保持
//! 原有裸 TcpListener 实现，不在 Axum 范围内。Codex 注入流程不重构。

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::routes::{BridgeContext, handle_bridge_request};

/// HTTP API 服务默认端口。
pub const DEFAULT_API_PORT: u16 = 8787;

/// 默认 CORS 允许的 origin（Vite dev server 默认端口）。
pub const DEFAULT_ALLOWED_ORIGINS: &[&str] = &["http://localhost:5173"];

/// HTTP API 状态（axum 的 `State`）。
#[derive(Clone)]
pub struct ApiState {
    pub bridge: BridgeContext,
}

impl ApiState {
    pub fn new(bridge: BridgeContext) -> Self {
        Self { bridge }
    }
}

/// 桥接请求的 HTTP body。
#[derive(Debug, Deserialize)]
pub struct BridgeRequest {
    /// 桥接路径，对应 `handle_bridge_request` 的 path 参数
    /// （如 `"/settings/get"`、`"/user-scripts/list"`）。
    pub path: String,
    /// 其余字段会原样作为 payload 传给桥接 handler。
    #[serde(flatten)]
    pub payload: Value,
}

impl BridgeRequest {
    fn into_payload(self) -> (String, Value) {
        let mut payload = self.payload;
        if let Some(object) = payload.as_object_mut() {
            // path 字段从 payload 中移除（已经是 path 字段了）
            object.remove("path");
        }
        (self.path, payload)
    }
}

/// HTTP API 响应封装。
#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub ok: bool,
    pub data: Value,
}

impl IntoResponse for ApiResponse {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "ok": self.ok,
            "data": self.data,
        }));
        (StatusCode::OK, body).into_response()
    }
}

/// 健康检查响应。
#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    transport: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: crate::version::VERSION,
        transport: "http-api",
    })
}

/// `POST /api/bridge` handler。
async fn bridge_handler(
    State(state): State<Arc<ApiState>>,
    Json(req): Json<BridgeRequest>,
) -> Response {
    let (path, payload) = req.into_payload();
    let data = handle_bridge_request(state.bridge.clone(), &path, payload).await;
    // `handle_bridge_request` 总是返回 JSON Value，失败时也包含
    // `{"status":"failed", "message":"..."}` 结构
    ApiResponse { ok: true, data }.into_response()
}

/// CORS layer builder。
///
/// 允许默认 origin（Vite dev）+ 用户额外配置的 origin；暴露
/// `content-type` header 给浏览器读取响应。
pub fn cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let mut layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::OPTIONS,
        ])
        .allow_headers(Any)
        .max_age(std::time::Duration::from_secs(3600));

    if allowed_origins.is_empty() {
        // 通配模式：允许所有 origin，但不能和 credentials 同时使用
        layer = layer.allow_origin(Any);
    } else {
        let origins: Vec<HeaderValue> = allowed_origins
            .iter()
            .filter_map(|origin| HeaderValue::from_str(origin).ok())
            .collect();
        layer = layer.allow_origin(origins);
    }
    layer
}

/// 构建 HTTP API router（不包含 CORS/trace 中间件）。
pub fn build_bridge_router(bridge: BridgeContext) -> Router {
    let state = Arc::new(ApiState::new(bridge));
    Router::new()
        .route("/api/bridge", post(bridge_handler))
        .route("/api/health", get(health))
        .with_state(state)
}

/// 构建完整 HTTP API（包含 CORS + trace 中间件）。
pub fn build_api_router(bridge: BridgeContext, allowed_origins: &[String]) -> Router {
    build_bridge_router(bridge)
        .layer(cors_layer(allowed_origins))
        .layer(TraceLayer::new_for_http())
}

/// 启动 HTTP API server（绑定 `0.0.0.0:port`），用于独立运行。
pub async fn serve_api(
    bridge: BridgeContext,
    port: u16,
    allowed_origins: &[String],
) -> anyhow::Result<()> {
    let app = build_api_router(bridge, allowed_origins);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "api.listening",
        json!({
            "port": port,
            "address": format!("http://0.0.0.0:{port}"),
        }),
    );
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routes::BridgeContext;
    use crate::status::StatusStore;
    use crate::user_scripts::UserScriptManager;
    use std::sync::Arc;

    fn test_bridge_ctx() -> BridgeContext {
        let status_store = StatusStore::default();
        let user_scripts = UserScriptManager::new(
            std::env::temp_dir().join("codex-plus-test-builtin"),
            std::env::temp_dir().join("codex-plus-test-user-scripts"),
            std::env::temp_dir().join("codex-plus-test-user-scripts.json"),
        );
        let runtime = Arc::new(
            crate::routes::CoreRuntimeService::new(9229, status_store)
                .with_user_scripts(user_scripts),
        );
        // CoreSettingsService + CoreRuntimeService + UnavailableDataService
        BridgeContext::core(runtime)
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let ctx = test_bridge_ctx();
        let app = build_bridge_router(ctx);

        let response = axum::http::Request::builder()
            .uri("/api/health")
            .body(axum::body::Body::empty())
            .unwrap();
        let response = tower::ServiceExt::oneshot(app, response).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["transport"], "http-api");
    }

    #[tokio::test]
    async fn bridge_dispatches_settings_get() {
        let ctx = test_bridge_ctx();
        let app = build_bridge_router(ctx);

        let body = serde_json::json!({
            "path": "/settings/get",
        });
        let response = axum::http::Request::builder()
            .method("POST")
            .uri("/api/bridge")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let response = tower::ServiceExt::oneshot(app, response).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(json["ok"], true);
        // settings 响应应至少包含 `data` object，且不是空
        assert!(json["data"].is_object(), "expected data object, got: {json}");
    }

    #[tokio::test]
    async fn bridge_unknown_path_returns_failed_status() {
        let ctx = test_bridge_ctx();
        let app = build_bridge_router(ctx);

        let body = serde_json::json!({
            "path": "/this/does/not/exist",
        });
        let response = axum::http::Request::builder()
            .method("POST")
            .uri("/api/bridge")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let response = tower::ServiceExt::oneshot(app, response).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(json["data"]["status"], "failed");
    }
}
