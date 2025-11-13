# CRX Transport - Complete Explanation

## What is CrxTransport?

**CrxTransport** is the **bridge** between Playwright's Chrome DevTools Protocol (CDP) commands and Chrome's `chrome.debugger` API.

**File:** `src/server/transport/crxTransport.ts`

### The Problem It Solves

**Normal Playwright:**
```
Playwright → WebSocket → Chrome Browser (separate process)
             Uses CDP (Chrome DevTools Protocol)
```

**Playwright CRX:**
```
Playwright → CrxTransport → chrome.debugger API → Same Browser
             Adapts CDP to chrome.debugger
```

The challenge: `chrome.debugger` API is **similar** to CDP but **not identical**. CrxTransport makes them compatible.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  PLAYWRIGHT CODE                                     │
│  await page.goto('https://example.com')              │
└──────────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  CHROMIUM BROWSER (from playwright-core)             │
│  Sends CDP command: Page.navigate                    │
└──────────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  CRX TRANSPORT (this is what we're explaining!)      │
│  • Receives CDP command                              │
│  • Translates to chrome.debugger API                 │
│  • Handles unsupported commands                      │
│  • Manages tab/target mappings                       │
│  • Forwards events back to Playwright                │
└──────────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  CHROME.DEBUGGER API                                 │
│  chrome.debugger.sendCommand(                        │
│    { tabId: 123 },                                   │
│    'Page.navigate',                                  │
│    { url: 'https://example.com' }                    │
│  )                                                    │
└──────────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  BROWSER TAB                                         │
│  Navigates to https://example.com                    │
└──────────────────────────────────────────────────────┘
```

---

## Key Data Structures

```typescript
export class CrxTransport implements ConnectionTransport {
  // Chrome tab ID → CDP Target info
  private _tabToTarget: Map<number, Protocol.Target.TargetInfo>;

  // CDP target ID → Chrome tab ID
  private _targetToTab: Map<string, number>;

  // CDP session ID → Chrome tab ID (for nested targets like iframes)
  private _sessions: Map<string, number>;

  // Browser context ID for non-incognito tabs
  private _defaultBrowserContextId?: string;

  // Callbacks
  onmessage?: (message: ProtocolResponse) => void;  // Send to Playwright
  onclose?: () => void;                             // Transport closed
}
```

### Why These Maps?

Playwright uses **CDP terminology**:
- **Target ID**: Unique ID for a page/iframe/worker
- **Session ID**: Connection to a specific target

Chrome extensions use **Chrome terminology**:
- **Tab ID**: Numeric ID for browser tabs

CrxTransport **translates** between them:

```
Chrome Tab ID: 123
    ↕ (stored in _tabToTarget / _targetToTab)
CDP Target ID: "E8F5D6C7-8A9B-4C3D-2E1F-0A1B2C3D4E5F"
    ↕ (session ID created by CrxTransport)
CDP Session ID: "crx-tab-123"
```

---

## Core Methods Explained

### 1. `attach(tabId)` - Attach Debugger to Tab

This is called when you do `crxApp.attach(tabId)`.

**File: `src/server/transport/crxTransport.ts:169`**

```typescript
async attach(
  tabId: number,
  onBeforeEmitAttachedToTarget?: (targetInfo: TargetInfo) => any
) {
  // Check if already attached
  let targetInfo = this._tabToTarget.get(tabId);

  if (!targetInfo) {
    console.log('🔌 Attaching chrome.debugger to tab', tabId);

    // Step 1: Attach chrome.debugger
    const debuggee = { tabId };
    await chrome.debugger.attach(debuggee, '1.3');
    //                                      ↑
    //                          Chrome DevTools Protocol version

    this._progress?.log(`<chrome debugger attached to tab ${tabId}>`);

    // Step 2: Get target information via CDP
    const response = await this._send(debuggee, 'Target.getTargetInfo');
    targetInfo = response.targetInfo;

    console.log('📋 Target info:', {
      targetId: targetInfo.targetId,
      type: targetInfo.type,
      url: targetInfo.url,
      browserContextId: targetInfo.browserContextId
    });

    // Step 3: Track default (non-incognito) browser context
    if (!this._defaultBrowserContextId) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.incognito) {
        this._defaultBrowserContextId = targetInfo.browserContextId;
        console.log('✅ Default browser context:', this._defaultBrowserContextId);
      }
    }

    // Step 4: Allow callback to prepare (used for incognito context setup)
    await onBeforeEmitAttachedToTarget?.(targetInfo);

    // Step 5: Emit Target.attachedToTarget event
    // This tells Playwright "new page is available"
    this._emitAttachedToTarget(tabId, targetInfo);

    // Step 6: Store mappings
    this._tabToTarget.set(tabId, targetInfo);
    this._targetToTab.set(targetInfo.targetId, tabId);

    console.log('📌 Stored mappings:', {
      tabId,
      targetId: targetInfo.targetId
    });
  }

  return targetInfo;
}
```

**What happens step by step:**

```
1. User calls: crxApp.attach(123)
   ↓
