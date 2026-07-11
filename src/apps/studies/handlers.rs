use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use super::db::with_db;
use super::model::*;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// --- semesters -----------------------------------------------------------

pub async fn list_semesters(State(state): State<AppState>) -> AppResult<Json<Vec<Semester>>> {
    with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM semesters ORDER BY sort_order")?;
        let rows = stmt.query_map([], Semester::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_semester(
    State(state): State<AppState>,
    Json(input): Json<NewSemester>,
) -> AppResult<Json<Semester>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO semesters (label, term, start_year, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![input.label, input.term, input.start_year, input.sort_order],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM semesters WHERE id = ?1", [id], Semester::from_row)
    })
    .await
    .map(Json)
}

// --- study programs --------------------------------------------------------

pub async fn list_study_programs(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<StudyProgram>>> {
    with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM study_programs ORDER BY is_primary DESC, name")?;
        let rows = stmt.query_map([], StudyProgram::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_study_program(
    State(state): State<AppState>,
    Json(input): Json<NewStudyProgram>,
) -> AppResult<Json<StudyProgram>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO study_programs (name, degree, po_version, lp_required, is_primary)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                input.name,
                input.degree,
                input.po_version,
                input.lp_required,
                input.is_primary as i64
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT * FROM study_programs WHERE id = ?1",
            [id],
            StudyProgram::from_row,
        )
    })
    .await
    .map(Json)
}

// --- PO areas (Prüfungsordnungsbereiche) ------------------------------------

#[derive(Debug, Deserialize)]
pub struct PoAreaFilter {
    pub study_program_id: Option<i64>,
}

pub async fn list_po_areas(
    State(state): State<AppState>,
    Query(filter): Query<PoAreaFilter>,
) -> AppResult<Json<Vec<PoArea>>> {
    with_db(&state, move |conn| {
        match filter.study_program_id {
            Some(sp_id) => {
                let mut stmt =
                    conn.prepare("SELECT * FROM po_areas WHERE study_program_id = ?1 ORDER BY name")?;
                let rows = stmt.query_map([sp_id], PoArea::from_row)?;
                rows.collect()
            }
            None => {
                let mut stmt = conn.prepare("SELECT * FROM po_areas ORDER BY study_program_id, name")?;
                let rows = stmt.query_map([], PoArea::from_row)?;
                rows.collect()
            }
        }
    })
    .await
    .map(Json)
}

pub async fn create_po_area(
    State(state): State<AppState>,
    Json(input): Json<NewPoArea>,
) -> AppResult<Json<PoArea>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO po_areas (study_program_id, name, lp_required) VALUES (?1, ?2, ?3)",
            rusqlite::params![input.study_program_id, input.name, input.lp_required],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM po_areas WHERE id = ?1", [id], PoArea::from_row)
    })
    .await
    .map(Json)
}

// --- modules ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ModuleFilter {
    pub study_program_id: Option<i64>,
    pub status: Option<String>,
}

