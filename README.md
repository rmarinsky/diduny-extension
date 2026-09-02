# Diduny

Diduny is a self-hosted web workspace for voice dictation, translation, and a
local recording library. It requires a Diduny account to sign in to a real
configured transcription provider.

Your recordings, transcripts, settings, and encrypted BFF sessions live under `DATA_DIR` (the default is the mounted `diduny-data` volume). Never remove the `diduny-data` volume if you want to keep the library. Nothing is sent to Diduny maintainers: the BFF only talks to the configured transcription/auth provider.

## Run locally

```sh
docker compose up --build
```

The default Compose stack is an **offline local verification mock**: it starts
the mock proxy on port `3910`, accepts only the test OTP `123456`, and returns
`Mock transcript`. It does not authenticate a real Diduny account or contact a
hosted service. Set `DIDUNY_UPSTREAM_URL` to a real proxy endpoint when you
intend to use a real account. The BFF itself binds only to `127.0.0.1:3000`.
`DATA_DIR`, `HOST`, `PORT`, `DIDUNY_UPSTREAM_URL`, and `DIDUNY_LOG_LEVEL` are
optional environment variables. On first start the BFF creates an owner-only
data directory and a persistent session secret, then logs its absolute location
and size.

The BFF limits OTP requests to 10 per minute, transcription and realtime
requests to 20 per minute, and other BFF requests to 120 per minute per local
IP. These are guardrails against a runaway client loop, not a throughput quota.

## Browser extension

The Chrome extension is built in this same repository and release artifact:
`bun run build:extension` creates the unpacked extension, and `bun run zip`
creates a package. Load the unpacked build in Chrome and configure its local
BFF origin (default: `http://localhost:3000`). The extension signs in through
the BFF, keeps bearer tokens out of extension/page storage, sends completed
dictation to the backend, then delivers the returned text to the focused field.
The BFF accepts extension-session requests from this package's Chrome origin.
Chromium omits that `Origin` header for extension fetches, so the BFF also
accepts its browser-controlled originless Fetch Metadata combination. Set
`DIDUNY_EXTENSION_ORIGIN` only when deploying a separately signed package with
a different Chrome extension ID.

## Verification

```sh
bun run validate
bun run build
npx playwright test
```

The Playwright suite uses fake capture devices and a local test backend; it
does not need a production account.
