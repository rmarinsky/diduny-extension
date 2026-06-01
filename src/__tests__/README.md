# Extension Unit/Integration Tests

Current session keeps extension Playwright E2E on hold.

Structure:

- `src/__tests__/` — future Vitest/Jest unit and integration tests for library code
- `src/e2e/` — reserved for future Playwright E2E scenarios (to be implemented when MVP flows are ready)

Keep tests explicit about environment and do not run live remote services by default.
