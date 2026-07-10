# GPT Work++

<p align="center">
  <img src="docs/images/codex-plus-plus.png" alt="GPT Work++ icon" width="160">
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/github/v/release/BigPizzaV3/CodexPlusPlus">
  <img alt="Stars" src="https://img.shields.io/github/stars/BigPizzaV3/CodexPlusPlus">
  <img alt="License" src="https://img.shields.io/github/license/BigPizzaV3/CodexPlusPlus">
  <img alt="Rust" src="https://img.shields.io/badge/rust-1.85%2B-orange">
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-2.x-24C8DB">
</p>

GPT Work++ is an external enhancement launcher and manager for the GPT Work. It does not modify the original GPT Work installation. Instead, it starts GPT Work externally and injects enhancements through the Chromium DevTools Protocol.

## Quick Start

Download the latest installer from [GitHub Releases](https://github.com/BigPizzaV3/CodexPlusPlus/releases):

- Windows: `CodexPlusPlus-*-windows-x64-setup.exe`
- macOS Intel: `CodexPlusPlus-*-macos-x64.dmg`
- macOS Apple Silicon: `CodexPlusPlus-*-macos-arm64.dmg`

After installation, two entry points are available:

- `GPT Work++`: a silent launcher. It does not show the manager UI and only starts GPT Work with GPT Work++ injection.
- `GPT Work++ Manager`: a Tauri control panel for launch, diagnostics, repair, updates, relay injection, enhancements, and user scripts.

The Windows installer creates desktop and Start Menu shortcuts. The macOS DMG installs `/Applications/GPT Work++.app` and `/Applications/GPT Work++ 管理工具.app`.

## Highlights

- Rust backend and silent launcher with no extra runtime requirement.
- Tauri + React manager with dark/light theme support.
- External CDP injection. No `app.asar` patching and no DLL writes into the GPT Work installation.
- Relay injection mode with multiple relay profiles, `CodexPlusPlus` provider configuration, and a one-click switch back to official ChatGPT login mode.
- Traditional enhancement mode with plugin marketplace unlock, session delete, Markdown export, project move, and more.
- Paste fix: when pasting from Word or other rich-text sources into the GPT Work composer, only keep the plain text so GPT Work does not treat the clipboard content as an image or file attachment. Off by default; requires a GPT Work relaunch to take effect.
  - **Usage note**: after toggling in the manager, click the "保存增强设置" / "Save enhancement settings" button to persist, then restart GPT Work++ for the change to take effect.
- Independent user script management with startup injection.
- Provider Sync to keep historical sessions visible after switching providers.
- Zed open entry detects remote SSH context and opens the matching remote file in Zed Remote Development from GPT Work.
- Per-model context window configuration: the "Model list" is split into two columns, model name on the left and context window (e.g. `1M`, `200K`, or `1000000`) on the right. GPT Work++ auto-generates `model_catalog_json` and injects it into `config.toml`; the matching window is applied when you switch models. Leave the window empty to use GPT Work's default length.
- Upstream worktree creation: create new worktrees from `upstream/<base-branch>` after fetching the remote branch, reducing conflicts caused by stale local HEAD state.
- Windows single instance, no console window, administrator manifest, and system Desktop path detection.
- Separate macOS x64 and arm64 DMGs. The silent launcher hides its Dock icon.

## Relay Injection

Relay injection is for users who are already logged in with an official ChatGPT account in Codex/ChatGPT and want model requests to go through a custom compatible API.

The boundary of this hybrid mode is:

- The official ChatGPT/GPT Work login state still owns GPT Work account features and the plugin entry.
- The relay profile only controls the Base URL, key, and model names used for model requests.
- The compatible API provider is not tied to any specific vendor; it only needs to match the selected upstream protocol and GPT Work configuration.
- Clearing API mode should return GPT Work to the official login mode so the official account and plugins keep working.

Before applying relay injection, run a minimal preflight:

1. Make sure GPT Work has detected the ChatGPT login state and the plugin entry is available.
2. Confirm the custom Base URL is reachable and supports the selected upstream protocol, such as a Responses-compatible endpoint.
3. Test the target key with the smallest useful auth probe, such as a model-list request or a short message request.
4. Only record whether the key exists and whether auth passed. Do not paste real keys into logs, screenshots, or issues.
5. Make sure `~/.codex/config.toml` has a backup so clearing API mode can safely roll back.

In the manager's Relay Injection page:

1. Make sure ChatGPT login status is detected.
2. Add one or more relay profiles with Base URL and Key.
3. Select the active profile and apply relay injection.
4. Launch `GPT Work++`.

GPT Work++ writes configuration similar to this into `~/.codex/config.toml`:

```toml
model_provider = "CodexPlusPlus"

[model_providers.CodexPlusPlus]
name = "CodexPlusPlus"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://example.com/v1"
experimental_bearer_token = "sk-..."
```

To return to the official login mode, use the clear API mode button in the Relay Injection page. This removes `OPENAI_API_KEY` related configuration and switches GPT Work back to official ChatGPT authentication.

## Enhancements

Enhancements are controlled in the manager. Enhancement injection is enabled by default. When disabled, GPT Work++ will not inject its menu or scripts.

When relay injection mode is active, plugin marketplace unlock is unnecessary, and the UI will say so. Other enhancements, including session delete, export, move, paste fix, recommendations, and user scripts, can still be used.

## Packages

GPT Work++ publishes Windows NSIS installers and macOS DMGs (Intel x64 / Apple Silicon arm64).

## Data Locations

- GPT Work config: `~/.codex/config.toml`
- GPT Work auth state: `~/.codex/auth.json`
- GPT Work local database: prefers `~/.codex/sqlite/*.db`, falls back to legacy `~/.codex/state_5.sqlite`
- GPT Work++ state and logs: `~/.codex-session-delete/`
- Provider Sync backups: `~/.codex/backups_state/provider-sync`

## FAQ

### The GPT Work++ menu does not appear

Make sure GPT Work was launched from the `GPT Work++` entry instead of the original GPT Work entry. You can also inspect the Diagnostics and Logs pages in the manager.

### The plugin says the backend is disconnected

First test the helper endpoint:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:57321/backend/status -Body "{}" -ContentType "application/json"
```

If the endpoint works but the plugin still times out, it is usually a GPT Work page CDP bridge or script cache issue. Restart GPT Work++, or check manager logs for `renderer.script_loaded`, `bridge.request`, and `bridge.response`.

### How is Upstream worktree different from GPT Work native creation?

GPT Work++ updates the remote branch first, then creates the worktree as if you ran:

```bash
git worktree add -b <new-branch> <worktree-path> upstream/<base-branch>
```

The new worktree starts from the fresh remote tracking branch instead of the local HEAD used by the current session. If GPT Work++ cannot safely recognize the current GPT Work version's native worktree form, use the GPT Work++ menu entry and enter the repository path, branch name, worktree path, remote, and base branch manually.

### macOS says the app cannot be opened or is damaged

Unsigned and unnotarized builds may be blocked by Gatekeeper. Allow the app in System Settings -> Privacy & Security. For formal distribution, configure Apple Developer ID signing and notarization.

### Does it support Intel Macs?

Yes. Releases provide both `macos-x64.dmg` and `macos-arm64.dmg`. Intel Macs should use the x64 package, while Apple Silicon Macs should use the arm64 package.

## Development

```bash
# Frontend checks
cd apps/codex-plus-manager
npm install
npm run check
npm run vite:build

# Rust checks
cd ../..
cargo fmt --check
cargo test
cargo build --release
```

Project structure:

```text
apps/
  codex-plus-launcher/          Silent launcher
  codex-plus-manager/           Tauri manager
assets/inject/
  renderer-inject.js            Enhancement script injected into GPT Work
crates/
  codex-plus-core/              Launch, injection, config, update, install, bridge
  codex-plus-data/              Session data, export, Provider Sync
scripts/installer/
  windows/CodexPlusPlus.nsi     Windows NSIS installer
  macos/package-dmg.sh          macOS DMG packager
```

## Notes

GPT Work++ is an external enhancement tool and does not modify original GPT Work files. If a future GPT Work update changes page structure, the injection script may need updates.