2. CrxTransport.attach(123) is called
   ↓
3. chrome.debugger.attach({ tabId: 123 }, '1.3')
   → Chrome attaches debugger to tab
   → Tab shows "Debugger attached" indicator
   ↓
4. Send CDP command: Target.getTargetInfo
   → Returns: {
       targetId: "E8F5D6C7...",
       type: "page",
       url: "https://example.com",
       browserContextId: "B1234567..."
     }
   ↓
5. Emit Target.attachedToTarget event
   → Playwright receives this
   → Playwright creates Page object
   ↓
6. Store mappings:
   _tabToTarget.set(123, targetInfo)
   _targetToTab.set("E8F5D6C7...", 123)
   ↓
7. Return targetInfo
```

---

### 2. `send(message)` - Send CDP Command

This is called whenever Playwright wants to send a CDP command.

**File: `src/server/transport/crxTransport.ts:68`**

```typescript
async send(message: ProtocolRequest) {
  try {
    console.log('📤 Sending CDP command:', message.method);

    // STEP 1: Figure out which tab this command is for
    // Extract tab ID from session ID
    const [, tabIdStr] = /crx-tab-(\d+)/.exec(message.sessionId ?? '') ?? [];
    //                   ↑
    //          Session IDs look like: "crx-tab-123"

    let debuggee: DebuggerSession;
    if (tabIdStr) {
      // Main session (root page)
      debuggee = { tabId: parseInt(tabIdStr, 10) };
      console.log('📍 Main session for tab:', debuggee.tabId);
    } else {
      // Nested session (iframe, worker, etc.)
      const sessionId = message.sessionId!;
      const tabId = this._sessions.get(sessionId)!;
      debuggee = { tabId, sessionId };
      console.log('📍 Nested session:', { tabId, sessionId });
    }

    let result;

    // STEP 2: Handle commands that chrome.debugger doesn't support
    // These need special treatment!

    if (message.method === 'Target.setAutoAttach') {
      console.log('🔧 Handling Target.setAutoAttach');
      // chrome.debugger needs a filter to exclude service workers
      result = await this._send(debuggee, message.method, {
        ...message.params,
        filter: [
          { exclude: true, type: 'service_worker' },
          { exclude: true, type: 'browser' },
          { exclude: true, type: 'tab' },
        ]
      });
    }

    else if (message.method === 'Target.createTarget') {
      console.log('🔧 Creating new tab instead of CDP target');
      // chrome.debugger can't create targets
      // So we create a Chrome tab instead
      const { browserContextId } = message.params;
      const incognito = browserContextId !== this._defaultBrowserContextId;

      // Create Chrome tab
      const tab = await chrome.tabs.create({ incognito });

      // Attach debugger to new tab
      const { targetId } = await this.attach(tab.id!);

      result = { targetId };
    }

    else if (message.method === 'Target.closeTarget') {
      console.log('🔧 Closing tab instead of CDP target');
      // chrome.debugger can't close targets
      // So we close the Chrome tab instead
      const { targetId } = message.params;
      const tabId = this._targetToTab.get(targetId);

      if (tabId) {
        await chrome.tabs.remove(tabId);
        result = true;
      } else {
        result = false;
      }
    }

    else if (message.method === 'Storage.getCookies') {
      console.log('🔧 Using Network.getCookies instead of Storage.getCookies');
      // chrome.debugger has a bug: Storage.getCookies always returns
      // non-incognito cookies even when attached to incognito tab

      // Solution: Use Network.getCookies for each page
      const { browserContextId, ...params } = message.params;
      const debuggees = this._debuggeesFromBrowserContextId(browserContextId);

      // Get cookies from all pages in this context
      const results = await Promise.all(
        debuggees.map(d => this._send(d, 'Network.getCookies', params))
      );

      // Deduplicate cookies
      const cookieMap = new Map(
        results.flatMap(({ cookies }) =>
          cookies.map(c => [JSON.stringify(c), c])
        )
      );

      result = { cookies: [...cookieMap.values()] };
    }

    else if (message.method === 'Browser.getVersion') {
      console.log('🔧 Faking Browser.getVersion from userAgent');
      // chrome.debugger doesn't support this
      // But we can get it from navigator.userAgent
      const userAgent = navigator.userAgent;
      const [, product] = userAgent.match(/(Chrome\/[0-9\.]+)\b/) ?? [];
      result = { product, userAgent };
    }

    else {
      // STEP 3: Send actual CDP command
      console.log('✅ Sending real CDP command:', message.method);
      result = await this._send(
        debuggee,
        message.method as keyof Protocol.CommandParameters,
        message.params
      );
    }

    // STEP 4: Send result back to Playwright
    console.log('📨 Sending result back');
    this._emitMessage({
      ...message,
      result,
    });

  } catch (error) {
    // STEP 5: Send error back to Playwright
    console.log('❌ Error:', error);
    this._emitMessage({
      ...message,
      error,
    });
  }
}
```

**The actual CDP send:**

```typescript
private async _send<T extends keyof Protocol.CommandParameters>(
  debuggee: DebuggerSession,
  method: T,
  commandParams?: Protocol.CommandParameters[T]
) {
  if (debugLogger.isEnabled('chromedebugger' as LogName)) {
    debugLogger.log('chromedebugger' as LogName, `SEND> ${method} #${debuggee.tabId}`);
  }

  // THIS IS THE KEY LINE
  // Calls chrome.debugger.sendCommand
  return await chrome.debugger.sendCommand(
    debuggee,      // { tabId: 123 } or { tabId: 123, sessionId: "..." }
    method,        // "Page.navigate"
    commandParams  // { url: "https://example.com" }
  ) as Protocol.CommandReturnValues[T];
}
```

---

### 3. Event Handling - Receiving CDP Events

Chrome sends events via `chrome.debugger.onEvent`. CrxTransport forwards them to Playwright.

**File: `src/server/transport/crxTransport.ts:267`**

```typescript
// Set up listener in constructor
constructor() {
  chrome.debugger.onEvent.addListener(this._onDebuggerEvent);
}

