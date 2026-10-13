# Changelog

All notable changes to this project are documented here.

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
