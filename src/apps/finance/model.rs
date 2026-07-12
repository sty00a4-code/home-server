use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct PaymentType {
    pub id: i64,
    pub name: String,
}

impl PaymentType {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct NewPaymentType {
    pub name: String,
}

/// A category, optionally under a parent ("overarching") category. The
/// frontend builds the tree from the flat list — `parent_id: None` means a
/// top-level category.
#[derive(Debug, Serialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
}

impl Category {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            parent_id: row.get("parent_id")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
    pub parent_id: Option<i64>,
}

/// A single ledger entry — either entered by hand or generated from a
/// `ScheduledTransaction` template (in which case `scheduled_transaction_id`
/// and `scheduled_period` are set).
#[derive(Debug, Serialize)]
pub struct Transaction {
    pub id: i64,
    pub amount: f64,
    pub occurred_at: String,
    pub description: String,
    pub sent_to: Option<String>,
    pub payment_type_id: Option<i64>,
    pub category_id: Option<i64>,
    pub scheduled_transaction_id: Option<i64>,
    pub scheduled_period: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Transaction {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            amount: row.get("amount")?,
            occurred_at: row.get("occurred_at")?,
            description: row.get("description")?,
            sent_to: row.get("sent_to")?,
            payment_type_id: row.get("payment_type_id")?,
            category_id: row.get("category_id")?,
            scheduled_transaction_id: row.get("scheduled_transaction_id")?,
            scheduled_period: row.get("scheduled_period")?,
            notes: row.get("notes")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct TransactionInput {
    pub amount: f64,
    pub occurred_at: String,
    pub description: String,
    pub sent_to: Option<String>,
    pub payment_type_id: Option<i64>,
    pub category_id: Option<i64>,
    pub notes: Option<String>,
}

/// A recurring transaction template — the source of truth the catch-up
/// logic in `schedule.rs` reads from to backfill ledger rows.
#[derive(Debug, Serialize)]
pub struct ScheduledTransaction {
    pub id: i64,
    pub amount: f64,
    pub description: String,
    pub sent_to: Option<String>,
    pub payment_type_id: Option<i64>,
    pub category_id: Option<i64>,
    pub day_of_month: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    pub active: bool,
    pub notes: Option<String>,
}

impl ScheduledTransaction {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            amount: row.get("amount")?,
            description: row.get("description")?,
            sent_to: row.get("sent_to")?,
            payment_type_id: row.get("payment_type_id")?,
            category_id: row.get("category_id")?,
            day_of_month: row.get("day_of_month")?,
            start_date: row.get("start_date")?,
            end_date: row.get("end_date")?,
            active: row.get::<_, i64>("active")? != 0,
            notes: row.get("notes")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct ScheduledTransactionInput {
    pub amount: f64,
    pub description: String,
    pub sent_to: Option<String>,
    pub payment_type_id: Option<i64>,
    pub category_id: Option<i64>,
    pub day_of_month: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    pub notes: Option<String>,
}

fn default_true() -> bool {
    true
}

/// The headline numbers the whole app exists to answer: how much you have,
/// and how much of it you can spend today without going below zero before
/// the month is out.
#[derive(Debug, Serialize)]
pub struct Summary {
    pub as_of: String,
    pub capital: f64,
    pub month_label: String,
    pub days_left_in_month: i64,
    pub daily_allowance: f64,
    pub income_this_month: f64,
    pub spent_this_month: f64,
}
