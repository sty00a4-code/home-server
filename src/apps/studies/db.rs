use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Runs `f` against the shared SQLite connection on a blocking thread pool
/// thread. Every studies handler goes through this — `rusqlite::Connection`
/// is synchronous, so it must never be touched directly from async code.
pub async fn with_db<T, F>(state: &AppState, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
{
    let db = state.studies_db.clone();
    let result = tokio::task::spawn_blocking(move || {
        // A poisoned lock (a previous query panicked mid-transaction) isn't
        // worth taking the whole app down over on a personal server —
        // recover the connection and keep going.
        let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&conn)
    })
    .await
    .map_err(|e| AppError::Other(anyhow::anyhow!("database task panicked: {e}")))?;

    Ok(result?)
}

/// Opens the database (creating the file and its parent directory if
/// needed) and applies `db/studies_schema.sql`, which is safe to re-run on
/// every startup.
pub fn open_and_migrate(db_path: &std::path::Path) -> anyhow::Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(include_str!("../../../db/studies_schema.sql"))?;
    Ok(conn)
}
