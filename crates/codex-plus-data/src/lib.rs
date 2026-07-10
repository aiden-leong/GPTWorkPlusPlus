//! Markdown 导出 —— 留在这里是因为它依赖 codex-plus-core 里的
//! `ExportResult` / `ExportStatus` / `SessionRef` 等类型，但本身不依赖
//! storage crate（不读 SQLite）。
//!
//! 备份 / SQLite / provider_sync 已经搬到 codex-plus-storage crate。

pub mod markdown;

pub use markdown::{MarkdownExportService, export_markdown_from_paths};
