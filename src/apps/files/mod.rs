mod handlers;
mod model;

use crate::{error::AppError, state::AppState};
use axum::{
    routing::{delete, get, post},
    Router,
};
use std::path::{Component, Path, PathBuf};

/// Resolves a user-supplied relative path against the configured root
/// directory, refusing to leave it.
///
/// This is the single choke point every file handler goes through — treat
/// it as the security boundary for the whole app. `rel` comes straight from
/// a query string, so it is untrusted input.
pub(crate) fn resolve(root: &Path, rel: &str) -> Result<PathBuf, AppError> {
    // Reject absolute paths and any `..` component outright, rather than
    // trying to cleverly normalize them away.
    let rel_path = Path::new(rel.trim_start_matches('/'));
    for component in rel_path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => {
                return Err(AppError::Forbidden(
                    "path must be relative and stay within the root directory".into(),
                ))
            }
        }
    }

    let candidate = root.join(rel_path);

    // Canonicalize what we can. The candidate itself may not exist yet
    // (e.g. an upload target), so fall back to checking its parent.
    let check_target = if candidate.exists() {
        candidate.clone()
    } else {
        candidate
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.to_path_buf())
    };

    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::Other(anyhow::anyhow!("root dir misconfigured: {e}")))?;
    let canonical_check = check_target
        .canonicalize()
        .map_err(|_| AppError::Forbidden("path escapes the root directory".into()))?;

    if !canonical_check.starts_with(&canonical_root) {
        return Err(AppError::Forbidden(
            "path escapes the root directory".into(),
        ));
    }

    Ok(candidate)
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/", get(handlers::list_dir))
        .route("/download", get(handlers::download_file))
        .route("/upload", post(handlers::upload_file))
        .route("/mkdir", post(handlers::make_dir))
        .route("/move", post(handlers::move_entry))
        .route("/", delete(handlers::delete_entry))
        .with_state(state)
}
