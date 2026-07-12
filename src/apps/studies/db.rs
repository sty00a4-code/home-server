use rusqlite::{Connection, OptionalExtension};

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
/// needed), runs any one-off migrations that a plain `CREATE TABLE IF NOT
/// EXISTS` can't express, then applies `db/studies_schema.sql`, which is
/// safe to re-run on every startup.
pub fn open_and_migrate(db_path: &std::path::Path) -> anyhow::Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    migrate_exam_type_praktikum(&conn)?;
    conn.execute_batch(include_str!("../../../db/studies_schema.sql"))?;
    Ok(conn)
}

/// SQLite can't `ALTER TABLE ... CHECK` an existing constraint, so on a
/// database created before "Praktikum" was added as an exam type, rebuild
/// the `exams` table with the wider constraint and copy the rows across.
/// A no-op on a fresh database (the table won't exist yet) or one that's
/// already been migrated.
fn migrate_exam_type_praktikum(conn: &Connection) -> anyhow::Result<()> {
    let current_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exams'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    let Some(sql) = current_sql else {
        return Ok(()); // fresh database — schema.sql will create it correctly
    };
    if sql.contains("Praktikum") {
        return Ok(()); // already migrated
    }

    tracing::info!("migrating exams table to add the Praktikum exam type");
    conn.execute_batch(
        "BEGIN;
         ALTER TABLE exams RENAME TO exams_old_pre_praktikum;
         CREATE TABLE exams (
             id               INTEGER PRIMARY KEY AUTOINCREMENT,
             module_id        INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
             semester_id      INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
             exam_type        TEXT NOT NULL CHECK (exam_type IN (
                                   'Klausur', 'Hausarbeit', 'Muendliche_Pruefung', 'Portfolio',
                                   'Projektbericht', 'Referat', 'Praktikum', 'Abschlussarbeit', 'Sonstige'
                               )),
             attempt_number   INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 3),
             exam_date        TEXT,
             registered       INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0, 1)),
             grade            REAL,
             passed           INTEGER CHECK (passed IN (0, 1)),
             weight_percent   REAL,
             notes            TEXT
         );
         INSERT INTO exams SELECT * FROM exams_old_pre_praktikum;
         DROP TABLE exams_old_pre_praktikum;
         COMMIT;",
    )?;

    Ok(())
}