private _onDebuggerEvent = (
  { tabId, sessionId }: DebuggerSession,
  message?: string,
  params?: any
) => {
  if (!tabId) return;

  console.log('📥 Received event:', {
    tabId,
    sessionId,
    message,
    params: JSON.stringify(params).slice(0, 100)
  });

  // Generate session ID if not provided
  if (!sessionId) {
    sessionId = this._sessionIdFor(tabId);
    console.log('📝 Generated session ID:', sessionId);
  }

  // Track nested targets (iframes, workers)
  if (message === 'Target.attachedToTarget') {
    const nestedSessionId = (params as Protocol.Target.attachedToTargetPayload).sessionId;
    this._sessions.set(nestedSessionId, tabId);
    console.log('🎯 Nested target attached:', {
      nestedSessionId,
      tabId
    });
  } else if (message === 'Target.detachedFromTarget') {
    const nestedSessionId = (params as Protocol.Target.detachedFromTargetPayload).sessionId;
    this._sessions.delete(nestedSessionId);
    console.log('🎯 Nested target detached:', nestedSessionId);
  }

  // Debug logging
  if (debugLogger.isEnabled('chromedebugger' as LogName)) {
    debugLogger.log('chromedebugger' as LogName, `<RECV ${message} #${tabId}`);
  }

  // Forward to Playwright
  this._emitMessage({
    method: message,
    sessionId,
    params,
  });

  console.log('✅ Event forwarded to Playwright');
};

