use chrono::{Datelike, Local, NaiveDate};
use rusqlite::Connection;

use super::model::ScheduledTransaction;

/// Checks every active scheduled transaction and inserts any ledger rows
/// that are due (their calendar date has arrived) but not yet recorded.
///
/// This is what makes recurring transactions independent of whether the Pi
/// was actually on when they were due: it's not driven by a timer firing at
/// the right moment, it just walks each schedule from its start date up to
/// today and backfills whatever's missing. Called once at startup and
/// periodically after that (see `main.rs`) — safe to call as often as you
/// like, since the `UNIQUE(scheduled_transaction_id, scheduled_period)`
/// constraint on `transactions` means a given month can never be booked
/// twice for the same schedule.
pub fn catch_up(conn: &Connection) -> anyhow::Result<usize> {
    let today = Local::now().date_naive();
    let mut inserted = 0;

    let mut stmt = conn.prepare("SELECT * FROM scheduled_transactions WHERE active = 1")?;
    let schedules: Vec<ScheduledTransaction> = stmt
        .query_map([], ScheduledTransaction::from_row)?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    for sched in schedules {
        let start = NaiveDate::parse_from_str(&sched.start_date, "%Y-%m-%d")?;
        let end = sched
            .end_date
            .as_deref()
            .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d"))
            .transpose()?;

        let mut year = start.year();
        let mut month = start.month();

        // Walk month by month from the schedule's start through the current
        // month. Bounded by the number of months elapsed since start_date,
        // so this always terminates.
        loop {
            if year > today.year() || (year == today.year() && month > today.month()) {
                break;
            }

            let occurrence_date = clamp_to_month(year, month, sched.day_of_month as u32);
            let in_range = occurrence_date >= start && end.map_or(true, |e| occurrence_date <= e);
            let due = occurrence_date <= today;

            if in_range && due {
                let period = format!("{year:04}-{month:02}");
                let occurred_at = format!("{} 00:00", occurrence_date.format("%Y-%m-%d"));

                let rows = conn.execute(
                    "INSERT OR IGNORE INTO transactions (
                        amount, occurred_at, description, sent_to, payment_type_id,
                        category_id, scheduled_transaction_id, scheduled_period
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        sched.amount,
                        occurred_at,
                        sched.description,
                        sched.sent_to,
                        sched.payment_type_id,
                        sched.category_id,
                        sched.id,
                        period,
                    ],
                )?;
                inserted += rows;
            }

            if month == 12 {
                month = 1;
                year += 1;
            } else {
                month += 1;
            }
        }
    }

    Ok(inserted)
}

/// Clamps `day` to the last valid day of the given year/month (e.g. day 31
/// in a 30-day month becomes that month's 30th; day 31 in February becomes
/// the 28th, or the 29th in a leap year).
fn clamp_to_month(year: i32, month: u32, day: u32) -> NaiveDate {
    let last_day = days_in_month(year, month);
    NaiveDate::from_ymd_opt(year, month, day.min(last_day)).expect("clamped day is always valid")
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_of_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid date");
    let first_of_this = NaiveDate::from_ymd_opt(year, month, 1).expect("valid date");
    (first_of_next - first_of_this).num_days() as u32
}
