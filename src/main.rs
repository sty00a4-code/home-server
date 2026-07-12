mod apps;
mod auth;
mod config;
mod error;
mod state;

use axum::{extract::DefaultBodyLimit, middleware, Router};
use state::AppState;
use std::net::SocketAddr;
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let settings = config::Settings::load()?;
    tracing::info!(
        host = %settings.server.host,
        port = settings.server.port,
        root_dir = %settings.files.root_dir.display(),
        "starting home-server"
    );

    // Make sure the data root exists before anything tries to use it.
    tokio::fs::create_dir_all(&settings.files.root_dir).await?;

    let studies_db = apps::studies::open_and_migrate(&settings.studies.db_path)?;
    tracing::info!(db_path = %settings.studies.db_path.display(), "studies database ready");

    let max_upload_bytes = (settings.files.max_upload_mb * 1024 * 1024) as usize;
    let state = AppState::new(settings, studies_db);

    // All API apps get mounted here — see apps/mod.rs for how to add more.
    let api_router = apps::register(Router::new(), state.clone())
        .layer(DefaultBodyLimit::max(max_upload_bytes))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_token,
        ));

    let app = Router::new()
        .merge(api_router)
        // Each app with a web UI gets its own folder under static/; the
        // dashboard at "/" (static/index.html) links out to them. One
        // fallback_service handles all of static/, so every app's paths
        // behave consistently (including the trailing-slash redirect).
        .fallback_service(ServeDir::new("static"))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let addr: SocketAddr = format!("{}:{}", state.settings.server.host, state.settings.server.port)
        .parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received, shutting down gracefully");
}
