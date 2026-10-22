# Changelog

All notable changes to this project are documented here.

## [0.2.1] - 2026-10-22

### Fixed

- **Release blocker:** Android application id was still the placeholder
  `io.github.placeholder.qxgps` — now `io.github.jr551.qxgps` in
  `tauri.conf.json`, the generated Gradle/Kotlin sources (package dirs +
  `namespace`/`applicationId`), the Rust JNI linkage
  (`MonitorController` lookups and `QxgpsMonitorNative.pollOnce`), the F-Droid
  recipe (renamed to `io.github.jr551.qxgps.yml`, real `build:` step, real
  repository URLs) and the docs/fastlane metadata.
- **Session race:** while a login or silent re-login was in flight, other API
  calls sent no `?sid=` and were rejected as stale sessions — reads now keep
  the current session and only `user.Login` omits the sid.
- **Re-login retry replayed the old family token** — params for
  `GetFamilyList`/`GetExpireImei`/`GetRunInfo`/`GetDeviceList` are now
  re-evaluated after each login (family id rotates per login).
- Login no longer sends whitespace in the account field.
- `power: -1` (vendor "unknown" sentinel) no longer fires a false low-battery
  notification.
- Logging out or a session expiring now also clears the remembered device
  selection and friendly names, so a different account can't inherit them.
- First monitor poll no longer bursts notifications for pre-existing alarms
  on every device after the first.
- Bundled relay is reachable: `VITE_MAPI_URL=/mapi` builds the PWA against the
  same-origin endpoint served by `server/relay.mjs` (documented in README).
- Native monitor mapi calls now send the vendor app's `Dart/3.6 (dart:io)`
  user-agent instead of reqwest's default.

### Added

- Unit tests: mapi client wire contract (login params, `?sid=` placement,
  rotating family id, `alarm.Get` array simei, `QueryLocation` paging,
  read-only func allowlist), session cleanup, monitor power sentinel and
  first-pass alarm seeding.

### Changed

- `src-tauri/Cargo.toml` `repository` points at the real GitHub URL.
- `PRIVACY.md` lists the actual `localStorage` keys (`qxgps.account`).
- Comments that referenced research files absent from this repo now point at
  `docs/protocol-notes.md`.

## [0.2.0] - 2026-10-13

### Added

- Native **background monitor** (Android APK): read-only `GetRunInfo` + `alarm.Get`
  polling, local notifications, foreground service + WorkManager backup.
- Release workflow: PWA zip + GitHub Pages + Android APK on version tags (no desktop builds).
- Shared monitor diff logic in `src/lib/monitor-shared.ts` (PWA tab alerts + native).
- Android app via **Tauri v2** (FOSS Rust/WebView shell) for F-Droid and CI APK builds.
- fastlane `en-US` metadata and draft `docs/fdroid/io.github.placeholder.qxgps.yml`.
- Public open-source release packaging (MIT licence, CI, secret scanning).
- History track calendar via `location.QueryTrackDate` (per-day mileage chips).
- Unit tests for MD5, geo helpers, track normalisation, and API parsers.
- `docs/protocol-notes.md` — sanitised interoperability summary.
- `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, issue/PR templates.

### Changed

- README rewritten for GitHub with disclaimers and dual deployment (direct HTTPS
  mapi vs optional relay).
- Scrubbed local filesystem paths and private research artefacts from the tree.

### Notes

- Geofence list item wire shape remains unverified when no fences are configured.
