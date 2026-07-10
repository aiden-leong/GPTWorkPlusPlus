//! 存储层 —— 拆出 codex-plus-data 的 storage / provider_sync / backup 模块，
//! 让 codex-plus-core 也能用上（解开 core ↔ data 循环依赖）。
//!
//! 同时把原来在 codex-plus-core::models 里的数据模型（`SessionRef` /
//! `DeleteResult` / `ExportResult` 等）也搬到这里，让本 crate 不依赖 core。
//! 新的依赖方向：
//!   - codex-plus-core → codex-plus-storage（manager 业务层用）
//!   - codex-plus-data → codex-plus-storage（markdown 导出用）
//! 没有任何环。

pub mod backup;
pub mod codex_home;
pub mod codex_sqlite;
pub mod diagnostic_log;
pub mod models;
pub mod model_suffix;
pub mod paths;
pub mod provider_sync;
pub mod storage;

pub use backup::BackupStore;
pub use models::{DeleteResult, DeleteStatus, ExportResult, ExportStatus, SessionRef};
pub use provider_sync::{
    ProviderSyncResult, ProviderSyncStatus, ProviderSyncTargetList, ProviderSyncTargetOption,
    ProviderSyncTargetSource, load_provider_sync_targets, run_provider_sync,
    run_provider_sync_with_target,
};
pub use storage::{
    LocalSession, SQLiteStorageAdapter, delete_local_from_paths,
    move_codex_thread_workspace_from_paths,
};
