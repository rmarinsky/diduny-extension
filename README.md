# Diduny

Diduny is a self-hosted web workspace for voice dictation, translation, and a
local recording library. It requires a Diduny account to sign in to the
configured transcription provider.

Your recordings, transcripts, settings, and encrypted BFF sessions live under `DATA_DIR` (the default is the mounted `diduny-data` volume). Never remove the `diduny-data` volume if you want to keep the library. Nothing is sent to Diduny maintainers: the BFF only talks to the configured transcription/auth provider.

## Run locally

```sh
docker compose up --build
```

The container listens only on `127.0.0.1:3000`. `DATA_DIR`, `HOST`, `PORT`,
`DIDUNY_UPSTREAM_URL`, and `DIDUNY_LOG_LEVEL` are optional environment
variables. On first start the BFF creates an owner-only data directory and a
persistent session secret, then logs its absolute location and size.

## Browser extension

The Chrome extension is built in this same repository and release artifact:
`bun run build:extension` creates the unpacked extension, and `bun run zip`
creates a package. Load the unpacked build in Chrome and configure its local
BFF origin (default: `http://localhost:3000`). The extension signs in through
the BFF, keeps bearer tokens out of extension/page storage, sends completed
dictation to the backend, then delivers the returned text to the focused field.

## Verification

```sh
bun run validate
bun run build
npx playwright test
```

The Playwright suite uses fake capture devices and a local test backend; it
does not need a production account.
