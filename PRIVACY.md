# Privacy

qxgps-pwa is a **client-side** progressive web app. It does not include analytics,
advertising SDKs, or a project-operated backend.

## Data stored on your device

| Storage | Contents | Purpose |
| --- | --- | --- |
| `localStorage` (`qxgps.session`) | Session id, family id, account label | Stay signed in across reloads |
| `localStorage` (`qxgps.credentials`) | Account email + password (plaintext) | Optional auto sign-in after reload |
| `localStorage` (`qxgps.selectedSimei`) | Selected device token | Remember map focus |
| `localStorage` (`qxgps.deviceNames`) | Friendly device labels | UI convenience |
| `localStorage` (`qxgps.rememberAccount`) | Remember-me flag + email | Login form |
| `localStorage` (`qxgps.backgroundMonitor`) | Native monitor toggle + interval | Tauri shell only |
| Native app data (`monitor-state.json`) | Last device snapshots + seen alarm ids | Native background monitor |
| Service worker caches | App shell, icons, offline page, OpenStreetMap tiles | Offline use |

Passwords are stored only if you sign in successfully; they are **never** written
to this repository. Clearing site data or using **Log out** removes session and
stored credentials from the browser.

## Native background monitoring (Android APK)

When you turn on **Background monitoring** in Settings (Tauri builds only):

- The app polls the vendor API on a timer using the same **read-only** calls as the
  Live screen: `family.GetRunInfo` (link state, last comms time, reported battery
  field) and `alarm.Get` (new alarms). It can show **local notifications** when
  link state changes, reported battery crosses a low threshold, or a new alarm
  appears. There is **no** Firebase, FCM, JPush, or Play Services push channel.
- **Android** runs a **foreground service** with a persistent notification while
  monitoring is enabled (required by Android for reliable background work) and may
  schedule infrequent **WorkManager** backup polls under Doze. Optional permissions:
  `POST_NOTIFICATIONS` (alert you locally), `FOGROUND_SERVICE*` / `WAKE_LOCK` (keep
  read-only polling scheduled — no location/GPS permission is requested; the phone’s
  GPS is not used).
- Credentials and session used for polling are stored **on device** (same login
  storage as the PWA plus the native monitor store). Disable monitoring or log out
  to stop background polls.

## Data that leaves your device

When you use the app while online:

- **Vendor cloud (`*.gps666.net`)** — login and read-only tracker API calls
  (positions, history, alarms, device metadata) using **your** account session.
- **OpenStreetMap tile servers** — map imagery for Live and History screens.
- **No other third-party endpoints** are called by the stock build.

The optional Node relay (`server/relay.mjs`) forwards the same vendor API traffic
when you self-host; it does not add logging or persistence beyond what Node's HTTP
server already exposes in your environment.

## Your responsibilities

Use this software only with hardware and accounts you are authorised to access.
Comply with applicable privacy and location-tracking laws (including consent
requirements). This project does not provide a service for tracking people without
their knowledge or consent.
