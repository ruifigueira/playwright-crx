# Project Instructions

## Recorder window mode

The Playwright recorder UI can render in one of two Chrome surfaces:

| Mode        | How it opens                                                              | When to use                                                              |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `popup`     | A separate Chrome window (`chrome.windows.create({ type: 'popup' })`)     | **Default.** Floats outside the main browser; movable and resizable.     |
| `sidepanel` | Chrome's built-in Side Panel (`chrome.sidePanel.setOptions / open`)       | Opt-in. Docked inside the browser window — convenient but takes ~half the viewport. |

### Changing the default

Edit `defaultSettings.sidepanel` in [`examples/recorder-crx/src/settings.ts`](examples/recorder-crx/src/settings.ts):

- `sidepanel: false` → recorder opens as a floating popup window (current default).
- `sidepanel: true` → recorder opens in the Chrome side panel.

The dispatch happens in [`crxRecorderApp.ts:86`](src/server/recorder/crxRecorderApp.ts:86):

```ts
this._window = options?.window?.type === 'sidepanel'
  ? new SidepanelRecorderWindow(options.window.url)
  : new PopupRecorderWindow(options?.window?.url);
```

and the type is passed in from [`background.ts:144`](examples/recorder-crx/src/background.ts:144):

```ts
window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
```

### User override

Each user's choice is persisted in `chrome.storage.sync` and merged on top of the defaults in [`loadSettings()`](examples/recorder-crx/src/settings.ts:32). To change at runtime, open the extension's **Preferences** page and toggle **Open in Side Panel**.

### Rebuilding the extension after changes

```powershell
cd examples/recorder-crx
npm run build
```

The unpacked extension is emitted to `examples/recorder-crx/dist/`. Reload it from `chrome://extensions` after each build.

## Saving recordings to GraphX

When the user finishes recording and clicks the **download** icon in the recorder toolbar, a "Save to GraphX" dialog opens. The dialog asks for:

The dialog is rendered as **two visually grouped sections** (`.form-group` boxes):

**Top group — Server + Credentials:**
1. **Playwright server** — dropdown of available backends (Local / Staging / Production in the dummy). Changing the server triggers a fresh `loadCredentials(serverId)` call so the username/password auto-populate for that server.
2. **Username** + **Password** — auto-populated from `chrome.storage.local` for the selected server. The user can change either before submitting; the new values are persisted on submit. Password is encrypted (see "Credential caching" below).

**Bottom group — Suite + Testcase + Save:**
3. **Suite** — `Existing` (dropdown populated by calling `listSuites(serverId, credentials)`) or `New` (text input for the new suite name).
4. **Testcase name** — free-form text used as the script title in GraphX (payload field: `testcaseName`).
5. **Save to GraphX** button — submits the form. Disabled until server + username + password + suite + testcase name are all valid.

### Suite loading depends on credentials

`listSuites(serverId, { username, password })` is only called when **all three** of server / username / password are non-empty. The call is debounced 500ms so typing the password doesn't fire one request per keystroke. When the credentials are missing, the suite area shows `Enter credentials above to load suites.` instead of the dropdown.

### Files involved

| File                                                                                       | Role                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`examples/recorder-crx/src/graphx.ts`](examples/recorder-crx/src/graphx.ts)               | Dummy API. `listSuites()` and `saveScript()`. Replace with real backend calls. |
| [`examples/recorder-crx/src/saveToGraphxForm.tsx`](examples/recorder-crx/src/saveToGraphxForm.tsx) | The form component. Loads suites on mount and validates input.            |
| [`examples/recorder-crx/src/crxRecorder.tsx`](examples/recorder-crx/src/crxRecorder.tsx) `handleDownload` | Wires the download icon to open the dialog and call `saveScript()`.   |
| [`examples/recorder-crx/src/form.css`](examples/recorder-crx/src/form.css)                 | Adds `.radio-row` and `.note` styles used by the form.                     |
| [`examples/recorder-crx/src/credentials.ts`](examples/recorder-crx/src/credentials.ts)     | Per-server username/password cache. AES-GCM password encryption.           |

### Credential caching

`credentials.ts` exposes three functions backed by `chrome.storage.local`:

```ts
loadCredentials(serverId)             // → { username, password }
storeCredentials(serverId, creds)     // persist
clearCredentials(serverId?)           // clear one server, or all
```

Storage layout (one record per server):

```jsonc
{
  "graphxCredentialsV1": {
    "local":      { "username": "alice", "passwordEnc": "<base64 ciphertext>" },
    "staging":    { "username": "alice", "passwordEnc": "<base64 ciphertext>" }
  },
  "graphxCredentialsSaltV1": "<base64 16-byte salt, generated once per install>"
}
```

Encryption:

- **AES-GCM 256-bit** with a random 12-byte IV per encryption.
- Key is derived via **PBKDF2** (100 000 iterations, SHA-256) from `chrome.runtime.id` plus the per-install salt above.
- The derived key is **not** persisted — it's recomputed in memory the first time `getEncryptionKey()` is called and then cached on the module.

**Security boundary** — this is hardened obfuscation, not real secret storage:

