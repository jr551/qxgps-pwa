# Android shell (F-Droid oriented)

Minimal **WebView** wrapper around the bundled PWA. Dependencies are AndroidX
only (Apache 2.0) — no Google Play Services, Firebase, ads, or analytics.

## Application ID

Default: `io.github.placeholder.qxgps` — **change before publishing** to your
real id (e.g. `io.github.yourorg.qxgps`) in:

- `app/build.gradle.kts` (`namespace`, `applicationId`)
- `app/src/main/java/io/github/placeholder/qxgps/` (move/rename package)
- `docs/fdroid/*.yml` filename and metadata

## Version scheme

`android/version.properties` (keep in sync with `package.json`):

| versionName | versionCode formula | Example |
| --- | --- | --- |
| MAJOR.MINOR.PATCH | `MAJOR*10000 + MINOR*100 + PATCH` | 0.2.0 → **200** |

F-Droid `versionCode` must monotonically increase each release.

## Build from source

Requirements: Node 18+, JDK 17+, Android SDK 35 (build-tools + platform).

```bash
# From repository root
npm ci
npm run build:android          # VITE_PLATFORM=android vite build + copy dist → assets/www
cd android
./gradlew assembleRelease      # unsigned release APK (F-Droid re-signs)
```

Unsigned APK: `app/build/outputs/apk/release/app-release-unsigned.apk`

For local install, sign with your own debug/release key (`apksigner`).

## Asset URL

The WebView loads `https://appassets.androidplatform.net/public/index.html` via
`WebViewAssetLoader` (bundled files under `assets/public/`). Vendor API calls use
`fetch()` to `https://www.gps666.net/mapi` over the network.

## fastlane / F-Droid

- Store listing text: `fastlane/metadata/android/en-US/`
- Draft recipe: `docs/fdroid/io.github.placeholder.qxgps.yml`
