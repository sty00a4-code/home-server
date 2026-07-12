use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Datelike, Local, NaiveDate};
use serde::Deserialize;

use super::db::with_db;
use super::model::*;
use super::schedule;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// --- payment types ---------------------------------------------------------

pub async fn list_payment_types(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<PaymentType>>> {
    with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM payment_types ORDER BY name")?;
        let rows = stmt.query_map([], PaymentType::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_payment_type(
    State(state): State<AppState>,
    Json(input): Json<NewPaymentType>,
) -> AppResult<Json<PaymentType>> {
    with_db(&state, move |conn| {
        conn.execute("INSERT INTO payment_types (name) VALUES (?1)", [&input.name])?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT * FROM payment_types WHERE id = ?1",
            [id],
            PaymentType::from_row,
        )
    })
    .await
    .map(Json)
}

pub async fn delete_payment_type(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM payment_types WHERE id = ?1", [id])
    })
    .await?;
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- categories --------------------------------------------------------

pub async fn list_categories(State(state): State<AppState>) -> AppResult<Json<Vec<Category>>> {
    with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT * FROM categories ORDER BY parent_id IS NOT NULL, name")?;
        let rows = stmt.query_map([], Category::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_category(
    State(state): State<AppState>,
    Json(input): Json<CategoryInput>,
) -> AppResult<Json<Category>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO categories (name, parent_id) VALUES (?1, ?2)",
            rusqlite::params![input.name, input.parent_id],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM categories WHERE id = ?1", [id], Category::from_row)
    })
    .await
    .map(Json)
}

pub async fn update_category(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<CategoryInput>,
) -> AppResult<Json<Category>> {
    with_db(&state, move |conn| {
        let updated = conn.execute(
            "UPDATE categories SET name = ?1, parent_id = ?2 WHERE id = ?3",
            rusqlite::params![input.name, input.parent_id, id],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row("SELECT * FROM categories WHERE id = ?1", [id], Category::from_row)
    })
    .await
    .map(Json)
}

pub async fn delete_category(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM categories WHERE id = ?1", [id])
    })
    .await?;
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- transactions --------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TransactionFilter {
    pub category_id: Option<i64>,
    /// Inclusive ISO date/datetime lower bound on `occurred_at`.
    pub from: Option<String>,
    /// Inclusive ISO date/datetime upper bound on `occurred_at`.
    pub to: Option<String>,
}

