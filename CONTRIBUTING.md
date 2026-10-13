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

### Android

```bash
npm run build:android
cd android && ./gradlew assembleRelease
```

See [android/README.md](android/README.md). Replace the placeholder application
id before publishing to F-Droid or GitHub Releases.

## Pull requests

1. Describe what changed and how you tested it.
2. Keep diffs focused; match existing TypeScript/Preact style.
3. Ensure CI passes (build, lint, tests, gitleaks).

## Issues

Use the issue templates when reporting bugs or suggesting features. For security
issues, see [SECURITY.md](SECURITY.md).
