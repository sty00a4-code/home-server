use serde::Deserialize;
use std::path::PathBuf;

/// Server-wide configuration.
///
/// Loaded, in order of increasing priority, from:
///   1. Built-in defaults (below)
///   2. `config/default.toml` next to the binary (if present)
///   3. Environment variables prefixed `HOME_SERVER__`, using `__` as the
///      nesting separator, e.g. `HOME_SERVER__SERVER__PORT=9000`
#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub server: ServerSettings,
    pub files: FilesSettings,
    pub auth: AuthSettings,
    pub studies: StudiesSettings,
    pub finance: FinanceSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSettings {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FilesSettings {
    /// Root directory that the file app is allowed to read/write.
    /// Everything is resolved relative to this and path traversal outside
    /// of it is rejected.
    pub root_dir: PathBuf,
    /// Max upload size in megabytes.
    pub max_upload_mb: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSettings {
    /// If set, every request must include `Authorization: Bearer <token>`.
    /// Leave unset while you're only exposing this on your trusted LAN.
    pub token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StudiesSettings {
    /// Path to the SQLite database file for the studies/progress tracker.
    pub db_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FinanceSettings {
    /// Path to the SQLite database file for the finance/money tracker.
    pub db_path: PathBuf,
    /// How often (in hours) the server checks for due-but-not-yet-recorded
    /// scheduled transactions while it's running. This is on top of the
    /// check that always happens once at startup.
    pub schedule_check_interval_hours: u64,
}

impl Settings {
    pub fn load() -> anyhow::Result<Self> {
        let cfg = config::Config::builder()
            .set_default("server.host", "0.0.0.0")?
            .set_default("server.port", 8080)?
            .set_default("files.root_dir", "./data")?
            .set_default("files.max_upload_mb", 512000)?
            .set_default::<_, Option<String>>("auth.token", None)?
            .set_default("studies.db_path", "./data/studies.db")?
            .set_default("finance.db_path", "./data/finance.db")?
            .set_default("finance.schedule_check_interval_hours", 6)?
            // Optional file, entirely fine if it doesn't exist.
            .add_source(config::File::with_name("config/default.toml").required(true))
            // Env vars win over everything, e.g.:
            //   HOME_SERVER__SERVER__PORT=9000
            //   HOME_SERVER__AUTH__TOKEN=supersecret
            .add_source(
                config::Environment::with_prefix("HOME_SERVER")
                    .separator("__")
                    .try_parsing(true),
            )
            .build()?;

        Ok(cfg.try_deserialize()?)
    }
}
