use axum::{
    body::Body,
    extract::{Multipart, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tokio::fs;
use tokio_util::io::ReaderStream;

use super::model::{DirEntryInfo, ListDirResponse, UploadResponse};
use super::resolve;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    /// Relative path, e.g. `photos/2026` or empty/omitted for the root.
    #[serde(default)]
    path: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    path: String,
    /// Required to delete a non-empty directory, as a safety rail against
    /// fat-fingering a whole tree away.
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, Deserialize)]
pub struct MoveQuery {
    /// Existing relative path (file or directory) to move/rename.
    from: String,
    /// Destination relative path, including the new file/directory name —
    /// e.g. moving `a/b.txt` to `c` means passing `to=c/b.txt`, not `to=c`.
    to: String,
    /// If false (default), refuse to clobber an existing file/directory at
    /// `to`.
    #[serde(default)]
    overwrite: bool,
}

pub async fn list_dir(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult<Json<ListDirResponse>> {
    let root = &state.settings.files.root_dir;
    let target = resolve(root, &q.path)?;

    let mut read_dir = fs::read_dir(&target).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(e)
        }
    })?;

    let mut entries = Vec::new();
    while let Some(entry) = read_dir.next_entry().await? {
        let meta = entry.metadata().await?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified,
        });
    }

    // Directories first, then alphabetical — nicer to browse than raw
    // filesystem order.
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));

    Ok(Json(ListDirResponse {
        path: q.path,
        entries,
    }))
}

/// How the file's bytes should be presented to the browser.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Disposition {
    /// `Content-Disposition: attachment` — browser always saves it.
    Attachment,
    /// `Content-Disposition: inline` — browser renders it if it can
    /// (images, PDFs, HTML, ...), otherwise falls back to its own default
    /// (usually still a download prompt).
    Inline,
}

impl Disposition {
    fn as_str(self) -> &'static str {
        match self {
            Disposition::Attachment => "attachment",
            Disposition::Inline => "inline",
        }
    }
}

/// `GET /download` — always forces a save-as-attachment, for files *and*
/// directories (a directory is zipped up on the fly first).
pub async fn download_file(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult<Response> {
    serve_path(state, q.path, Disposition::Attachment).await
}

/// `GET /view` — serves the file inline, for opening in a new tab or as an
/// `<img>` thumbnail source. Only meaningful for files; a directory can't be
/// usefully "viewed" so this rejects those and points at `/download`.
pub async fn view_file(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult<Response> {
    serve_path(state, q.path, Disposition::Inline).await
}

async fn serve_path(state: AppState, path: String, disposition: Disposition) -> AppResult<Response> {
    if path.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }

    let root = &state.settings.files.root_dir;
    let target = resolve(root, &path)?;

    let meta = fs::metadata(&target).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(e)
        }
    })?;

    if meta.is_dir() {
        if disposition == Disposition::Inline {
            return Err(AppError::BadRequest(
                "can't view a directory inline; use the download button to get a zip".into(),
            ));
        }
        return download_directory_as_zip(target).await;
    }

    let file = fs::File::open(&target).await?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let filename = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string());
    let mime = mime_guess::from_path(&target).first_or_octet_stream();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("{}; filename=\"{filename}\"", disposition.as_str()))
            .unwrap_or(HeaderValue::from_static("attachment")),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(meta.len()));

    Ok((headers, body).into_response())
}

/// Zips a directory in memory and returns it as an attachment response.
///
/// This buffers the whole archive in RAM before sending, which keeps the
/// implementation simple and is perfectly fine for typical home-folder
/// sizes — if you're regularly zipping tens of gigabytes at once, you'd be
/// better off doing that directly on the Pi instead.
async fn download_directory_as_zip(dir: std::path::PathBuf) -> AppResult<Response> {
    let base_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "folder".to_string());

    let base_name_for_task = base_name.clone();
    let bytes = tokio::task::spawn_blocking(move || build_zip(&dir, &base_name_for_task))
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip task failed: {e}")))??;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{base_name}.zip\""))
            .unwrap_or(HeaderValue::from_static("attachment")),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(bytes.len() as u64));

    Ok((headers, Body::from(bytes)).into_response())
}