- A passive attacker who reads only the disk file CANNOT recover the password without also knowing the extension's `chrome.runtime.id`.
- Any code running inside this extension's context CAN call `loadCredentials()` and read the plaintext. There is no Chrome-extension API that provides true OS-keychain-backed secret storage today, so this is the best the platform allows without delegating to a native messaging host.
- If you need real secrecy (e.g. enterprise rollout), look at exchanging the password for a short-lived token on first login and discarding the password entirely.

The "extension reinstalled / salt lost" failure mode is handled gracefully: `loadCredentials()` returns the cleartext username with an empty password instead of throwing, so the user only re-enters the password.

### GraphX wire protocol

All operations go through a single endpoint:

```
POST https://test-automation.contineonx.com/api/recorder
Content-Type: application/json
```

The body shape determines what the bridge does. Three shapes are in use:

| Operation         | Body fields                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List suites       | `graphxUrl`, `username`, `password`                                                                                                                       |
| Save (existing)   | `graphxUrl`, `username`, `password`, `serverId`, `serverName`, `suiteId` (number), `testcaseName`, `language`, `codePreview`                              |
| Save (new suite)  | `graphxUrl`, `username`, `password`, `serverId`, `serverName`, `suiteName`, `testcaseName`, `language`, `codePreview`                                     |

Important wire-shape notes:

- **`suiteId` is a number** (e.g. `123`), not a string.
- **`suiteName` vs `newSuiteName`** — the form's internal state is `newSuiteName` for clarity, but the API expects `suiteName` for the new-suite case. The translation happens inside [`graphx.ts`](examples/recorder-crx/src/graphx.ts) `saveScript()`.
- **`codePreview` carries the full recorded script.** Despite the name, it is not a truncated preview — it is the entire code that the user is saving. Keep this in mind if you ever generate a true preview for the UI later.

### Network permissions

The popup makes a cross-origin `fetch` to `test-automation.contineonx.com`. Under MV3 this requires a matching entry in `host_permissions`:

```jsonc
// examples/recorder-crx/public/manifest.json
"host_permissions": ["https://test-automation.contineonx.com/*"]
```

If you ever move the bridge to a different origin, update this list and reload the extension.

### Server list (`PlaywrightServer`)

The dropdown content comes from a hardcoded list inside [`graphx.ts`](examples/recorder-crx/src/graphx.ts):

```ts
const SERVERS: PlaywrightServer[] = [
  { id: 'local',      name: 'Local',      url: 'http://localhost:3000' },
  { id: 'dev',        name: 'Dev',        url: 'https://dev.graphx.world' },
  { id: 'production', name: 'Production', url: 'https://graphx.world' },
];
```

`url` is sent to the recorder bridge as `graphxUrl`. To add or rename environments, edit this list — there is no remote endpoint that returns it. If you want users to manage their own list (e.g. self-hosted instances), expose this in [`preferencesForm.tsx`](examples/recorder-crx/src/preferencesForm.tsx) and persist via [`settings.ts`](examples/recorder-crx/src/settings.ts).

### Error handling

- `listSuites()` failures surface inline in the dialog (`loadError` state in [`saveToGraphxForm.tsx`](examples/recorder-crx/src/saveToGraphxForm.tsx)). HTTP non-2xx returns are wrapped as `Recorder API <status>: <body>`.
- `saveScript()` errors currently land in a silent `.catch(() => {})` in [`crxRecorder.tsx`](examples/recorder-crx/src/crxRecorder.tsx) `handleDownload`. Before production, surface the error to the user — e.g. keep the dialog open and render the message instead of dismissing.

### Logging

`callRecorder()` logs every request with the password redacted as `***`. Responses are JSON-parsed by the caller; failures (network, non-2xx, malformed JSON) all throw and bubble to the UI.

### Error handling notes

- `listSuites()` failures are caught and shown inline in the dialog (`Failed to load suites: …`).
- `saveScript()` failures currently land in a silent `.catch(() => {})` in [`crxRecorder.tsx`](examples/recorder-crx/src/crxRecorder.tsx) `handleDownload`. Before going to production, surface those errors — e.g., keep the dialog open and render the message instead of closing.

## Adding a new window mode (future work)

If you later want to add e.g. a "tab" mode (recorder opens in a regular browser tab), the changes span:

1. [`src/protocol/channels.ts`](src/protocol/channels.ts) — extend the `type?: 'popup' | 'sidepanel'` enum (two occurrences, lines 181 and 191).
2. [`src/protocol/validator.ts:133`](src/protocol/validator.ts:133) — add the new value to the `tEnum` list.
3. New file `src/server/recorder/tabRecorderWindow.ts` implementing the `RecorderWindow` interface from [`crxRecorderApp.ts:44`](src/server/recorder/crxRecorderApp.ts:44).
4. [`src/server/recorder/crxRecorderApp.ts:86`](src/server/recorder/crxRecorderApp.ts:86) — branch on the new type.
5. [`examples/recorder-crx/src/settings.ts`](examples/recorder-crx/src/settings.ts) — replace the boolean `sidepanel` field with a `windowMode: 'popup' | 'sidepanel' | 'tab'` field (with backwards-compat migration).
6. [`examples/recorder-crx/src/preferencesForm.tsx`](examples/recorder-crx/src/preferencesForm.tsx) — swap the checkbox for a `<select>` listing all three modes.
