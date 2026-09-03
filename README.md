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

## Release an installable extension

```sh
bun run release:extension
```

This command runs the full validation suite, then launches Chromium through
Playwright with the built MV3 extension installed and active. Only after those
checks pass does it create `.output/diduny-extension-<version>-chrome.zip` for
the Chrome Web Store or a versioned GitHub release.

A merge into protected `main` triggers a release gate in GitHub Actions. The
workflow confirms that the exact commit is associated with a merged pull request
targeting `main`, but this check does not replace pull-request-only protection
on `main` with bypasses forbidden. A non-cancelling queue retains up to 100
pending merge runs and serializes their release work. If a backlog exceeds that
capacity, GitHub cancels the overflow run; after capacity returns, use **Re-run
all jobs** for that run. The merge must carry a package version that has not
been released before. After a green build and browser test, the workflow
reserves `extension-v<version>` at that exact commit and attaches the ZIP to the
corresponding GitHub Release. An already released version, a failed build, or a
failed browser test publishes nothing. Protect `extension-v*` tags from
force-updates and deletion: the workflow makes only a normal tag push and
refuses a tag that does not point to its verified commit.

For a local installation, open `chrome://extensions`, enable **Developer
mode**, choose **Load unpacked**, and select `.output/chrome-mv3`. End users
install the versioned package through the Chrome Web Store after it is
published; Chrome does not support drag-installing a ZIP on macOS or Windows.

## Verification

```sh
bun run validate
bun run build
npx playwright test
```

The Playwright suite uses fake capture devices and a local test backend; it
does not need a production account.
