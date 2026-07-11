use crate::config::Settings;
use std::sync::{Arc, Mutex};

/// State shared across the whole server and handed to every app module.
///
/// Cloning is cheap (it's just two `Arc` bumps) so it's fine to pass by
/// value into `Router::with_state`.
#[derive(Clone)]
pub struct AppState {
    pub settings: Arc<Settings>,
    /// Shared SQLite connection for the studies app. `std::sync::Mutex` is
    /// fine here (rather than an async-aware lock) because every query goes
    /// through `tokio::task::spawn_blocking` — see `apps/studies/db.rs`.
    pub studies_db: Arc<Mutex<rusqlite::Connection>>,
}

impl AppState {
    pub fn new(settings: Settings, studies_db: rusqlite::Connection) -> Self {
        Self {
            settings: Arc::new(settings),
            studies_db: Arc::new(Mutex::new(studies_db)),
        }
    }
}
