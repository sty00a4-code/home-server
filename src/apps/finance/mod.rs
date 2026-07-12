mod db;
mod handlers;
mod model;
pub mod schedule;

pub use db::open_and_migrate;

use crate::state::AppState;
use axum::{
    routing::{delete, get, put},
    Router,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/payment-types",
            get(handlers::list_payment_types).post(handlers::create_payment_type),
        )
        .route("/payment-types/:id", delete(handlers::delete_payment_type))
        .route(
            "/categories",
            get(handlers::list_categories).post(handlers::create_category),
        )
        .route(
            "/categories/:id",
            put(handlers::update_category).delete(handlers::delete_category),
        )
        .route(
            "/transactions",
            get(handlers::list_transactions).post(handlers::create_transaction),
        )
        .route(
            "/transactions/:id",
            put(handlers::update_transaction).delete(handlers::delete_transaction),
        )
        .route(
            "/scheduled",
            get(handlers::list_scheduled).post(handlers::create_scheduled),
        )
        .route(
            "/scheduled/:id",
            put(handlers::update_scheduled).delete(handlers::delete_scheduled),
        )
        .route("/summary", get(handlers::summary))
        .with_state(state)
}

/// Runs the recurring-transaction catch-up check against the shared
/// connection on a blocking thread. Called once at startup and
/// periodically after that — see `main.rs`.
pub async fn run_catch_up(state: &AppState) -> anyhow::Result<usize> {
    let db = state.finance_db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        schedule::catch_up(&conn)
    })
    .await?
}