private _emitMessage(message: ProtocolResponse) {
  if (this.onmessage) {
    this.onmessage(message);
    //    ↑
    //  This goes to CRBrowser which handles CDP events
  }
}
```

---

### 4. Session ID Management

**Session IDs** are how Playwright identifies which page/iframe/worker a command is for.

```typescript
// Create session ID for a tab
private _sessionIdFor(tabId: number): string {
  return `crx-tab-${tabId}`;
}

// Examples:
// Tab 123 → Session ID: "crx-tab-123"
// Tab 456 → Session ID: "crx-tab-456"
```

**For nested targets** (iframes, workers), Chrome provides a real session ID:
```typescript
// When iframe attaches, we get event:
{
  method: 'Target.attachedToTarget',
  params: {
    sessionId: 'E7D3F9A2-1B4C-5E6F-8A9B-0C1D2E3F4A5B',
    targetInfo: { type: 'iframe', ... }
  }
}

// Store it:
this._sessions.set('E7D3F9A2-1B4C-5E6F-8A9B-0C1D2E3F4A5B', 123);
//                 ↑ nested session ID              ↑ tab ID
```

Now when Playwright sends a command for the iframe:
```typescript
{
  sessionId: 'E7D3F9A2-1B4C-5E6F-8A9B-0C1D2E3F4A5B',
  method: 'Runtime.evaluate',
  params: { expression: 'document.title' }
}

// CrxTransport looks up:
const tabId = this._sessions.get('E7D3F9A2-1B4C-5E6F-8A9B-0C1D2E3F4A5B');
// → tabId = 123

// Sends to Chrome:
chrome.debugger.sendCommand(
  { tabId: 123, sessionId: 'E7D3F9A2-1B4C-5E6F-8A9B-0C1D2E3F4A5B' },
  'Runtime.evaluate',
  { expression: 'document.title' }
);
```

---

### 5. `detach(tabOrTarget)` - Detach Debugger

```typescript
async detach(tabOrTarget: number | string) {
  const tabId = typeof tabOrTarget === 'number'
    ? tabOrTarget
    : this._targetToTab.get(tabOrTarget);

  if (!tabId) return;

  console.log('🔌 Detaching from tab:', tabId);

  const targetInfo = this._tabToTarget.get(tabId);

  // Clean up mappings
  this._tabToTarget.delete(tabId);
  if (targetInfo) {
    this._targetToTab.delete(targetInfo.targetId);

    // Tell Playwright target is gone
    this._emitDetachedToTarget(tabId, targetInfo.targetId);
  }

  // Detach chrome.debugger
  await chrome.debugger.detach({ tabId }).catch(() => {});

  this._progress?.log(`<chrome debugger detached from tab ${tabId}>`);

  console.log('✅ Detached from tab:', tabId);
}
```

---

## Complete Examples

### Example 1: Attaching to a Tab

**User code:**
```javascript
const page = await crxApp.attach(123);
```

**What happens in CrxTransport:**

```
1. CrxApplication.attach(123) calls:
   CrxTransport.attach(123)

2. CrxTransport.attach(123):

   ┌─────────────────────────────────────────┐
   │ Check if already attached                │
   │ → Not in _tabToTarget map               │
   │ → Need to attach                         │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ chrome.debugger.attach({ tabId: 123 })  │
   │ → Chrome attaches debugger               │
   │ → Tab shows indicator                    │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ this._send({ tabId: 123 },              │
   │   'Target.getTargetInfo')                │
   │                                          │
   │ Chrome responds:                         │
   │ {                                        │
   │   targetId: "ABC123",                    │
   │   type: "page",                          │
   │   url: "https://example.com",            │
   │   browserContextId: "default"            │
   │ }                                        │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Store default context if needed          │
   │ this._defaultBrowserContextId = "default"│
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Emit Target.attachedToTarget event       │
   │ this._emitMessage({                      │
   │   method: 'Target.attachedToTarget',     │
   │   sessionId: 'crx-tab-123',              │
   │   params: {                               │
   │     sessionId: 'crx-tab-123',            │
   │     targetInfo: { ... }                  │
   │   }                                       │
   │ })                                        │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Store mappings:                          │
   │ _tabToTarget.set(123, targetInfo)        │
   │ _targetToTab.set("ABC123", 123)          │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ CRBrowser receives event                 │
   │ → Creates CRPage                         │
   │ → Page becomes available                 │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ User gets Page object                    │
   └─────────────────────────────────────────┘
