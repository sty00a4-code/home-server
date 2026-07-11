# home-server

A personal server for your Raspberry Pi 5, built with Rust and [Axum](https://github.com/tokio-rs/axum).
Right now it does one thing — serve and manage files over HTTP, with a small
built-in web UI — but it's structured so you can bolt on more "apps" (notes,
photos, a dashboard, whatever) later without restructuring anything.

Tested: builds and runs cleanly on both a fresh `cargo build` and `cargo build --release`,
with the file listing, download, upload, mkdir, delete, path-traversal guard, and
optional bearer-token auth all verified end-to-end.

## How it's structured

```
src/
  main.rs           # wires everything together, starts the server
  config.rs         # loads config/default.toml + env var overrides
  state.rs          # shared AppState handed to every app
  auth.rs           # optional bearer-token middleware
  error.rs          # one error type -> sensible HTTP responses
  apps/
    mod.rs          # <-- THE EXTENSION POINT, see below
    files/          # the file server app
      mod.rs        #   router + path-traversal guard
      handlers.rs   #   list / download / upload / mkdir / delete
      model.rs      #   JSON response shapes
static/              # the built-in web UI (vanilla HTML/CSS/JS, no build step)
config/default.toml  # default settings, safe to edit or override with env vars
deploy/home-server.service   # systemd unit to run it on boot
```

Each "app" is just a Rust module that exposes a `Router`. `apps/mod.rs` is a
small registry that nests each app's router under its own path prefix. The
files app doesn't know or care that anything else exists — that's what makes
adding the next app additive rather than a refactor.

### Adding a new app later

1. Copy `src/apps/files/` as a starting point, e.g. to `src/apps/notes/`.
2. Give it a `pub fn router(state: AppState) -> Router<AppState>`.
3. In `src/apps/mod.rs`, add `pub mod notes;` and one line:
   ```rust
   .nest("/api/notes", notes::router(state.clone()))
   ```
4. Optionally add a link/section for it in `static/index.html`.

That's the whole contract. Auth, tracing, CORS, and the upload size limit are
applied once in `main.rs` and cover every app automatically.

## Setting it up on the Pi 5

These steps assume Raspberry Pi OS (64-bit) — worth confirming you're on the
64-bit image, since Pi 5 supports it and it matters for Rust's performance.

### 1. Install Rust

Distro-packaged Rust (via `apt`) tends to lag — this project needs a
reasonably current toolchain, so use `rustup`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version   # should be 1.80+; anything recent is fine
```

### 2. Get the project onto the Pi

Copy the whole `home-server/` folder over, e.g.:

```bash
scp -r home-server pi@raspberrypi.local:~/home-server
```

or push it to a git repo and `git clone` it on the Pi — either works.

### 3. Build it

```bash
cd ~/home-server
cargo build --release
```

On a Pi 5 (4 cores) this typically takes a few minutes. If you're on the
4GB RAM model and the final linking step gets OOM-killed, either add some
swap or drop `lto = true` / `codegen-units = 1` in `Cargo.toml`'s
`[profile.release]` — they mainly help binary size/speed, not correctness.

> **Note on `indexmap = "=2.2.6"`:** this dependency is pinned in
> `Cargo.toml` to a version that builds on older Rust toolchains (some
> distro-packaged `rustc`s cap out around 1.75, which can't parse newer
> crates' manifests). If you're on rustup with a current stable release,
> you can safely remove that pin and let it float — it's not needed there.

### 4. Configure it

Edit `config/default.toml`:

```toml
[server]
host = "0.0.0.0"
port = 8080

[files]
root_dir = "./data"     # where your files actually live
max_upload_mb = 1024

[auth]
# token = "something-long-and-random"   # see "Security" below
```

Anything in there can also be overridden with an environment variable, e.g.
`HOME_SERVER__SERVER__PORT=9000` or `HOME_SERVER__AUTH__TOKEN=...` — handy
for keeping secrets out of the config file, especially in the systemd unit.

### 5. Run it

```bash
./target/release/home-server
```

Then visit `http://<pi-ip>:8080` from any device on your network. You
should see the file browser — drag files onto it to upload, click a folder
to open it, click a file to download it.

### 6. Run it on boot (systemd)

```bash
sudo cp deploy/home-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now home-server
sudo systemctl status home-server
journalctl -u home-server -f      # tail the logs
```

Edit the `User`, `WorkingDirectory`, and `ExecStart` lines in the unit file
first if your username or install path differ from `pi` /
`/home/pi/home-server`.

## Security notes

This is meant for your home network first and foremost:

- By default there's **no authentication** — anyone who can reach the Pi on
  your LAN can browse/upload/delete files. That's fine for a trusted home
  network, but set `auth.token` (see above) before you expose this any
  further, e.g. via port forwarding.
- If you do want remote access, prefer something like
  [Tailscale](https://tailscale.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  over forwarding a port on your router — both get you access without
  opening anything to the public internet directly.
- If you do expose it publicly, put a reverse proxy (Caddy or nginx) in
  front for TLS, and keep the auth token set.
- Uploads are capped at `files.max_upload_mb` (1GB by default) and every
  file path is checked against the configured `root_dir` before any read,
  write, or delete — traversal attempts (`../..`) are rejected.

## What's next

A few natural additions, all following the same "new folder under `apps/`"
pattern:

- **Auth beyond a single shared token** — e.g. per-user accounts if more
  than one person in your household will use this.
- **A dashboard app** at `/` that links out to whichever apps are
  installed, once there's more than one.
- **Thumbnails** for the files app, if you end up using it for photos.
- **HTTPS** via a reverse proxy (Caddy is the least fuss — automatic certs
  if you have a domain, or a self-signed cert for LAN-only use).
