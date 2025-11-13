# Playwright CRX Debugging Guide

## Quick Start

### 1. Build the Extension
```bash
npm ci
npm run build
```

### 2. Load Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `examples/todomvc-crx/dist` or `examples/recorder-crx/dist`

---

## Debugging Locations

### 🔧 Background Service Worker (Main Logic)
**Where:** Background scripts run the main extension logic

**How to access:**
1. Go to `chrome://extensions/`
2. Click the **"service worker"** link under your extension
3. DevTools opens showing the background script console

**What to debug:**
- Extension initialization
- Tab attachment/detachment
- Page navigation commands
- Playwright API calls

**Example breakpoints:**
```javascript
// In examples/todomvc-crx/src/background.ts
chrome.action.onClicked.addListener(async ({ id: tabId }) => {
  debugger; // ← Pause here
  const crxApp = await crx.start({ slowMo: 500 });
  const page = await crxApp.attach(tabId!);
});
```

---

### 🔍 Chrome Debugger Protocol (Transport Layer)

**File:** `src/server/transport/crxTransport.ts`

**How to debug:**
```javascript
// Add this to crxTransport.ts:68
async send(message: ProtocolRequest) {
  console.log('📤 Sending CDP command:', message.method, message.params);
  debugger; // Pause before sending

  // ... existing code
}

// Add this to crxTransport.ts:267
private _onDebuggerEvent = ({ tabId, sessionId }, message, params) => {
  console.log('📥 Received CDP event:', message, params);
  debugger; // Pause on incoming events

  // ... existing code
}
```

**What you'll see:**
- All Chrome DevTools Protocol (CDP) commands being sent
- Responses from the browser
- How commands are adapted for chrome.debugger API

---

### 🎬 Recorder/Player

**Files:**
- `src/server/recorder/crxRecorderApp.ts`
- `src/server/recorder/crxPlayer.ts`

**Debugging the recorder UI:**
1. Open the recorder (click extension icon or use `Alt+Shift+R`)
2. Right-click in the recorder window
3. Select "Inspect" to open DevTools for the recorder UI

**Debug recorded actions:**
```javascript
// In crxRecorderApp.ts
async open(options) {
  debugger; // Pause when recorder opens
  console.log('Recorder options:', options);
}
```

---

## Useful Console Commands

### In Background Service Worker Console:

```javascript
// Get the CRX instance
const crxInstance = await chrome.runtime.getBackgroundPage();

// Check attached tabs
chrome.debugger.getTargets((targets) => {
  console.log('Attached targets:', targets.filter(t => t.attached));
});

// List all tabs
chrome.tabs.query({}, (tabs) => {
  console.log('All tabs:', tabs);
});

// Monitor chrome.debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  console.log('Debugger event:', { source, method, params });
});
```

---

## Debugging Scenarios

### 🎯 Scenario 1: Understanding Tab Attachment

**Goal:** See how Playwright attaches to a browser tab

**Steps:**
1. Add breakpoints in:
   - `src/server/crx.ts:258` (CrxApplication.attach)
   - `src/server/transport/crxTransport.ts:169` (CrxTransport.attach)
   - `src/server/transport/crxTransport.ts:174` (chrome.debugger.attach)

2. Open service worker DevTools
3. Click extension icon on a tab
4. Follow execution:
   ```
   background.ts:24 → attach(tabId)
   ↓
   crx.ts:258 → CrxApplication.attach()
   ↓
   crxTransport.ts:169 → CrxTransport.attach()
   ↓
   crxTransport.ts:174 → chrome.debugger.attach()
   ↓
   crxTransport.ts:189 → emits Target.attachedToTarget
   ↓
   Browser creates Page object
   ```

### 🎯 Scenario 2: Tracing CDP Commands

**Goal:** See what CDP commands are sent when you call `page.goto()`

**Steps:**
1. Enable CDP logging:
   ```javascript
   // In background service worker console
   localStorage.debug = 'chromedebugger';
   ```

