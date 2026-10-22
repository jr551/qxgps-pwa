# Android (Tauri v2)

The Android app is a **Tauri v2** shell around the same Vite/Preact PWA. Tauri
uses the system **WebView** (via WRY) plus a small Rust runtime — no Google Play
Services, Firebase, ads, or analytics SDKs.

**Application id:** `io.github.jr551.qxgps` — configured in
`src-tauri/tauri.conf.json` (`identifier`).

## Pinned toolchain (reproducible builds)

| Component | Version |
| --- | --- |
| Rust | **1.90.0** (`rust-toolchain.toml`) |
| `@tauri-apps/cli` | **2.12.2** |
| `tauri` / `tauri-build` (crate) | **2.12.3** / **2.7.2** (`src-tauri/Cargo.lock`) |
| Android NDK | **r27c** (`27.2.12479018`) |
| Android compile/target SDK | **34** (generated Gradle; Tauri may pull API 36 platform) |
| JDK | **17** (CI / F-Droid builders) |

## Version codes

`bundle.android.versionCode` in `tauri.conf.json` (currently **201** for app
version **0.2.1**). Keep monotonic for F-Droid / Play sideloading.

## Local build

```bash
npm ci
export ANDROID_HOME=...   # Android SDK
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
rustup target add aarch64-linux-android   # once per toolchain

npm run build:android          # unsigned universal release APK
npm run build:android:debug    # debug APK
```

Release APK (typical path):

`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

F-Droid signs release builds with the official fdroid key; local installs need
your own `apksigner` step.

## F-Droid notes

- **FOSS:** Tauri, WRY, and AndroidX dependencies are open source; the app
  contains **no proprietary blobs** in git — native code is compiled from
  `src-tauri/` during the build.
- **Anti-feature:** `NonFreeNet` (vendor tracker cloud at `*.gps666.net`).
- **Recipe:** `docs/fdroid/io.github.jr551.qxgps.yml`
- Generated Gradle project lives under `src-tauri/gen/android/` (committed).

## Why Tauri instead of a hand-rolled WebView?

Tauri meets F-Droid’s “build from source” requirement, stays FOSS, and ships the
Android APK release target alongside the static PWA. The hand-rolled WebView shell
was removed in favour of this maintained path.

## GitHub Actions

| Workflow | Trigger | Output |
| --- | --- | --- |
| `.github/workflows/tauri.yml` | Pull request | Unsigned release + debug APK artifacts |
| `.github/workflows/release.yml` | Tag `v*` | PWA zip + GitHub Pages deploy + draft Release with APK |

Pinned toolchains match this document (Rust **1.90.0**, NDK **27.2.12479018**, Node **22**, JDK **17**).

Optional release APK signing: repository variable `ANDROID_SIGN_APK=true` plus
secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

## Background monitoring

Native-only (not the browser PWA tab): Settings → **Background monitoring**. Uses
read-only `family.GetRunInfo` + `alarm.Get` on an interval you choose (default 5
minutes). Android shows a **foreground service** notification while enabled and
uses WorkManager for Doze-friendly backup polls. No FCM / Play Services.

| Android permission | Why |
| --- | --- |
| `INTERNET` | Vendor mapi HTTPS |
| `POST_NOTIFICATIONS` | Local alerts for alarms / link-state changes |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` | Persistent monitoring notification + scheduled sync |
| `WAKE_LOCK` | Retry polling after Doze (no continuous wake lock) |

The app does **not** request location, camera, microphone, or contacts.
