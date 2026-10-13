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
| Service worker caches | App shell, icons, offline page, OpenStreetMap tiles | Offline use |

Passwords are stored only if you sign in successfully; they are **never** written
to this repository. Clearing site data or using **Log out** removes session and
stored credentials from the browser.

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