```

---

### Example 2: Navigating to a URL

**User code:**
```javascript
await page.goto('https://example.com');
```

**What happens in CrxTransport:**

```
1. Playwright calls:
   page.mainFrame().goto('https://example.com')

2. CRPage sends CDP command via transport:
   transport.send({
     sessionId: 'crx-tab-123',
     method: 'Page.navigate',
     params: { url: 'https://example.com' }
   })

3. CrxTransport.send() receives message:

   ┌─────────────────────────────────────────┐
   │ Extract tab ID from session              │
   │ sessionId = 'crx-tab-123'                │
   │ → tabId = 123                            │
   │ → debuggee = { tabId: 123 }              │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Check if special handling needed         │
   │ method = 'Page.navigate'                 │
   │ → No special handling                    │
   │ → Send directly                          │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ chrome.debugger.sendCommand(             │
   │   { tabId: 123 },                        │
   │   'Page.navigate',                       │
   │   { url: 'https://example.com' }         │
   │ )                                         │
   │                                          │
   │ Returns: { frameId: "...", loaderId: "..." }│
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Send result back to Playwright           │
   │ this._emitMessage({                      │
   │   sessionId: 'crx-tab-123',              │
   │   result: { frameId: "...", ... }        │
   │ })                                        │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Page navigates to URL                    │
   │                                          │
   │ Chrome sends events:                     │
   │ • Page.frameStartedLoading               │
   │ • Page.frameNavigated                    │
   │ • Page.loadEventFired                    │
   │ • Page.domContentEventFired              │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ CrxTransport._onDebuggerEvent            │
   │ Forwards each event to Playwright        │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Playwright knows navigation complete     │
   │ page.goto() resolves                     │
   └─────────────────────────────────────────┘
```

---

### Example 3: Handling Unsupported Command

**User code:**
```javascript
await page.context().cookies();
```

**What happens:**

```
1. BrowserContext sends:
   {
     method: 'Storage.getCookies',
     params: { browserContextId: 'default' }
   }

2. CrxTransport.send() receives it:

   ┌─────────────────────────────────────────┐
   │ Check method                             │
   │ method === 'Storage.getCookies'          │
   │ → Special handling needed!               │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ PROBLEM: Storage.getCookies has a bug   │
   │ in chrome.debugger - always returns     │
   │ non-incognito cookies                    │
   │                                          │
   │ SOLUTION: Use Network.getCookies instead │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Get all debuggees for this context       │
   │                                          │
   │ const debuggees =                        │
   │   this._debuggeesFromBrowserContextId(   │
   │     'default'                            │
   │   );                                      │
   │                                          │
   │ Returns:                                 │
   │ [                                         │
   │   { tabId: 123 },                        │
   │   { tabId: 456 },                        │
   │   { tabId: 789 }                         │
   │ ]                                         │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Send Network.getCookies to each tab      │
   │                                          │
   │ const results = await Promise.all(       │
   │   debuggees.map(d =>                     │
   │     this._send(d, 'Network.getCookies',  │
   │       params)                            │
   │   )                                       │
   │ );                                        │
   │                                          │
   │ Results:                                 │
   │ [                                         │
   │   { cookies: [cookie1, cookie2] },       │
   │   { cookies: [cookie2, cookie3] },       │
   │   { cookies: [cookie3, cookie4] }        │
   │ ]                                         │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Deduplicate cookies                      │
   │                                          │
   │ const cookieMap = new Map(               │
   │   results.flatMap(({ cookies }) =>       │
   │     cookies.map(c =>                     │
   │       [JSON.stringify(c), c]             │
   │     )                                     │
   │   )                                       │
   │ );                                        │
   │                                          │
   │ result = {                               │
   │   cookies: [...cookieMap.values()]       │
   │ };                                        │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Send result back to Playwright           │
   │ this._emitMessage({ result })            │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ User gets cookies                        │
   └─────────────────────────────────────────┘
