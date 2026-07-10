use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

/// If `auth.token` is configured, require `Authorization: Bearer <token>` on
/// every request. If it isn't configured, this is a no-op — handy for first
/// getting things running on a trusted LAN, before you bother with auth.
pub async fn require_token(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let Some(expected) = &state.settings.auth.token else {
        return Ok(next.run(req).await);
    };

    let provided = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match provided {
        Some(token) if token == expected => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
