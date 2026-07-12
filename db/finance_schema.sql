-- Schema for the "finance" app — a manual transaction ledger with
-- hierarchical categories and recurring (scheduled) transactions.
--
-- This file is safe to run more than once (CREATE TABLE IF NOT EXISTS
-- throughout) — the server runs it on every startup, same as the studies
-- schema.

PRAGMA foreign_keys = ON;

-- How a transaction was paid, e.g. Bar, Karte, Überweisung, Lastschrift.
-- Free-form via the API (you can add your own), not a fixed enum, since
-- everyone's mix of payment methods differs.
CREATE TABLE IF NOT EXISTS payment_types (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Hierarchical categories — a category can have a parent (its "overarching"
-- category), e.g. "Lebensmittel" under "Fixkosten", or NULL for a
-- top-level category.
CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    UNIQUE (name, parent_id)
);

-- Recurring transactions — monthly income, subscriptions, rent, etc. These
-- are templates: the actual ledger rows get generated from them (see
-- `transactions.scheduled_transaction_id` below) by the catch-up logic in
-- apps/finance/schedule.rs, which runs on every startup and periodically
-- while the server is up. That's what makes this independent of whether
-- the Pi was off — nothing depends on a tick happening at the exact right
-- moment, it just backfills whatever's due and hasn't been recorded yet.
CREATE TABLE IF NOT EXISTS scheduled_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    amount           REAL NOT NULL,             -- positive = income, negative = expense
    description      TEXT NOT NULL,
    sent_to          TEXT,
    payment_type_id  INTEGER REFERENCES payment_types(id) ON DELETE SET NULL,
    category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    day_of_month     INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
                         -- if a month is shorter than this, it's clamped to
                         -- that month's actual last day (e.g. 31 -> Feb 28/29)
    start_date       TEXT NOT NULL,              -- ISO date: first month this applies to
    end_date         TEXT,                       -- ISO date, inclusive; NULL = indefinite
    active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    notes            TEXT
);

-- The actual ledger. Rows come from two places: manually entered via the
-- API/UI, or auto-generated from a scheduled_transactions template — those
-- carry scheduled_transaction_id + scheduled_period ('YYYY-MM') so the
-- catch-up logic can tell what's already been recorded and never
-- double-books a given month for a given schedule.
CREATE TABLE IF NOT EXISTS transactions (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    amount                    REAL NOT NULL,     -- positive = in, negative = out
    occurred_at               TEXT NOT NULL,     -- ISO datetime 'YYYY-MM-DD HH:MM'
    description               TEXT NOT NULL,
    sent_to                   TEXT,
    payment_type_id           INTEGER REFERENCES payment_types(id) ON DELETE SET NULL,
    category_id               INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    scheduled_transaction_id  INTEGER REFERENCES scheduled_transactions(id) ON DELETE SET NULL,
    scheduled_period          TEXT,              -- 'YYYY-MM', only set on auto-generated rows
    notes                     TEXT,
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (scheduled_transaction_id, scheduled_period)
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_active ON scheduled_transactions(active);
