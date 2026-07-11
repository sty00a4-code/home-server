use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Semester {
    pub id: i64,
    pub label: String,
    pub term: String,
    pub start_year: i64,
    pub sort_order: i64,
}

impl Semester {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            label: row.get("label")?,
            term: row.get("term")?,
            start_year: row.get("start_year")?,
            sort_order: row.get("sort_order")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct NewSemester {
    pub label: String,
    pub term: String,
    pub start_year: i64,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
pub struct StudyProgram {
    pub id: i64,
    pub name: String,
    pub degree: String,
    pub po_version: Option<String>,
    pub lp_required: i64,
    pub is_primary: bool,
}

impl StudyProgram {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            degree: row.get("degree")?,
            po_version: row.get("po_version")?,
            lp_required: row.get("lp_required")?,
            is_primary: row.get::<_, i64>("is_primary")? != 0,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct NewStudyProgram {
    pub name: String,
    pub degree: String,
    pub po_version: Option<String>,
    pub lp_required: i64,
    #[serde(default)]
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
pub struct PoArea {
    pub id: i64,
    pub study_program_id: i64,
    pub name: String,
    pub lp_required: Option<i64>,
}

impl PoArea {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            study_program_id: row.get("study_program_id")?,
            name: row.get("name")?,
            lp_required: row.get("lp_required")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct NewPoArea {
    pub study_program_id: i64,
    pub name: String,
    pub lp_required: Option<i64>,
}

/// A Modul — tracks whether you'll take it, are taking it, or have taken it,
/// plus its final grade (Modulnote) once finished.
#[derive(Debug, Serialize)]
pub struct Module {
    pub id: i64,
    pub study_program_id: i64,
    pub po_area_id: Option<i64>,
    pub module_code: Option<String>,
    pub title: String,
    pub lp: f64,
    pub module_kind: String,
    pub recommended_semester: Option<i64>,
    pub status: String,
    pub planned_semester_id: Option<i64>,
    pub completed_semester_id: Option<i64>,
    pub final_grade: Option<f64>,
    pub module_coordinator: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Module {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            study_program_id: row.get("study_program_id")?,
            po_area_id: row.get("po_area_id")?,
            module_code: row.get("module_code")?,
            title: row.get("title")?,
            lp: row.get("lp")?,
            module_kind: row.get("module_kind")?,
            recommended_semester: row.get("recommended_semester")?,
            status: row.get("status")?,
            planned_semester_id: row.get("planned_semester_id")?,
            completed_semester_id: row.get("completed_semester_id")?,
            final_grade: row.get("final_grade")?,
            module_coordinator: row.get("module_coordinator")?,
            notes: row.get("notes")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

fn default_module_kind() -> String {
    "Pflicht".to_string()
}

fn default_status() -> String {
    "geplant".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ModuleInput {
    pub study_program_id: i64,
    pub po_area_id: Option<i64>,
    pub module_code: Option<String>,
    pub title: String,
    pub lp: f64,
    #[serde(default = "default_module_kind")]
    pub module_kind: String,
    pub recommended_semester: Option<i64>,
    #[serde(default = "default_status")]
    pub status: String,
    pub planned_semester_id: Option<i64>,
    pub completed_semester_id: Option<i64>,
    pub final_grade: Option<f64>,
    pub module_coordinator: Option<String>,
    pub notes: Option<String>,
}

/// A Prüfungsleistung (or Studienleistung) belonging to a module.
#[derive(Debug, Serialize)]
pub struct Exam {
    pub id: i64,
    pub module_id: i64,
    pub semester_id: i64,
    pub exam_type: String,
    pub attempt_number: i64,
    pub exam_date: Option<String>,
    pub registered: bool,
    pub grade: Option<f64>,
    pub passed: Option<bool>,
    pub weight_percent: Option<f64>,
    pub notes: Option<String>,
}

impl Exam {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            module_id: row.get("module_id")?,
            semester_id: row.get("semester_id")?,
            exam_type: row.get("exam_type")?,
            attempt_number: row.get("attempt_number")?,
            exam_date: row.get("exam_date")?,
            registered: row.get::<_, i64>("registered")? != 0,
            grade: row.get("grade")?,
            passed: row.get::<_, Option<i64>>("passed")?.map(|v| v != 0),
            weight_percent: row.get("weight_percent")?,
            notes: row.get("notes")?,
        })
    }
}

fn default_attempt_number() -> i64 {
    1
}

#[derive(Debug, Deserialize)]
pub struct ExamInput {
    pub module_id: i64,
    pub semester_id: i64,
    pub exam_type: String,
    #[serde(default = "default_attempt_number")]
    pub attempt_number: i64,
    pub exam_date: Option<String>,
    #[serde(default)]
    pub registered: bool,
    pub grade: Option<f64>,
    pub passed: Option<bool>,
    pub weight_percent: Option<f64>,
    pub notes: Option<String>,
}

/// LP earned and LP-weighted average grade per study program — mirrors
/// `v_progress_summary` in the schema.
#[derive(Debug, Serialize)]
pub struct ProgressSummary {
    pub study_program_id: i64,
    pub study_program_name: String,
    pub lp_required: i64,
    pub lp_earned: f64,
    pub lp_weighted_average_grade: Option<f64>,
}

impl ProgressSummary {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            study_program_id: row.get("study_program_id")?,
            study_program_name: row.get("study_program_name")?,
            lp_required: row.get("lp_required")?,
            lp_earned: row.get("lp_earned")?,
            lp_weighted_average_grade: row.get("lp_weighted_average_grade")?,
        })
    }
}
