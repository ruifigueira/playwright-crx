# TODO

## Completed

- [x] **Switch recorder default from side panel to floating popup window** (2026-06-29)
  - Side panel was covering ~half the browser viewport during recording.
  - Flipped `defaultSettings.sidepanel` from `true` to `false` in [settings.ts](examples/recorder-crx/src/settings.ts:27).
  - The recorder now opens via `chrome.windows.create({ type: 'popup' })` ([popupRecorderWindow.ts:58](src/server/recorder/popupRecorderWindow.ts:58)) as a separate, movable, resizable window outside the main browser.
  - No protocol/UI changes were needed — the popup path already existed; only the default was wrong.
  - Users who previously saved `sidepanel: true` in `chrome.storage.sync` keep their choice. They can switch back from the Preferences page (`Open in Side Panel` checkbox in [preferencesForm.tsx:86](examples/recorder-crx/src/preferencesForm.tsx:86)).

- [x] **Save recording to GraphX (dummy API)** (2026-06-29)
  - The recorder's download button now opens a "Save to GraphX" dialog instead of a local-file download.
  - Dialog asks: **Playwright server** (dropdown of available backends), **Username** + **Password** (auto-populated from cache), suite (existing dropdown loaded per server, or new), and a **Testcase name**.
  - Submit calls `graphx.saveScript({ serverId, username, password, suiteId | newSuiteName, testcaseName, code, language })`.
  - Dummy implementation in [graphx.ts](examples/recorder-crx/src/graphx.ts) — `listServers()` returns Local/Staging/Production; `listSuites(serverId)` returns a different list per server; `saveScript()` logs the resolved server URL, simulates a login, and returns a fake `scriptId`. Swap in real network calls when the backend is ready.
  - Form: [saveToGraphxForm.tsx](examples/recorder-crx/src/saveToGraphxForm.tsx). Wiring: [crxRecorder.tsx](examples/recorder-crx/src/crxRecorder.tsx) `handleDownload`.

- [x] **Wire GraphX module to real recorder bridge** (2026-06-29)
  - Endpoint: `POST https://test-automation.contineonx.com/api/recorder` (single URL; body shape selects operation).
  - Three body shapes documented in [instructions.md](projectDocs/instructions.md) → "GraphX wire protocol".
  - `host_permissions` added to [manifest.json](examples/recorder-crx/public/manifest.json) for the new origin (MV3 requirement for cross-origin fetch from the popup).
  - `GraphxSuite.id` is now `number` (was `string`); `SaveToGraphxResult.suiteId` and form state updated to match.
  - Server list in [graphx.ts](examples/recorder-crx/src/graphx.ts) updated to `Local` / `Dev` / `Production` with the implied URLs (Dev → `https://dev.graphx.world`).
  - `codePreview` field carries the full recorded script, despite the name (documented in the wire-protocol table).
  - Errors from the bridge surface as `Recorder API <status>: <body>` via the form's `loadError` slot for list-suites; save-script errors still get swallowed (tracked in Open).

- [x] **Group dialog into two boxes + gate suite fetch on credentials** (2026-06-29)
  - Server + Username + Password are wrapped in one `.form-group` div; Suite + Testcase name + Save button in another. Subtle gray border, rounded, light background — see [form.css](examples/recorder-crx/src/form.css).
  - `listSuites(serverId, { username, password })` now takes credentials. The form only calls it once all three (server, username, password) are present, debounced 500ms so each password keystroke doesn't fire a request.
  - When credentials are missing the suite area shows "Enter credentials above to load suites." instead of "Loading suites…".

- [x] **Per-server credential cache with WebCrypto encryption** (2026-06-29)
  - New module [credentials.ts](examples/recorder-crx/src/credentials.ts).
  - `loadCredentials(serverId)` / `storeCredentials(serverId, creds)` / `clearCredentials(serverId?)`. Backed by `chrome.storage.local` (the `storage` permission was already declared in [manifest.json](examples/recorder-crx/public/manifest.json)).
  - Password is encrypted with **AES-GCM** (256-bit). The key is derived via **PBKDF2** (100 000 iterations, SHA-256) from `chrome.runtime.id` plus a per-install random salt stored in `chrome.storage.local`.
  - **Security boundary** — this is obfuscation against passive disk inspection, NOT protection against code that can run inside the extension. Documented in the file header. Any future audit should treat the cached password as recoverable by anyone with extension-context code execution.
  - Username stays in the clear (only the password is encrypted), which makes a stale/decryption-failure recovery path cheap: if the salt is lost (e.g. reinstall), username is preserved and only password needs re-entry.

## Open

- [ ] **Surface `saveScript()` errors to the user.**
  - `handleDownload` in [crxRecorder.tsx](examples/recorder-crx/src/crxRecorder.tsx) currently swallows save failures in `.catch(() => {})`. The dialog closes silently if the bridge returns 401/500/etc.
  - Either keep the dialog open and render the error, or fall back to a toast/snackbar. The form already has a `loadError` slot — easiest is to expose a `saveError` from the `onSubmit` resolver.

- [ ] **Confirm the recorder-bridge response shape and tighten the parser.**
  - `graphx.ts` currently parses defensively (`data.suites ?? data.data ?? []`, `Number(data?.suiteId ?? ...)`). Once the server contract is locked, narrow the parser and drop the speculative fallbacks.

- [ ] (Optional) Let users manage their own `PlaywrightServer` list via Preferences.
  - Today the dropdown is hardcoded in [`graphx.ts`](examples/recorder-crx/src/graphx.ts). For self-hosted GraphX instances, surface an editor in [`preferencesForm.tsx`](examples/recorder-crx/src/preferencesForm.tsx) and persist through [`settings.ts`](examples/recorder-crx/src/settings.ts).

- [ ] (Optional) Add a third window mode: open the recorder in a regular browser tab.
  - Would require: new `TabRecorderWindow` class, extending the `'popup' | 'sidepanel'` enum in [channels.ts:181](src/protocol/channels.ts:181) and [channels.ts:191](src/protocol/channels.ts:191), updating [validator.ts:133](src/protocol/validator.ts:133), dispatching in [crxRecorderApp.ts:86](src/server/recorder/crxRecorderApp.ts:86), and a UI control in [preferencesForm.tsx](examples/recorder-crx/src/preferencesForm.tsx).

- [ ] (Optional) Keep local-file download as a secondary action.
  - The experimental `Save` button (Ctrl+S) still downloads locally via [`SaveCodeForm`](examples/recorder-crx/src/saveCodeForm.tsx). If users want both flows from the same icon, add a "Download as file" link inside the GraphX dialog.
