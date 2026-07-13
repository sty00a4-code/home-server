mod db;
mod handlers;
mod model;

pub use db::open_and_migrate;

use crate::state::AppState;
use axum::{
    routing::{get, put},
    Router,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/semesters",
            get(handlers::list_semesters).post(handlers::create_semester),
        )
        .route(
            "/programs",
            get(handlers::list_study_programs).post(handlers::create_study_program),
        )
        .route(
            "/po-areas",
            get(handlers::list_po_areas).post(handlers::create_po_area),
        )
        .route(
            "/modules",
            get(handlers::list_modules).post(handlers::create_module),
        )
        .route(
            "/modules/:id",
            get(handlers::get_module)
                .put(handlers::update_module)
                .delete(handlers::delete_module),
        )
        .route(
            "/exams",
            get(handlers::list_exams).post(handlers::create_exam),
        )
        .route(
            "/exams/:id",
            put(handlers::update_exam).delete(handlers::delete_exam),
        )
        .route("/summary", get(handlers::summary))
        .with_state(state)
}