/// Synchronous, blocking zip build — run this inside `spawn_blocking`, never
/// directly on an async task.
fn build_zip(dir: &std::path::Path, base_name: &str) -> AppResult<Vec<u8>> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buffer);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        for entry in walkdir::WalkDir::new(dir).into_iter() {
            let entry =
                entry.map_err(|e| AppError::Other(anyhow::anyhow!("walking directory: {e}")))?;
            let rel = entry.path().strip_prefix(dir).unwrap_or(entry.path());
            if rel.as_os_str().is_empty() {
                continue; // skip the root directory entry itself
            }
            let entry_name = format!("{base_name}/{}", rel.to_string_lossy().replace('\\', "/"));

            if entry.file_type().is_dir() {
                zip.add_directory(&entry_name, options)
                    .map_err(|e| AppError::Other(anyhow::anyhow!("zip: {e}")))?;
            } else {
                zip.start_file(&entry_name, options)
                    .map_err(|e| AppError::Other(anyhow::anyhow!("zip: {e}")))?;
                let mut f = std::fs::File::open(entry.path())?;
                std::io::copy(&mut f, &mut zip)?;
            }
        }
        zip.finish()
            .map_err(|e| AppError::Other(anyhow::anyhow!("zip: {e}")))?;
    }
    Ok(buffer.into_inner())
}

pub async fn upload_file(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
    mut multipart: Multipart,
) -> AppResult<Json<UploadResponse>> {
    let root = &state.settings.files.root_dir;
    let dest_dir = resolve(root, &q.path)?;
    fs::create_dir_all(&dest_dir).await?;

    let max_bytes = state.settings.files.max_upload_mb * 1024 * 1024;
    let mut uploaded = Vec::new();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let Some(original_name) = field.file_name().map(str::to_string) else {
            continue; // a non-file form field; skip it
        };
        // Guard against a filename smuggling a path (e.g. "../../etc/passwd").
        let safe_name = sanitize_filename(&original_name);
        let dest_path = dest_dir.join(&safe_name);

        let mut file = fs::File::create(&dest_path).await?;
        let mut written: u64 = 0;

        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?
        {
            written += chunk.len() as u64;
            if written > max_bytes {
                // Clean up the partial file rather than leaving debris.
                drop(file);
                let _ = fs::remove_file(&dest_path).await;
                return Err(AppError::TooLarge);
            }
            file.write_all(&chunk).await?;
        }

        uploaded.push(safe_name);
    }

    Ok(Json(UploadResponse { uploaded }))
}

pub async fn make_dir(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult<()> {
    if q.path.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }
    let root = &state.settings.files.root_dir;
    let target = resolve(root, &q.path)?;
    fs::create_dir_all(&target).await?;
    Ok(())
}

pub async fn move_entry(
    State(state): State<AppState>,
    Query(q): Query<MoveQuery>,
) -> AppResult<()> {
    if q.from.is_empty() || q.to.is_empty() {
        return Err(AppError::BadRequest("from and to are both required".into()));
    }

    let root = &state.settings.files.root_dir;
    let from = resolve(root, &q.from)?;
    let to = resolve(root, &q.to)?;

    fs::metadata(&from).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(e)
        }
    })?;

    if from == to {
        return Ok(());
    }

    if !q.overwrite && fs::metadata(&to).await.is_ok() {
        return Err(AppError::BadRequest(
            "something already exists at the destination; pass overwrite=true to replace it"
                .into(),
        ));
    }

    // Make sure the destination's parent directory exists (e.g. moving into
    // a brand new subfolder created in the same request as the move).
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).await?;
    }

    fs::rename(&from, &to).await.map_err(|e| {
        // Covers the case where root_dir spans multiple filesystems/mounts,
        // where a plain rename can't work.
        if e.raw_os_error() == Some(18) {
            AppError::BadRequest(
                "can't move across filesystems; copy and delete instead".into(),
            )
        } else {
            AppError::Io(e)
        }
    })?;

    Ok(())
}

pub async fn delete_entry(
    State(state): State<AppState>,
    Query(q): Query<DeleteQuery>,
) -> AppResult<()> {
    if q.path.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }
    let root = &state.settings.files.root_dir;
    let target = resolve(root, &q.path)?;

    let meta = fs::metadata(&target).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(e)
        }
    })?;

    if meta.is_dir() {
        if q.recursive {
            fs::remove_dir_all(&target).await?;
        } else {
            fs::remove_dir(&target).await.map_err(|e| {
                if e.kind() == std::io::ErrorKind::Other || e.raw_os_error() == Some(39) {
                    AppError::BadRequest(
                        "directory is not empty; pass recursive=true to delete it anyway".into(),
                    )
                } else {
                    AppError::Io(e)
                }
            })?;
        }
    } else {
        fs::remove_file(&target).await?;
    }

    Ok(())
}

/// Strips any path separators and leading dots so an uploaded filename can
/// never be used to write outside the destination directory.
fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let trimmed = base.trim_start_matches('.');
    if trimmed.is_empty() {
        "unnamed".to_string()
    } else {
        trimmed.to_string()
    }
}
