pub mod files;

use crate::state::AppState;
use axum::Router;

/// Mounts every app module onto the given router, each under its own path
/// prefix.
///
/// ## Adding a new app later
///
/// 1. Create `src/apps/<name>/mod.rs` (copy `files/mod.rs` as a starting
///    point) with a `pub fn router(state: AppState) -> Router<AppState>`.
/// 2. Add `pub mod <name>;` above.
/// 3. Add one line below: `.nest("/api/<name>", <name>::router(state.clone()))`
/// 4. Optionally add a link to it from `static/index.html`.
///
/// That's the entire contract — each app owns its own routes, handlers and
/// storage layout, and doesn't need to know the others exist.
pub fn register(router: Router<AppState>, state: AppState) -> Router<AppState> {
    router.nest("/api/files", files::router(state.clone()))

    // Future apps get added the same way, e.g.:
    // .nest("/api/notes", notes::router(state.clone()))
    // .nest("/api/photos", photos::router(state.clone()))
}