```

---

### Example 4: Creating a New Page

**User code:**
```javascript
const newPage = await crxApp.newPage();
```

**What happens:**

```
1. CrxApplication.newPage() calls:
   createTab({ incognito: false })

2. Chrome creates new tab → tabId = 789

3. CrxApplication.attach(789)

4. CrxTransport.attach(789):

   ┌─────────────────────────────────────────┐
   │ chrome.debugger.attach({ tabId: 789 })  │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Get target info                          │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Emit Target.attachedToTarget             │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Playwright creates Page object           │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ User gets Page                           │
   └─────────────────────────────────────────┘
```

**But what if Playwright tries to create page via CDP?**

```
1. Sometimes Playwright sends:
   {
     method: 'Target.createTarget',
     params: {
       url: 'about:blank',
       browserContextId: 'default'
     }
   }

2. CrxTransport.send() receives it:

   ┌─────────────────────────────────────────┐
   │ method === 'Target.createTarget'         │
   │ → Chrome debugger doesn't support this!  │
   │ → Need to create Chrome tab instead      │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Determine if incognito                   │
   │                                          │
   │ const incognito = browserContextId !==   │
   │   this._defaultBrowserContextId;         │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Create Chrome tab                        │
   │                                          │
   │ const tab = await chrome.tabs.create({  │
   │   incognito                              │
   │ });                                       │
   │                                          │
   │ tabId = tab.id; // 999                   │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Attach to new tab                        │
   │                                          │
   │ const { targetId } = await this.attach(  │
   │   999                                    │
   │ );                                        │
   │                                          │
   │ targetId = "XYZ789"                      │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Return result                            │
   │                                          │
   │ result = { targetId: "XYZ789" };         │
   └─────────────────────────────────────────┘
                  ↓
   ┌─────────────────────────────────────────┐
   │ Playwright thinks it created a target    │
   │ But we actually created a Chrome tab!    │
   └─────────────────────────────────────────┘
```

---

## Handling Incognito Contexts

Incognito tabs have a different `browserContextId`.

```typescript
// Track default (non-incognito) context
if (!this._defaultBrowserContextId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.incognito) {
    this._defaultBrowserContextId = targetInfo.browserContextId;
  }
}

// Check if tab is incognito
isIncognito(tabIdOrTargetId: number | string | undefined) {
  if (typeof tabIdOrTargetId === 'string') {
    tabIdOrTargetId = this.getTabId(tabIdOrTargetId);
  }
  if (!tabIdOrTargetId) return;

  const targetInfo = this._tabToTarget.get(tabIdOrTargetId);
  return targetInfo?.browserContextId !== this._defaultBrowserContextId;
}
```

**Example:**

```
Non-incognito tab:
  tabId: 123
  browserContextId: "default-context-123"
  → this._defaultBrowserContextId = "default-context-123"
  → isIncognito(123) = false

Incognito tab:
  tabId: 456
  browserContextId: "incognito-context-789"
  → browserContextId !== this._defaultBrowserContextId
  → isIncognito(456) = true
```

---

## Commands That Need Special Handling

### List of Adapted Commands

```typescript
// 1. Target.setAutoAttach
//    Chrome needs filter to exclude service workers
if (message.method === 'Target.setAutoAttach') {
  result = await this._send(debuggee, message.method, {
    ...message.params,
    filter: [
      { exclude: true, type: 'service_worker' },
      { exclude: true, type: 'browser' },
      { exclude: true, type: 'tab' },
    ]
  });
}

// 2. Target.createTarget
//    Chrome can't create CDP targets → Create Chrome tab instead
else if (message.method === 'Target.createTarget') {
  const tab = await chrome.tabs.create({ incognito });
  const { targetId } = await this.attach(tab.id!);
  result = { targetId };
}

// 3. Target.closeTarget
//    Chrome can't close CDP targets → Close Chrome tab instead
else if (message.method === 'Target.closeTarget') {
  const tabId = this._targetToTab.get(targetId);
  await chrome.tabs.remove(tabId);
  result = true;
}

