# Test metrics: web app and Chrome extension

Snapshot of 2026-10-02.

## Suites

| Suite | Command | Tests | Last result | Runs in CI |
|---|---|---|---|---|
| Unit (bun) | `bun run test` | 283 | 279 pass, 4 fail (Windows-only file mode and path checks, failing before this work) | yes |
| E2E, scripted test cases | `bun run test:e2e:extension` (`--project=e2e`) | 102 | 102 pass, about 11 min | yes |
| E2E, exploratory charters | `bun run test:e2e:charters` | 53 | 53 pass, about 11 min | no |
| E2E, real OS input | `bun run test:e2e:os` (Windows; takes keyboard and mouse focus) | 11 | 11 pass, about 2 min | no |

The scripted e2e tests cover the 44 web test cases (`e2e/web-workspace-*.spec.ts`) and the 37 extension test cases (`e2e/extension-*.spec.ts`) from the two QA runs, whose plans are kept locally rather than in git. The rest are earlier specs plus the meeting-recording spec.

- **Charters** (`e2e/charters/`): the QA runs' exploratory charters, as seeded walks and boundary matrices checked against invariants. `CHARTER_SEEDS=4,5,6` and `CHARTER_STEPS=40` run other or longer walks; a failure prints its replay line.
- **OS input** (`e2e/os-input/`): real key presses and clicks on Chrome's own UI, through `e2e/support/os-input/os-input.ps1`. These are the extension shortcuts, the toolbar button, and Chrome's microphone prompt for the extension and the web app. The specs skip on systems other than Windows.

## Test results

Final runs on 2026-10-02 on Windows 11 with Chromium 151 (Playwright 1.62), after commits `abf0da8` (fixes) and `f73ac32` (tests). Everything passed except the 4 known Windows-only unit tests.

| Run | Passed | Failed | Time |
|---|---|---|---|
| Unit tests (`bun test ./tests ./lib ./web/src`) | 279 / 283 | 4 (Windows-only, failing before this work) | about 5 s |
| Typecheck (`tsc --noEmit`) | clean | — | — |
| Lint (Biome, changed files) | clean | — | — |
| E2E project `e2e` | 102 / 102 | 0 | 10.9 min |
| E2E project `charters` | 53 / 53 | 0 | 11.0 min |
| E2E project `os-input` | 11 / 11 | 0 | 1.7 min |

### What the e2e runs contain

**`e2e` project (102):**
- 60 web tests: 44 web test cases and 16 earlier web specs.
- 42 extension tests: 37 extension test cases, 2 earlier extension specs, and 3 meeting recordings that Chrome allows.

**`charters` project (53):**

| Charter | Web | Extension |
|---|---|---|
| AC1 | 3 walks (dictation triggers) | 3 walks (sign-in state) |
| AC2 | 5 (document boundaries, typing while transcribing) | 3 walks (recording and Transcript) |
| AC3 | 10 (cancel methods × timing) | 3 (field kinds and carets, other-origin frames, fields changing mid-recording) |
| AC4 | 4 (27 paste sizes, 3 swap walks) | 1 (every mode, language pair and trigger) |
| AC5 | 16 (confirmations × answers, Clear and undo) | 5 (BFF origin table, Sites table, 3 theme walks) |

**`os-input` project (11):**
- 4 tests with real extension shortcuts.
- 4 with Chrome's real microphone prompt for the extension.
- 3 with Chrome's real microphone prompt for the web app.

### Bugs found while automating

| Bug | Found by | Status |
|---|---|---|
| E21: the toolbar click opened the panel without granting tab capture, so Meeting could never record from it | meeting automation spike, confirmed with a real mouse click | fixed |
| E22: a meeting started by shortcut did not show in the open panel | meeting spec (TC-37) | fixed |
| E23: about 40 s into a session, one dictation's realtime connection is refused | charter AC3 | open |
| E24: a field disabled or made read-only during a recording failed silently | charter AC3 | fixed |
| E25: an expired session showed the raw code "authentication_failed" | charter AC1 | fixed |

## Coverage (rough estimate)

These are estimates from comparing what each screen offers with what the tests drive, not measured coverage.

| Part | Flows the tests drive | Code exercised (rough) | Main gaps |
|---|---|---|---|
| Web app | ~85–90% | ~75–80% | rare upstream answers, long-recording chunking, some library detail views |
| Side panel | ~90% | ~80–85% | the Logs view and its Clear; the meeting view's Clear confirmation |
| Extension Settings page | ~95% | ~90% | — |
| Microphone permission page | ~90% | ~85% | "No microphone found" |
| Background and offscreen | ~80% | ~75% | recovery after the service worker restarts, keepalive, some error branches |

Overall, about 85–90% of what a user can do is automated, and roughly three quarters or more of the code runs under tests. The remaining gaps are mostly rare error paths and a few small panels, plus the real backend.

## Not automated

- **The real backend.** Every test runs against the mock proxy (`src/mock-proxy.ts`), so real speech recognition, translation, sign-in and the quality of the results are not tested. The audio comes from Chromium's fake microphone.
- **A live translation result.** The mock never finishes a translation session, so translation text always comes from the upload fallback, never from realtime.
- **Real shortcuts and Chrome's real prompt outside Windows.** The OS-input suite runs on demand on Windows only; the Linux CI job skips it.
- **The docked side panel itself.** Tests open the real side panel, but they drive a copy of it in a tab.
- **"No microphone found" on real hardware.** It needs Chromium without its fake microphone.
- **Other browsers.** Only Chromium is tested, not Chrome stable, Edge or Firefox.
- **Exploration itself.** The charters run 3 seeded walks of 15 steps by default; human exploratory testing still finds what they cannot.

## Open bug

- **Realtime connection refused now and then.** About 40 seconds into a session, one dictation's realtime connection is occasionally refused by the BFF relay. The text still arrives, about 20 seconds late and without live text. The cause is not confirmed; a lead is the relay's one-socket-per-session rule in `src/server/realtime-relay.ts`.
