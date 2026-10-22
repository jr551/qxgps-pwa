# Contributing

Thank you for helping improve qxgps-pwa.

## Ground rules

- **Read-only toward the vendor API** — only `user.Login` and `Get*` / `get*` /
  `Query*` style reads. Never add device commands, configuration writes, or
  alarm mark-read calls.
- **No secrets in git** — no real passwords, session tokens, device serials, or
  private hostnames. Use neutral sample data in fixtures and screenshots.
- **No vendor firmware or copied proprietary code** — interoperability notes only.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck
npm test
npm run lint
npm run build
```

Node 18+ (22 recommended). The production relay listens on `127.0.0.1:8787` by
default (`npm run relay` after `npm run build`).

### Android (Tauri v2)

```bash
npm ci
export ANDROID_HOME=...   # Android SDK
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
npm run build:android
```

See [docs/android-tauri.md](docs/android-tauri.md). The application id
(`io.github.jr551.qxgps`) lives in `src-tauri/tauri.conf.json`.

Optional CI APK signing: set repository variable `ANDROID_SIGN_APK=true` and secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD` (see the Tauri workflow).

## Pull requests

1. Describe what changed and how you tested it.
2. Keep diffs focused; match existing TypeScript/Preact style.
3. Ensure CI passes (build, lint, tests, gitleaks).

## Issues

Use the issue templates when reporting bugs or suggesting features. For security
issues, see [SECURITY.md](SECURITY.md).