/// Always sorted newest-first (`occurred_at DESC`) — the nearest date to
/// now is what belongs at the top of the ledger.
pub async fn list_transactions(
    State(state): State<AppState>,
    Query(filter): Query<TransactionFilter>,
) -> AppResult<Json<Vec<Transaction>>> {
    with_db(&state, move |conn| {
        let mut sql = "SELECT * FROM transactions WHERE 1=1".to_string();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(cat_id) = filter.category_id {
            sql.push_str(" AND category_id = ?");
            params.push(Box::new(cat_id));
        }
        if let Some(from) = &filter.from {
            sql.push_str(" AND occurred_at >= ?");
            params.push(Box::new(from.clone()));
        }
        if let Some(to) = &filter.to {
            sql.push_str(" AND occurred_at <= ?");
            params.push(Box::new(to.clone()));
        }
        sql.push_str(" ORDER BY occurred_at DESC, id DESC");

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Transaction::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_transaction(
    State(state): State<AppState>,
    Json(input): Json<TransactionInput>,
) -> AppResult<Json<Transaction>> {
    with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO transactions (
                amount, occurred_at, description, sent_to, payment_type_id, category_id, notes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                input.amount,
                input.occurred_at,
                input.description,
                input.sent_to,
                input.payment_type_id,
                input.category_id,
                input.notes,
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM transactions WHERE id = ?1", [id], Transaction::from_row)
    })
    .await
    .map(Json)
}

pub async fn update_transaction(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<TransactionInput>,
) -> AppResult<Json<Transaction>> {
    with_db(&state, move |conn| {
        let updated = conn.execute(
            "UPDATE transactions SET
                amount = ?1, occurred_at = ?2, description = ?3, sent_to = ?4,
                payment_type_id = ?5, category_id = ?6, notes = ?7, updated_at = datetime('now')
             WHERE id = ?8",
            rusqlite::params![
                input.amount,
                input.occurred_at,
                input.description,
                input.sent_to,
                input.payment_type_id,
                input.category_id,
                input.notes,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row("SELECT * FROM transactions WHERE id = ?1", [id], Transaction::from_row)
    })
    .await
    .map(Json)
}

pub async fn delete_transaction(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM transactions WHERE id = ?1", [id])
    })
    .await?;
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- scheduled transactions ------------------------------------------------

pub async fn list_scheduled(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<ScheduledTransaction>>> {
    with_db(&state, |conn| {
        let mut stmt =
            conn.prepare("SELECT * FROM scheduled_transactions ORDER BY active DESC, day_of_month")?;
        let rows = stmt.query_map([], ScheduledTransaction::from_row)?;
        rows.collect()
    })
    .await
    .map(Json)
}

pub async fn create_scheduled(
    State(state): State<AppState>,
    Json(input): Json<ScheduledTransactionInput>,
) -> AppResult<Json<ScheduledTransaction>> {
    let created = with_db(&state, move |conn| {
        conn.execute(
            "INSERT INTO scheduled_transactions (
                amount, description, sent_to, payment_type_id, category_id,
                day_of_month, start_date, end_date, active, notes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                input.amount,
                input.description,
                input.sent_to,
                input.payment_type_id,
                input.category_id,
                input.day_of_month,
                input.start_date,
                input.end_date,
                input.active as i64,
                input.notes,
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT * FROM scheduled_transactions WHERE id = ?1",
            [id],
            ScheduledTransaction::from_row,
        )
    })
    .await?;

    // A newly added schedule might already have due-but-unrecorded
    // occurrences (e.g. you're backfilling a subscription that's been
    // running for months) — catch those up immediately rather than waiting
    // for the next periodic check.
    let db = state.finance_db.clone();
    let _ = tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        schedule::catch_up(&conn)
    })
    .await;

    Ok(Json(created))
}

pub async fn update_scheduled(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<ScheduledTransactionInput>,
) -> AppResult<Json<ScheduledTransaction>> {
    with_db(&state, move |conn| {
        let updated = conn.execute(
            "UPDATE scheduled_transactions SET
                amount = ?1, description = ?2, sent_to = ?3, payment_type_id = ?4,
                category_id = ?5, day_of_month = ?6, start_date = ?7, end_date = ?8,
                active = ?9, notes = ?10
             WHERE id = ?11",
            rusqlite::params![
                input.amount,
                input.description,
                input.sent_to,
                input.payment_type_id,
                input.category_id,
                input.day_of_month,
                input.start_date,
                input.end_date,
                input.active as i64,
                input.notes,
                id,
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row(
            "SELECT * FROM scheduled_transactions WHERE id = ?1",
            [id],
            ScheduledTransaction::from_row,
        )
    })
    .await
    .map(Json)
}

pub async fn delete_scheduled(State(state): State<AppState>, Path(id): Path<i64>) -> AppResult<()> {
    let deleted = with_db(&state, move |conn| {
        conn.execute("DELETE FROM scheduled_transactions WHERE id = ?1", [id])
    })
    .await?;
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// --- summary -------------------------------------------------------------

/// The headline numbers: current capital (running balance of every
/// transaction to date) and how much of it you can spend today without
/// going below zero before the month is out.
pub async fn summary(State(state): State<AppState>) -> AppResult<Json<Summary>> {
    let now = Local::now();
    let today = now.date_naive();
    let now_str = now.format("%Y-%m-%d %H:%M").to_string();
    let month_start = format!("{:04}-{:02}-01 00:00", today.year(), today.month());
    let month_label = format!("{:04}-{:02}", today.year(), today.month());

    let days_in_month = {
        let (ny, nm) = if today.month() == 12 { (today.year() + 1, 1) } else { (today.year(), today.month() + 1) };
        let first_next = NaiveDate::from_ymd_opt(ny, nm, 1).expect("valid date");
        let first_this = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).expect("valid date");
        (first_next - first_this).num_days()
    };
    let days_left_in_month = days_in_month - today.day() as i64 + 1;

    let now_str_for_capital = now_str.clone();
    let month_start_for_income = month_start.clone();
    let now_str_for_income = now_str.clone();
    let month_start_for_spent = month_start.clone();
    let now_str_for_spent = now_str.clone();

    let capital = with_db(&state, move |conn| {
        conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE occurred_at <= ?1",
            [now_str_for_capital],
            |row| row.get::<_, f64>(0),
        )
    })
    .await?;

    let income_this_month = with_db(&state, move |conn| {
        conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions
             WHERE amount > 0 AND occurred_at >= ?1 AND occurred_at <= ?2",
            [month_start_for_income, now_str_for_income],
            |row| row.get::<_, f64>(0),
        )
    })
    .await?;

    let spent_this_month = with_db(&state, move |conn| {
        conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions
             WHERE amount < 0 AND occurred_at >= ?1 AND occurred_at <= ?2",
            [month_start_for_spent, now_str_for_spent],
            |row| row.get::<_, f64>(0),
        )
    })
    .await?;

    let daily_allowance = capital / days_left_in_month as f64;

    Ok(Json(Summary {
        as_of: now_str,
        capital,
        month_label,
        days_left_in_month,
        daily_allowance,
        income_this_month,
        spent_this_month: spent_this_month.abs(),
    }))
}