// 4. Storage.getCookies
//    Bug: Always returns non-incognito cookies
//    Fix: Use Network.getCookies for each tab
else if (message.method === 'Storage.getCookies') {
  const debuggees = this._debuggeesFromBrowserContextId(browserContextId);
  const results = await Promise.all(
    debuggees.map(d => this._send(d, 'Network.getCookies', params))
  );
  result = { cookies: deduplicate(results) };
}

// 5. Storage.setCookies
//    Apply to all tabs in context
else if (message.method === 'Storage.setCookies') {
  const debuggees = this._debuggeesFromBrowserContextId(browserContextId);
  await Promise.all(
    debuggees.map(d => this._send(d, 'Network.setCookies', params))
  );
  result = {};
}

// 6. Browser.getVersion
//    Chrome.debugger doesn't support → Get from navigator.userAgent
else if (message.method === 'Browser.getVersion') {
  const userAgent = navigator.userAgent;
  const [, product] = userAgent.match(/(Chrome\/[0-9\.]+)/) ?? [];
  result = { product, userAgent };
}

// 7. Emulation.setEmulatedMedia
//    Causes crash in chrome.debugger.detach → Skip it
else if (message.method === 'Emulation.setEmulatedMedia') {
  result = {};
}

// 8. Target.disposeBrowserContext
//    Chrome doesn't support → Do nothing
else if (message.method === 'Target.disposeBrowserContext') {
  result = {};
}

// 9. Browser.setDownloadBehavior
//    Chrome doesn't support → Do nothing
else if (message.method === 'Browser.setDownloadBehavior') {
  result = {};
}

// 10. Browser.getWindowForTarget
//     Return empty (no window ID)
else if (message.method === 'Browser.getWindowForTarget') {
  result = {};
}
```

---

## Event Flow

### Events Chrome Sends

```typescript
// Setup in constructor
chrome.debugger.onEvent.addListener(this._onDebuggerEvent);
chrome.debugger.onDetach.addListener(this._onRemoved);
chrome.tabs.onRemoved.addListener(this._onRemoved);
chrome.tabs.onCreated.addListener(this._onPopupCreated);
```

### Example Events

```javascript
// Page navigation
chrome.debugger.onEvent fires:
  { tabId: 123 }, 'Page.frameStartedLoading', { frameId: "..." }
  { tabId: 123 }, 'Page.frameNavigated', { frame: {...} }
  { tabId: 123 }, 'Page.loadEventFired', { timestamp: 123456 }

// Network request
  { tabId: 123 }, 'Network.requestWillBeSent', { requestId: "...", ... }
  { tabId: 123 }, 'Network.responseReceived', { requestId: "...", ... }
  { tabId: 123 }, 'Network.loadingFinished', { requestId: "..." }

// Console message
  { tabId: 123 }, 'Runtime.consoleAPICalled', { type: "log", args: [...] }

// Nested target (iframe)
  { tabId: 123 }, 'Target.attachedToTarget', {
    sessionId: "NESTED-SESSION-ID",
    targetInfo: { type: 'iframe', ... }
  }
```

All forwarded to Playwright via `this._emitMessage()`.

---

## Summary

### What CrxTransport Does

1. ✅ **Attaches** `chrome.debugger` to tabs
2. ✅ **Translates** CDP commands → `chrome.debugger.sendCommand`
3. ✅ **Maps** Tab IDs ↔ Target IDs ↔ Session IDs
4. ✅ **Handles** unsupported commands (adapts or fakes them)
5. ✅ **Forwards** events from Chrome → Playwright
6. ✅ **Tracks** incognito vs normal contexts
7. ✅ **Manages** nested targets (iframes, workers)

### Why It's Needed

**Without CrxTransport:**
- Playwright would try to use WebSocket (doesn't work in extensions)
- CDP commands wouldn't reach browser tabs
- Events wouldn't flow back to Playwright
- Incognito wouldn't work properly
- Many commands would fail

**With CrxTransport:**
- Playwright thinks it's talking to Chrome via CDP
- Actually using `chrome.debugger` API
- All commands adapted/translated automatically
- Events forwarded seamlessly
- Full Playwright functionality in Chrome extension!

The transport layer is the **magic** that makes Playwright work in Chrome extensions! 🎩✨
