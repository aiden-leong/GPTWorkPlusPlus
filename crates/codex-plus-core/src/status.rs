use std::fs;
use std::path::PathBuf;

use anyhow::Context;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LaunchStatus {
    pub status: String,
    pub message: String,
    pub started_at_ms: u64,
    pub debug_port: Option<u16>,
    pub helper_port: Option<u16>,
    pub codex_app: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StatusStore {
    path: PathBuf,
}

impl Default for StatusStore {
    fn default() -> Self {
        Self::new(crate::paths::default_latest_status_path())
    }
}

impl StatusStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn save_latest(&self, status: &LaunchStatus) -> anyhow::Result<()> {
        let bytes = serde_json::to_vec_pretty(status)?;
        crate::settings::atomic_write(&self.path, &bytes)
    }

    pub fn load_latest(&self) -> anyhow::Result<Option<LaunchStatus>> {
        let contents = match fs::read_to_string(&self.path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("failed to read latest status {}", self.path.display())
                });
            }
        };

        Ok(serde_json::from_str(&contents).ok())
    }
}