2. Reload the service worker (click reload icon in chrome://extensions)

3. Trigger an action:
   ```javascript
   const page = await crxApp.attach(tabId);
   await page.goto('https://example.com');
   ```

4. Check console output:
   ```
   chromedebugger SEND> Page.navigate #123
   chromedebugger <RECV Page.frameNavigated #123
   ```

### 🎯 Scenario 3: Debugging Unsupported Commands

**Goal:** See how unsupported CDP commands are handled

**File:** `src/server/transport/crxTransport.ts:82-153`

**Add logging:**
```javascript
async send(message: ProtocolRequest) {
  // Log all commands
  console.log('Command:', message.method);

  if (message.method === 'Target.setAutoAttach') {
    console.log('⚠️ Handling unsupported command:', message.method);
    debugger; // See how it's adapted
  }
}
```

### 🎯 Scenario 4: Understanding Message Flow

**Goal:** Follow a message from client API to CDP command

**Add breakpoints:**
1. `src/client/crx.ts:156` (Client API - attach call)
2. `src/server/dispatchers/crxDispatcher.ts` (Dispatcher)
3. `src/server/crx.ts:258` (Server implementation)
4. `src/server/transport/crxTransport.ts:68` (CDP transport)

**Trace execution:**
```
User code: crxApp.attach(123)
    ↓
Client (src/client/crx.ts:156)
    ↓
Channel message sent
    ↓
Dispatcher (server/dispatchers/)
    ↓
Server (src/server/crx.ts:258)
    ↓
Transport (src/server/transport/crxTransport.ts:169)
    ↓
chrome.debugger.attach()
```

---

## Advanced Debugging

### Monitor All Chrome Extension APIs

```javascript
// In background service worker console
const originalAttach = chrome.debugger.attach;
chrome.debugger.attach = function(...args) {
  console.trace('chrome.debugger.attach called with:', args);
  return originalAttach.apply(this, args);
};

const originalSendCommand = chrome.debugger.sendCommand;
chrome.debugger.sendCommand = function(debuggee, method, params) {
  console.log('CDP Command:', method, params);
  return originalSendCommand.apply(this, arguments);
};
```

### Inspect Memory File System

```javascript
// The extension uses memfs for file operations
import { crx } from 'playwright-crx';

// After tracing
await page.context().tracing.stop({ path: '/tmp/trace.zip' });

// Inspect in-memory files
console.log('Files:', crx.fs.readdirSync('/tmp'));
const data = crx.fs.readFileSync('/tmp/trace.zip');
console.log('Trace size:', data.length, 'bytes');
```

### Network Inspection

While Playwright CRX doesn't make HTTP requests (it uses chrome.debugger), you can monitor CDP network events:

```javascript
// Listen to Network.requestWillBeSent events
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method.startsWith('Network.')) {
    console.log('Network event:', method, params);
  }
});
```

---

## Common Issues & Solutions

### Issue: "Cannot access chrome:// URL"
**Cause:** Trying to attach debugger to restricted pages
**Solution:** Check `crxTransport.ts:250` - it catches this error

### Issue: "Debugger is already attached"
**Cause:** Tab already has debugger attached
**Debug:** Check `_tabToTarget` map in CrxTransport

### Issue: Service worker stops
**Cause:** Chrome stops inactive service workers after ~30s
**Solution:** Keep it active by checking the "Service worker" link in chrome://extensions
**Note:** This is normal behavior; it will restart when needed

---

## Recommended Debug Flow

1. **Start simple:** Load `todomvc-crx` example first
2. **Enable logging:** Set `localStorage.debug = 'chromedebugger'`
3. **Add console.logs:** Sprinkle throughout the code
4. **Use debugger statements:** Pause at key points
5. **Inspect objects:** Check `page`, `context`, `crxApp` objects
6. **Follow the flow:** Start from background.ts and trace through layers
7. **Monitor chrome.debugger:** Watch CDP commands in real-time

---

## Useful Chrome URLs

- `chrome://extensions/` - Manage extensions
- `chrome://inspect/#service-workers` - Inspect all service workers
- `chrome://serviceworker-internals/` - Service worker details
- `chrome://version/` - Chrome version info

---

## Files to Focus On

**Core architecture:**
- `src/index.ts` - Entry point, message routing
- `src/server/crx.ts` - Main CRX and CrxApplication classes
- `src/server/transport/crxTransport.ts` - CDP ↔ chrome.debugger bridge
- `src/client/crx.ts` - Client API you interact with

**Examples:**
- `examples/todomvc-crx/src/background.ts` - Simple usage example
- `examples/recorder-crx/src/background.ts` - Recorder implementation

**Utilities:**
- `src/shims/` - Node.js polyfills for browser
- `src/server/recorder/` - Recording and playback logic
