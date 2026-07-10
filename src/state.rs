use crate::config::Settings;
use std::sync::Arc;

/// State shared across the whole server and handed to every app module.
///
/// Cloning is cheap (it's just an `Arc` bump) so it's fine to pass by value
/// into `Router::with_state`.
#[derive(Clone)]
pub struct AppState {
    pub settings: Arc<Settings>,
}

impl AppState {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings: Arc::new(settings),
        }
    }
}
