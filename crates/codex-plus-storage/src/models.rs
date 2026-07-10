#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SessionRef {
    pub session_id: String,
    pub title: String,
}

impl SessionRef {
    pub fn new(
        session_id: impl Into<String>,
        title: impl Into<String>,
    ) -> anyhow::Result<SessionRef> {
        let session_id = session_id.into();
        if session_id.is_empty() {
            anyhow::bail!("session_id cannot be empty");
        }

        Ok(SessionRef {
            session_id,
            title: title.into(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeleteStatus {
    ServerDeleted,
    LocalDeleted,
    Partial,
    Failed,
    Undone,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeleteResult {
    pub status: DeleteStatus,
    pub session_id: String,
    pub message: String,
    pub undo_token: Option<String>,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    Exported,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExportResult {
    pub status: ExportStatus,
    pub session_id: String,
    pub message: String,
    pub filename: Option<String>,
    pub markdown: Option<String>,
}
