use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub is_dir: bool,
    /// Size in bytes. `0` for directories.
    pub size: u64,
    /// Unix timestamp (seconds) of last modification, if available.
    pub modified: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ListDirResponse {
    /// The relative path that was listed (empty string = root).
    pub path: String,
    pub entries: Vec<DirEntryInfo>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub uploaded: Vec<String>,
}