pub async fn list_modules(
    State(state): State<AppState>,
    Query(filter): Query<ModuleFilter>,
) -> AppResult<Json<Vec<Module>>> {
    with_db(&state, move |conn| {
        let mut sql = "SELECT * FROM modules WHERE 1=1".to_string();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(sp_id) = filter.study_program_id {
            sql.push_str(" AND study_program_id = ?");
            params.push(Box::new(sp_id));
        }
        if let Some(status) = &filter.status {
            sql.push_str(" AND status = ?");
            params.push(Box::new(status.clone()));
        }
        sql.push_str(" ORDER BY recommended_semester IS NULL, recommended_semester, title");

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Module::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn get_module(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<Module>> {
    with_db(&state, move |conn| {
        conn.query_row("SELECT * FROM modules WHERE id = ?1", [id], Module::from_row)
    })
    .await
    .map(Json)
}

pub async fn create_module(
    State(state): State<AppState>,
    Json(input): Json<ModuleInput>,
) -> AppResult<Json<Module>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO modules (
                study_program_id, po_area_id, module_code, title, lp, module_kind,
                recommended_semester, status, planned_semester_id, completed_semester_id,
                final_grade, module_coordinator, notes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                input.study_program_id,
                input.po_area_id,
                input.module_code,
                input.title,
                input.lp,
                input.module_kind,
                input.recommended_semester,
                input.status,
                input.planned_semester_id,
                input.completed_semester_id,
                input.final_grade,
                input.module_coordinator,
                input.notes,
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM modules WHERE id = ?1", [id], Module::from_row)
    })
    .await
    .map(Json)
}

pub async fn update_module(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<ModuleInput>,
) -> AppResult<Json<Module>> {
    with_db(&state, move |conn| {
        let updated = conn.execute(
            "UPDATE modules SET
                study_program_id = ?1, po_area_id = ?2, module_code = ?3, title = ?4, lp = ?5,
                module_kind = ?6, recommended_semester = ?7, status = ?8,
                planned_semester_id = ?9, completed_semester_id = ?10, final_grade = ?11,
                module_coordinator = ?12, notes = ?13, updated_at = datetime('now')
             WHERE id = ?14",
            rusqlite::params![
                input.study_program_id,
                input.po_area_id,
                input.module_code,
                input.title,
                input.lp,
                input.module_kind,
                input.recommended_semester,
                input.status,
                input.planned_semester_id,
                input.completed_semester_id,
                input.final_grade,
                input.module_coordinator,
                input.notes,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row("SELECT * FROM modules WHERE id = ?1", [id], Module::from_row)
    })
    .await
    .map(Json)
}

pub async fn delete_module(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM modules WHERE id = ?1", [id])
    })
    .await?;

    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- exams -------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExamFilter {
    pub module_id: Option<i64>,
}

pub async fn list_exams(
    State(state): State<AppState>,
    Query(filter): Query<ExamFilter>,
) -> AppResult<Json<Vec<Exam>>> {
    with_db(&state, move |conn| match filter.module_id {
        Some(module_id) => {
            let mut stmt = conn.prepare(
                "SELECT * FROM exams WHERE module_id = ?1 ORDER BY semester_id, attempt_number",
            )?;
            let rows = stmt.query_map([module_id], Exam::from_row)?;
            rows.collect()
        }
        None => {
            let mut stmt = conn.prepare("SELECT * FROM exams ORDER BY semester_id, module_id")?;
            let rows = stmt.query_map([], Exam::from_row)?;
            rows.collect()
        }
    })
    .await
    .map(Json)
}

pub async fn create_exam(
    State(state): State<AppState>,
    Json(input): Json<ExamInput>,
) -> AppResult<Json<Exam>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO exams (
                module_id, semester_id, exam_type, attempt_number, exam_date,
                registered, grade, passed, weight_percent, notes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                input.module_id,
                input.semester_id,
                input.exam_type,
                input.attempt_number,
                input.exam_date,
                input.registered as i64,
                input.grade,
                input.passed.map(|v| v as i64),
                input.weight_percent,
                input.notes,
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM exams WHERE id = ?1", [id], Exam::from_row)
    })
    .await
    .map(Json)
}

pub async fn update_exam(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<ExamInput>,
) -> AppResult<Json<Exam>> {
    with_db(&state, move |conn| {
        let updated = conn.execute(
            "UPDATE exams SET
                module_id = ?1, semester_id = ?2, exam_type = ?3, attempt_number = ?4,
                exam_date = ?5, registered = ?6, grade = ?7, passed = ?8,
                weight_percent = ?9, notes = ?10
             WHERE id = ?11",
            rusqlite::params![
                input.module_id,
                input.semester_id,
                input.exam_type,
                input.attempt_number,
                input.exam_date,
                input.registered as i64,
                input.grade,
                input.passed.map(|v| v as i64),
                input.weight_percent,
                input.notes,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row("SELECT * FROM exams WHERE id = ?1", [id], Exam::from_row)
    })
    .await
    .map(Json)
}

pub async fn delete_exam(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM exams WHERE id = ?1", [id])
    })
    .await?;

    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- summary -------------------------------------------------------------

pub async fn summary(State(state): State<AppState>) -> AppResult<Json<Vec<ProgressSummary>>> {
    with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM v_progress_summary ORDER BY study_program_id")?;
        let rows = stmt.query_map([], ProgressSummary::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}
