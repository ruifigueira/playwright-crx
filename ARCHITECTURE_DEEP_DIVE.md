# Playwright CRX - Architecture Deep Dive

This document provides an exhaustive, detailed explanation of how Playwright CRX works, focusing on the client-server architecture and the recorder system.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Layers](#architecture-layers)
3. [Initialization Flow](#initialization-flow)
4. [Client System](#client-system)
5. [Message Flow](#message-flow)
6. [Transport Layer](#transport-layer)
7. [Recorder System](#recorder-system)
8. [Player System](#player-system)
9. [Complete Execution Flows](#complete-execution-flows)

---

## Overview

Playwright CRX adapts the Playwright library to run inside Chrome extensions by:
1. **Replacing the WebSocket transport** with `chrome.debugger` API
2. **Shimming Node.js modules** with browser-compatible implementations
3. **Running client and server in the same process** (browser extension background worker)
4. **Providing a recorder/player** as a Chrome extension UI

The architecture maintains Playwright's original client-server design but runs both sides in the same JavaScript context (the service worker).

---

## Architecture Layers

### Layer Overview (Bottom to Top)

```
┌─────────────────────────────────────────────────────────┐
│  USER CODE (Extension Background Script)                │
│  const crxApp = await crx.start()                       │
│  const page = await crxApp.attach(tabId)                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT API LAYER                                        │
│  • Crx (client/crx.ts)                                  │
│  • CrxApplication (client/crx.ts)                       │
│  • CrxRecorder (client/crx.ts)                          │
│  • Standard Playwright APIs (Page, Browser, etc.)       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT CONNECTION (client/crxConnection.ts)             │
│  • Manages object lifecycle                             │
│  • Serializes/deserializes messages                     │
│  • Routes messages to channel owners                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  MESSAGE PASSING (in-memory, synchronous/async)          │
│  clientConnection.onmessage ←→ dispatcherConnection      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  DISPATCHER LAYER                                        │
│  • CrxPlaywrightDispatcher                              │
│  • CrxDispatcher                                        │
│  • CrxApplicationDispatcher                             │
│  • Standard Playwright Dispatchers                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  SERVER IMPLEMENTATION                                   │
│  • CrxPlaywright (server/crxPlaywright.ts)              │
│  • Crx (server/crx.ts)                                  │
│  • CrxApplication (server/crx.ts)                       │
│  • CRBrowser, CRBrowserContext, etc.                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  TRANSPORT LAYER (server/transport/crxTransport.ts)      │
│  • Manages chrome.debugger connections                   │
│  • Translates CDP ↔ chrome.debugger API                │
│  • Manages tab/target mappings                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  CHROME DEBUGGER API                                     │
│  chrome.debugger.attach(tabId)                          │
│  chrome.debugger.sendCommand(debuggee, method, params)  │
│  chrome.debugger.onEvent.addListener(...)               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  BROWSER TABS (Chrome DevTools Protocol)                │
└─────────────────────────────────────────────────────────┘
```

---

## Initialization Flow

### File: `src/index.ts`

This is the entry point that sets up the entire system.

```javascript
// 1. Create server-side Playwright instance
const playwright = new CrxPlaywright();

// 2. Create client connection (handles client API)
const clientConnection = new CrxConnection(nodePlatform);

// 3. Create dispatcher connection (handles server-side dispatching)
const dispatcherConnection = new DispatcherConnection(true /* local */);

// 4. Wire up message passing (initially synchronous)
dispatcherConnection.onmessage = message => clientConnection.dispatch(message);
clientConnection.onmessage = message => dispatcherConnection.dispatch(message);

// 5. Create root dispatcher
const rootScope = new RootDispatcher(dispatcherConnection);

// 6. Create Playwright dispatcher (creates the object tree)
new CrxPlaywrightDispatcher(rootScope, playwright);

// 7. Get client API from connection
const playwrightAPI = clientConnection.getObjectWithKnownName('Playwright');

// 8. Switch to async message passing
dispatcherConnection.onmessage = message => setImmediate(() => clientConnection.dispatch(message));
clientConnection.onmessage = message => setImmediate(() => dispatcherConnection.dispatch(message));

// 9. Export the API
export const { _crx: crx, selectors, errors } = playwrightAPI;
```

### What Happens During Initialization:

1. **Server Objects Created:**
   - `CrxPlaywright` (extends Playwright)
   - Contains `Crx` instance
   - Initialized but not yet connected to browser

2. **Dispatcher Tree Created:**
   ```
   RootDispatcher
   └── CrxPlaywrightDispatcher
       ├── BrowserTypeDispatcher (chromium, firefox, webkit)
       ├── CrxDispatcher
       └── ... (other dispatchers)
   ```

3. **Client Objects Created:**
   Via `__create__` messages sent during dispatcher initialization:
   ```
   CrxPlaywright (client)
   └── Crx (client)
   ```

4. **Message Routing Established:**
   - Initially synchronous (for setup)
   - Then switches to async (via setImmediate)

---

## Client System

### What is the "Client"?

The client is the **user-facing API layer**. When you write:
```javascript
const crxApp = await crx.start();
const page = await crxApp.attach(123);
await page.goto('https://example.com');
```

You're interacting with **client objects**.

### Client Architecture

#### 1. Client Connection (`src/client/crxConnection.ts`)

**Purpose:** Manages the client side of the message protocol.

**Key Responsibilities:**

```typescript
class CrxConnection extends Connection {
  // Handles incoming messages from the server
  dispatch(message: object): void {
    const { guid: parentGuid, method, params } = message as any;

    if (method === '__create__') {
      // Server wants us to create a new client object
      const { type, guid } = params;

      switch (type) {
        case 'Playwright':
          new CrxPlaywright(parent, type, guid, initializer);
          return;
        case 'Crx':
          new Crx(parent, type, guid, initializer);
          return;
        case 'CrxApplication':
          new CrxApplication(parent, type, guid, initializer);
          return;
      }
    }

    // Pass to base Connection class for standard handling
    return super.dispatch(message);
  }
}
```

**What it does:**
- Receives `__create__` messages from server
- Instantiates corresponding client objects
- Maintains registry of all client objects by GUID
- Routes method calls and events between objects

#### 2. Client Objects (`src/client/crx.ts`)

**Three main client classes:**

##### A. `Crx` Class

```typescript
export class Crx extends ChannelOwner<channels.CrxChannel> {
  readonly fs: api.CrxFs = fs;  // In-memory file system

  async start(options?: channels.CrxStartOptions) {
    // Sends message to server via channel
    const result = await this._channel.start(options ?? {});

    // Extracts CrxApplication from result
    const crxApp = from<CrxApplication>(result.crxApplication);

    // Stores promise for later retrieval
    this._crxAppPromise = Promise.resolve(crxApp);

    return crxApp;
  }

  async get(options?: { incognito: boolean }) {
    // Retrieves existing CrxApplication
    return options?.incognito
      ? await this._incognitoCrxPromise
      : await this._crxAppPromise;
  }
}
```

**Purpose:** Factory for creating CrxApplication instances.

##### B. `CrxApplication` Class

```typescript
export class CrxApplication extends ChannelOwner<channels.CrxApplicationChannel> {
  private _context: BrowserContext;
  readonly recorder: api.CrxRecorder;

  constructor(parent, type, guid, initializer) {
    super(parent, type, guid, initializer);

    // Extract browser context from initializer
    this._context = (initializer.context as any)._object;

    // Create recorder interface
    this.recorder = new CrxRecorder(this._channel);

    // Listen to server events
    this._channel.on('attached', ({ page, tabId }) => {
      this.emit('attached', { tabId, page: Page.from(page) });
    });

    this._channel.on('detached', ({ tabId }) => {
      this.emit('detached', tabId);
    });
  }

  async attach(tabId: number) {
    // Sends attach request to server
    const result = await this._channel.attach({ tabId });

    // Returns Page client object
    return from<Page>(result.page);
  }

  async newPage(options?) {
    const result = await this._channel.newPage(options ?? {});
    return from<Page>(result.page);
  }

  context() {
    return this._context;
  }

  pages(): api.Page[] {
    return this._context.pages();
  }
}
```

**Purpose:** Manages browser context, pages, and recorder for a session.

##### C. `CrxRecorder` Class

```typescript
export class CrxRecorder extends EventEmitter {
  private _channel: channels.CrxApplicationChannel;
  private _hidden: boolean = true;
  private _mode: Mode = 'none';

  constructor(channel: channels.CrxApplicationChannel) {
    super();
    this._channel = channel;

    // Listen to recorder events from server
    this._channel.on('hide', () => {
      this._hidden = true;
      this.emit('hide');
    });

    this._channel.on('show', () => {
      this._hidden = false;
      this.emit('show');
    });

    this._channel.on('modeChanged', event => {
      this._mode = event.mode;
      this.emit('modechanged', event);
    });
  }

  async show(options?) {
    await this._channel.showRecorder(options ?? {});
  }

  async hide() {
    await this._channel.hideRecorder();
  }

  async setMode(mode: Mode) {
    await this._channel.setMode({ mode });
  }

  async run(code: string, page?: Page) {
    await this._channel.run({ code, page: page?._channel });
  }

  async list(code: string) {
    const { tests } = await this._channel.list({ code });
    return tests;
  }
}
```

**Purpose:** Client interface to the recorder system.

#### 3. Channel Owner Pattern

All client objects extend `ChannelOwner`:

```typescript
class ChannelOwner {
  _channel: Channel;  // Communication channel to server
  _guid: string;      // Unique identifier

  constructor(parent, type, guid, initializer) {
    this._guid = guid;
    this._channel = this._createChannel(type);
  }

  // When you call a method on client object:
  async someMethod(params) {
    // This sends a message to the server dispatcher
    return await this._channel.someMethod(params);
  }
}
```

**How it works:**
1. Client object method called: `crxApp.attach(123)`
2. Channel sends message: `{ guid: 'crxApp-123', method: 'attach', params: { tabId: 123 } }`
3. Message goes through `clientConnection.onmessage`
4. Routed to `dispatcherConnection.dispatch`
5. Dispatcher calls server method
6. Result flows back through same path

#### 4. Client Zone Wrapping (`src/client/crxZone.ts`)

**Purpose:** Tracks which API calls are being made for debugging/logging.

```typescript
export function wrapClientApis() {
  // For every async method in every API class:
  for (const [typeName, [proto, props]] of Object.entries(apis)) {
    for (const [key, needsWrap] of Object.entries(props)) {
      const originalFn = (proto as any)[key];

      // Wrap it with zone tracking
      const wrapFn = async function(...args) {
        const apiName = currentZone().data('crxZone');
        if (apiName) {
          // Already in a zone, just call
          return await originalFn.apply(this, args);
        }

        // Create new zone with API name
        return await currentZone()
          .with('crxZone', { apiName: `${typeName}.${key}` })
          .run(async () => await originalFn.apply(this, args));
      };

      (proto as any)[key] = wrapFn;
    }
  }
}
```

**Why?**
- Provides context for debugging
- Enables tracing of API call chains
- Used by instrumentation/logging

---

## Message Flow

### Example: `crxApp.attach(tabId)` Call

#### Step-by-Step Execution:

```
┌─────────────────────────────────────────────────────┐
│ 1. USER CODE                                        │
│    const page = await crxApp.attach(123);           │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 2. CLIENT OBJECT (CrxApplication)                   │
│    File: src/client/crx.ts:156                      │
│                                                      │
│    async attach(tabId: number) {                    │
│      const result = await this._channel.attach({    │
│        tabId                                         │
│      });                                             │
│      return from<Page>(result.page);                │
│    }                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 3. CHANNEL CALL                                     │
│    Internally creates message:                      │
│    {                                                 │
│      guid: 'CrxApplication@abc123',                 │
│      method: 'attach',                              │
│      params: { tabId: 123 },                        │
│      metadata: { ... }                              │
│    }                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 4. CLIENT CONNECTION                                │
│    File: src/client/crxConnection.ts                │
│                                                      │
│    Serializes message and calls:                    │
│    clientConnection.onmessage(message)              │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 5. DISPATCHER CONNECTION                            │
│    File: src/index.ts:54                            │
│                                                      │
│    setImmediate(() =>                               │
│      dispatcherConnection.dispatch(message)         │
│    )                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 6. DISPATCHER                                       │
│    File: src/server/dispatchers/crxDispatcher.ts:64 │
│                                                      │
│    async attach(params) {                           │
│      const page = await this._object.attach(        │
│        params.tabId                                  │
│      );                                              │
│      return {                                        │
│        page: PageDispatcher.from(this._context, page)│
│      };                                              │
│    }                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 7. SERVER IMPLEMENTATION                            │
│    File: src/server/crx.ts:258                      │
│                                                      │
│    async attach(tabId: number): Promise<Page> {     │
│      const { targetId, browserContextId } =         │
│        await this._transport.attach(tabId);         │
│                                                      │
│      const crPage = this._crPageByTargetId(targetId);│
│      const page = await crPage._page                │
│        .waitForInitializedOrError();                 │
│                                                      │
│      return page;                                    │
│    }                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 8. TRANSPORT LAYER                                  │
│    File: src/server/transport/crxTransport.ts:169   │
│                                                      │
│    async attach(tabId, onBeforeEmit?) {             │
│      const debuggee = { tabId };                    │
│      await chrome.debugger.attach(debuggee, '1.3'); │
│                                                      │
│      const response = await this._send(             │
│        debuggee,                                     │
│        'Target.getTargetInfo'                        │
│      );                                              │
│                                                      │
│      this._emitAttachedToTarget(tabId, targetInfo); │
│      return targetInfo;                             │
│    }                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 9. CHROME DEBUGGER API                              │
│    chrome.debugger.attach({ tabId: 123 }, '1.3')   │
│    chrome.debugger.sendCommand(                     │
│      { tabId: 123 },                                │
│      'Target.getTargetInfo',                        │
│      {}                                              │
│    )                                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 10. RESULT FLOWS BACK                               │
│     Page object created on server                   │
│     PageDispatcher wraps it                         │
│     Message sent to client                          │
│     Client Page object created                      │
│     Returned to user code                           │
└─────────────────────────────────────────────────────┘
```

### Message Types

#### 1. Method Calls (Client → Server)

```javascript
{
  guid: 'object-guid',
  method: 'methodName',
  params: { ... },
  metadata: { ... }
}
```

#### 2. Method Results (Server → Client)

```javascript
{
  id: 'call-id',
  result: { ... }
}
```

or

```javascript
{
  id: 'call-id',
  error: { message: '...', stack: '...' }
}
```

#### 3. Object Creation (Server → Client)

```javascript
{
  guid: 'parent-guid',
  method: '__create__',
  params: {
    type: 'Page',
    guid: 'new-object-guid',
    initializer: { ... }
  }
}
```

#### 4. Events (Server → Client)

```javascript
{
  guid: 'object-guid',
  method: 'eventName',
  params: { ... }
}
```

---

## Transport Layer

### File: `src/server/transport/crxTransport.ts`

The transport layer is the **bridge between Playwright's CDP commands and Chrome's debugger API**.

#### Key Data Structures

```typescript
class CrxTransport implements ConnectionTransport {
  private _targetToTab: Map<string, number>;      // CDP targetId → Chrome tabId
  private _tabToTarget: Map<number, TargetInfo>;  // Chrome tabId → CDP target info
  private _sessions: Map<string, number>;         // CDP sessionId → Chrome tabId
  private _defaultBrowserContextId?: string;      // Non-incognito context ID

  onmessage?: (message: ProtocolResponse) => void;
  onclose?: () => void;
}
```

#### Core Methods

##### 1. `attach(tabId)` - Attach debugger to tab

```typescript
async attach(tabId: number, onBeforeEmitAttachedToTarget?) {
  let targetInfo = this._tabToTarget.get(tabId);

  if (!targetInfo) {
    // Attach chrome debugger
    const debuggee = { tabId };
    await chrome.debugger.attach(debuggee, '1.3');

    // Get target info via CDP
    const response = await this._send(debuggee, 'Target.getTargetInfo');
    targetInfo = response.targetInfo;

    // Track default browser context
    if (!this._defaultBrowserContextId) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.incognito) {
        this._defaultBrowserContextId = targetInfo.browserContextId;
      }
    }

    // Allow callback to prepare for event
    await onBeforeEmitAttachedToTarget?.(targetInfo);

    // Emit Target.attachedToTarget event
    // This triggers Playwright to create Page object
    this._emitAttachedToTarget(tabId, targetInfo);

    // Store mappings
    this._tabToTarget.set(tabId, targetInfo);
    this._targetToTab.set(targetInfo.targetId, tabId);
  }

  return targetInfo;
}
```

##### 2. `send(message)` - Send CDP command

```typescript
async send(message: ProtocolRequest) {
  try {
    // Extract tab ID from session ID
    const [, tabIdStr] = /crx-tab-(\d+)/.exec(message.sessionId ?? '') ?? [];

    let debuggee: DebuggerSession;
    if (tabIdStr) {
      debuggee = { tabId: parseInt(tabIdStr, 10) };
    } else {
      const tabId = this._sessions.get(message.sessionId!);
      debuggee = { tabId, sessionId: message.sessionId };
    }

    let result;

    // Handle commands that chrome.debugger doesn't support
    if (message.method === 'Target.createTarget') {
      // Create new tab instead
      const tab = await createTab({ incognito });
      const { targetId } = await this.attach(tab.id!);
      result = { targetId };

    } else if (message.method === 'Target.closeTarget') {
      // Close tab
      const { targetId } = message.params;
      const tabId = this._targetToTab.get(targetId);
      if (tabId) {
        await chrome.tabs.remove(tabId);
        result = true;
      }

    } else if (message.method === 'Storage.getCookies') {
      // chrome.debugger doesn't isolate cookies properly
      // Use Network.getCookies for each page instead
      const { browserContextId, ...params } = message.params;
      const debuggees = this._debuggeesFromBrowserContextId(browserContextId);
      const results = await Promise.all(
        debuggees.map(d => this._send(d, 'Network.getCookies', params))
      );
      const cookies = new Map(
        results.flatMap(({ cookies }) =>
          cookies.map(c => [JSON.stringify(c), c])
        )
      );
      result = { cookies: [...cookies.values()] };

    } else {
      // Send actual CDP command
      result = await this._send(debuggee, message.method, message.params);
    }

    // Send result back
    this._emitMessage({
      ...message,
      result,
    });

  } catch (error) {
    // Send error back
    this._emitMessage({
      ...message,
      error,
    });
  }
}

private async _send(debuggee, method, params?) {
  return await chrome.debugger.sendCommand(debuggee, method, params);
}
```

##### 3. Event Handling

```typescript
private _onDebuggerEvent = ({ tabId, sessionId }, message, params) => {
  if (!tabId) return;

  if (!sessionId) {
    sessionId = this._sessionIdFor(tabId);
  }

  // Track sessions for nested targets (iframes, workers)
  if (message === 'Target.attachedToTarget') {
    this._sessions.set(params.sessionId, tabId);
  } else if (message === 'Target.detachedFromTarget') {
    this._sessions.delete(params.sessionId);
  }

  // Forward event to Playwright
  this._emitMessage({
    method: message,
    sessionId,
    params,
  });
};

// Register listener during construction
constructor() {
  chrome.debugger.onEvent.addListener(this._onDebuggerEvent);
}
```

#### Session ID Mapping

Playwright uses session IDs to route CDP messages. CRX maps these to tab IDs:

```typescript
private _sessionIdFor(tabId: number): string {
  return `crx-tab-${tabId}`;
}
```

**Example:**
- Tab ID: `123`
- Session ID: `crx-tab-123`
- Nested iframe session: Actual CDP session ID from `Target.attachedToTarget`

---

## Recorder System

The recorder is the most complex subsystem. It consists of:
1. **Server-side recorder app** (manages state)
2. **Recorder window** (UI - popup or sidepanel)
3. **Code parser** (parses Playwright code)
4. **Player** (executes recorded actions)

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  RECORDER UI (Popup/Sidepanel Window)                    │
│  • CodeMirror editor                                      │
│  • Language selector                                      │
│  • Record/Inspect buttons                                │
│  • Play/Pause controls                                    │
└──────────────────────────────────────────────────────────┘
                    ↕ (chrome.runtime Port messages)
┌──────────────────────────────────────────────────────────┐
│  CrxRecorderApp (server/recorder/crxRecorderApp.ts)      │
│  • Manages recorder state                                │
│  • Handles mode changes (recording/inspecting/none)      │
│  • Sends messages to UI                                  │
│  • Receives events from UI                               │
└──────────────────────────────────────────────────────────┘
                    ↕
┌──────────────────────────────────────────────────────────┐
│  Playwright Recorder (from playwright-core)              │
│  • Injects recorder scripts into pages                   │
│  • Captures user actions                                 │
│  • Generates code                                         │
│  • Provides element picker                               │
└──────────────────────────────────────────────────────────┘
                    ↕
┌──────────────────────────────────────────────────────────┐
│  Browser Pages                                            │
│  • Event listeners injected                              │
│  • Highlights on hover                                    │
│  • Action recording                                       │
└──────────────────────────────────────────────────────────┘
```

### Components in Detail

#### 1. CrxRecorderApp (`src/server/recorder/crxRecorderApp.ts`)

**Purpose:** Server-side coordinator for the recorder.

```typescript
export class CrxRecorderApp extends EventEmitter implements IRecorderApp {
  private _crx: Crx;
  readonly _recorder: Recorder;            // Playwright's recorder
  private _window?: RecorderWindow;        // UI window
  private _editedCode?: EditedCode;        // Parsed user code
  private _recordedActions: ActionInContext[] = [];
  private _mode: Mode = 'none';

  async open(options?) {
    const mode = options?.mode ?? 'none';
    const language = options?.language ?? 'playwright-test';

    // Create window (popup or sidepanel)
    this._window = options?.window?.type === 'sidepanel'
      ? new SidepanelRecorderWindow(options.window.url)
      : new PopupRecorderWindow(options?.window?.url);

    // Set up message handler
    this._window.onMessage = this._onMessage.bind(this);

    // Set initial state in recorder
    this._recorder.setOutput(language, undefined);
    this._recorder.setMode(mode);

    // Open the window
    await this._window.open();
    this.emit('show');

    this.setMode(mode);
  }

  async setMode(mode: Mode) {
    if (mode === 'recording') {
      // Stop player if running
      await this._crx.player.stop();
    }

    this._mode = mode;
    this.emit('modeChanged', { mode });

    // Send to UI
    this._sendMessage({
      type: 'recorder',
      method: 'setMode',
      mode
    });
  }

  private _onMessage({ type, event, params }) {
    if (type === 'recorderEvent') {
      switch (event) {
        case 'fileChanged':
          // User changed language
          this._filename = params.file;
          break;

        case 'codeChanged':
          // User edited code in UI
          this._updateCode(params.code);
          break;

        case 'cursorActivity':
          // User moved cursor - highlight corresponding element
          this._currentCursorPosition = params.position;
          this._updateLocator(this._currentCursorPosition);
          break;

        case 'resume':
        case 'step':
          // User clicked play
          this._run().catch(() => {});
          break;

        case 'setMode':
          // User clicked record/inspect button
          this._mode = params.mode;
          this.emit('modeChanged', { mode: params.mode });
          break;
      }
    }
  }

  async setActions(actions: ActionInContext[], sources: Source[]) {
    // Called by Playwright recorder when actions are recorded
    this._recordedActions = Array.from(actions);
    this._sources = Array.from(sources);

    if (this._recorder._isRecording()) {
      this._updateCode(null);
    }
  }

  async setSources(sources: Source[]) {
    // Send code to UI
    sources = sources
      .filter(s => s.isRecorded)
      .map(s => this._editedCode?.decorate(s) ?? s);

    this._sendMessage({
      type: 'recorder',
      method: 'setSources',
      sources
    });
  }

  private async _run() {
    if (this._crx.player.isPlaying()) return;

    const incognito = this._playInIncognito;

    // Get or create CrxApp for playback
    const crxApp = await this._crx.get({ incognito })
      ?? await this._crx.start({ incognito });

    // Run the actions
    await this._crx.player.run(crxApp._context, this._getActions());
  }
}
```

#### 2. Recorder Windows

##### A. Sidepanel Window (`src/server/recorder/sidepanelRecorderWindow.ts`)

```typescript
export class SidepanelRecorderWindow implements RecorderWindow {
  private _recorderUrl: string;
  private _portPromise: Promise<chrome.runtime.Port>;

  async open() {
    // Set sidepanel to show recorder
    await chrome.sidePanel.setOptions({ path: this._recorderUrl });

    // Wait for UI to connect
    await this._portPromise;
    this._closed = false;
  }

  postMessage(msg: RecorderMessage) {
    this._portPromise
      .then(port => port.postMessage(msg))
      .catch(() => {});
  }

  private _waitConnect(): Promise<chrome.runtime.Port> {
    return new Promise(resolve => {
      const onConnect = (port: chrome.runtime.Port) => {
        chrome.runtime.onConnect.removeListener(onConnect);

        // Set up disconnect handler
        port.onDisconnect.addListener(this.close.bind(this));

        // Set up message handler
        if (this.onMessage) {
          port.onMessage.addListener(this.onMessage.bind(this));
        }

        resolve(port);
      };
      chrome.runtime.onConnect.addListener(onConnect);
    });
  }
}
```

**How it works:**
1. Recorder UI loads in sidepanel
2. UI calls `chrome.runtime.connect()`
3. Background receives port
4. Bidirectional communication established

##### B. Popup Window (`src/server/recorder/popupRecorderWindow.ts`)

```typescript
export class PopupRecorderWindow implements RecorderWindow {
  private _window?: chrome.windows.Window;

  async open() {
    if (this._window) return;

    // Wait for UI to connect
    this._portPromise = new Promise(resolve => {
      const onConnect = (port) => {
        chrome.runtime.onConnect.removeListener(onConnect);
        port.onDisconnect.addListener(this.close.bind(this));
        if (this.onMessage) {
          port.onMessage.addListener(this.onMessage);
        }
        resolve(port);
      };
      chrome.runtime.onConnect.addListener(onConnect);
    });

    // Create popup window
    const [wnd] = await Promise.all([
      chrome.windows.create({
        type: 'popup',
        url: this._recorderUrl
      }),
      this._portPromise,
    ]);

    this._window = wnd;
  }
}
```

#### 3. Code Parser (`src/server/recorder/parser.ts`)

**Purpose:** Parse Playwright test code back into actions for playback.

```typescript
export function parse(code: string, file: string = 'playwright-test') {
  // Parse code into AST using acorn
  const ast = acorn.parse(code, {
    ecmaVersion: 2020,
    sourceType: 'module',
    locations: true,
  });

  const tests: Test[] = [];

  // Walk the AST looking for test() calls
  walk.ancestor(ast, {
    CallExpression({ callee, arguments: args }, _, ancestors) {
      // Looking for: test('title', async ({ page }) => { ... })

      if (callee.type !== 'Identifier' || callee.name !== 'test') {
        return;
      }

      const [title, fn] = args;

      // Extract test title
      if (title.type !== 'Literal') {
        parserError('Invalid test title', title.loc);
      }

      // Extract function body
      if (fn.type !== 'ArrowFunctionExpression') {
        parserError('Invalid test function', fn.loc);
      }

      const actions: ActionInContextWithLocation[] = [];
      const pages = new Set<string>(['page']);

      // Parse each statement in the test
      for (const stmt of fn.body.body) {
        if (stmt.type === 'ExpressionStatement') {
          // await page.goto('...')
          const action = parseActionExpression(stmt.expression, pages);
          actions.push(action);
        }
      }

      tests.push({
        title: title.value as string,
        actions,
        location: { file, ...indexToLineColumn(code, callee.start) },
      });
    }
  });

  return tests;
}

function parseActionExpression(expr, pages) {
  // Extract page variable and method name
  // Examples:
  //   await page.goto('url')
  //   await page.click('selector')
  //   await page.fill('selector', 'text')
  //   await expect(page.locator('selector')).toHaveText('text')

  const actionFnName = expr.argument.callee.property.name;

  if (actionFnName === 'goto') {
    return {
      action: {
        name: 'navigate',
        url: args[0],
        signals: []
      },
      frame: { pageAlias: 'page', framePath: [] },
      location: { file, line, column },
    };
  }

  if (actionFnName === 'click') {
    const selector = locatorOrSelectorAsSelector('javascript', locator);
    return {
      action: {
        name: 'click',
        selector,
        signals: [],
        button: 'left',
        modifiers: 0,
        clickCount: 1,
      },
      frame: { pageAlias: 'page', framePath: [] },
      location: { file, line, column },
    };
  }

  // ... handle other actions
}
```

**Supported syntax:**

```javascript
// Basic actions
await page.goto('https://example.com');
await page.click('button');
await page.fill('input', 'text');
await page.press('input', 'Enter');
await page.check('checkbox');

// Assertions
await expect(page.locator('h1')).toHaveText('Title');
await expect(page.locator('input')).toHaveValue('value');
await expect(page.locator('checkbox')).toBeChecked();
```

#### 4. EditedCode Class

**Purpose:** Track user edits and parse them.

```typescript
class EditedCode {
  readonly code: string;
  private _actions: ActionInContextWithLocation[] = [];
  private _highlight: SourceHighlight[] = [];

  constructor(recorder: Recorder, code: string, onLoaded?) {
    this.code = code;
    this._recorder = recorder;

    // Debounce parsing (wait 500ms after edit)
    this._codeLoadDebounceTimeout = setTimeout(this.load.bind(this), 500);
  }

  load() {
    if (this.hasLoaded()) return;

    this.stopLoad();

    try {
      // Parse the code
      const [{ actions, options }] = parse(this.code);
      this._actions = actions;

      // Load into recorder
      this._recorder.loadScript({
        actions,
        deviceName: options.deviceName ?? '',
        contextOptions: options.contextOptions ?? {},
        text: this.code
      });

    } catch (error) {
      // Syntax error - show in UI
      this._actions = [];
      const line = error.loc.line ?? this.code.split('\n').length;
      this._highlight = [{
        line,
        type: 'error',
        message: error.message
      }];

      this._recorder.loadScript({
        actions: [],
        deviceName: '',
        contextOptions: {},
        text: this.code,
        highlight: this._highlight
      });
    }
  }
}
```

---

## Player System

### File: `src/server/recorder/crxPlayer.ts`

**Purpose:** Execute recorded Playwright actions.

```typescript
export default class CrxPlayer extends EventEmitter {
  private _crx: Crx;
  private _currAction?: PerformAction;
  private _pageAliases = new Map<Page, string>();

  async run(pageOrContext: Page | BrowserContext, actions: PerformAction[]) {
    if (this.isPlaying()) return;

    let context: BrowserContext;
    let page: Page;

    if (pageOrContext instanceof Page) {
      page = pageOrContext;
      context = page.context();
    } else {
      context = pageOrContext;
      page = context.pages()[0] ?? await context.newPage();
    }

    // Set up page aliases
    this._pageAliases.clear();
    this._pageAliases.set(page, 'page');

    this.emit('start');

    try {
      for (const action of actions) {
        this._currAction = action;
        await this._performAction(context, action);
      }
    } catch (e) {
      if (e instanceof Stopped) return;
      throw e;
    } finally {
      this._currAction = undefined;
      this.pause().catch(() => {});
    }
  }

  private async _performAction(context, actionInContext) {
    const { action } = actionInContext;
    const kActionTimeout = 5000;

    // Wrapper that handles instrumentation
    const innerPerformAction = async (mainFrame, actionInContext, cb) => {
      const callMetadata: CallMetadata = {
        id: `call@${createGuid()}`,
        method: action.name,
        params: action,
        location: actionInContext.location,
        playing: true,
        ...
      };

      try {
        await context.instrumentation.onBeforeCall(context, callMetadata);
        await cb(callMetadata);
      } catch (e) {
        callMetadata.error = serializeError(e);
      } finally {
        callMetadata.endTime = monotonicTime();
        await context.instrumentation.onAfterCall(context, callMetadata);
        if (callMetadata.error) throw callMetadata.error.error;
      }
    };

    // Get page for action
    const pageAlias = actionInContext.frame.pageAlias;
    const page = [...this._pageAliases.entries()]
      .find(([, alias]) => pageAlias === alias)?.[0];
    const mainFrame = page.mainFrame();

    // Execute based on action type
    if (action.name === 'navigate') {
      return await innerPerformAction(mainFrame, actionInContext,
        callMetadata => mainFrame.goto(callMetadata, action.url, {
          timeout: kActionTimeout
        })
      );
    }

    if (action.name === 'click') {
      const selector = buildFullSelector(actionInContext.frame.framePath, action.selector);
      return await innerPerformAction(mainFrame, actionInContext,
        callMetadata => mainFrame.click(callMetadata, selector, {
          button: action.button,
          modifiers: action.modifiers,
          clickCount: action.clickCount,
          timeout: kActionTimeout,
          strict: true
        })
      );
    }

    if (action.name === 'fill') {
      const selector = buildFullSelector(actionInContext.frame.framePath, action.selector);
      return await innerPerformAction(mainFrame, actionInContext,
        callMetadata => mainFrame.fill(callMetadata, selector, action.text, {
          timeout: kActionTimeout,
          strict: true
        })
      );
    }

    if (action.name === 'assertText') {
      const selector = buildFullSelector(actionInContext.frame.framePath, action.selector);
      return await innerPerformAction(mainFrame, actionInContext,
        callMetadata => mainFrame.expect(callMetadata, selector, {
          selector,
          expression: 'to.have.text',
          expectedText: serializeExpectedTextValues([action.text], {
            matchSubstring: true,
            normalizeWhiteSpace: true
          }),
          isNot: false,
          timeout: kActionTimeout,
        })
      );
    }

    // ... handle other action types
  }

  async stop() {
    if (this._currAction || this._pause) {
      this._currAction = undefined;
      this._stopping = new ManualPromise();
      await Promise.all([this._stopping, this._pause]);
      this._stopping = undefined;
      this._pause = undefined;
      this.emit('stop');
    }
  }
}
```

**How playback works:**

1. **Parse code:** Extract actions from test code
2. **Map pages:** Track page aliases (page, page1, page2, etc.)
3. **Execute sequentially:** Run each action one by one
4. **Instrumentation:** Each action creates a CallMetadata
5. **Callbacks:** `onBeforeCall` and `onAfterCall` notify recorder
6. **Highlighting:** Recorder highlights currently executing line
7. **Errors:** Stop on error and show in UI

---

## Complete Execution Flows

### Flow 1: Starting CRX and Attaching to Tab

```javascript
const crxApp = await crx.start();
const page = await crxApp.attach(tabId);
```

**Detailed Steps:**

```
1. User calls: crx.start()
   ↓
2. Client (Crx.start):
   - Sends message to server: { method: 'start', params: {} }
   ↓
3. Dispatcher (CrxDispatcher.start):
   - Calls server: this._object.start(params)
   - Returns: { crxApplication: new CrxApplicationDispatcher(...) }
   ↓
4. Server (Crx.start):
   - Creates CrxTransport
   - Creates CRBrowser connection: CRBrowser.connect(transport, options)
   - Creates CrxApplication
   - Sets up event listeners
   - Returns CrxApplication
   ↓
5. CRBrowser.connect:
   - Sends CDP: Browser.getVersion
   - Creates browser instance
   - Sets up default context
   - Returns CRBrowser
   ↓
6. Client receives CrxApplication:
   - Creates client CrxApplication object
   - Stores in _crxAppPromise
   - Returns to user
   ↓
7. User calls: crxApp.attach(tabId)
   ↓
8. Client (CrxApplication.attach):
   - Sends message: { method: 'attach', params: { tabId } }
   ↓
9. Dispatcher (CrxApplicationDispatcher.attach):
   - Calls server: this._object.attach(tabId)
   - Wraps result: { page: PageDispatcher.from(page) }
   ↓
10. Server (CrxApplication.attach):
    - Calls: this._transport.attach(tabId)
    ↓
11. Transport (CrxTransport.attach):
    - Calls: chrome.debugger.attach({ tabId }, '1.3')
    - Sends CDP: Target.getTargetInfo
    - Stores mappings: _tabToTarget, _targetToTab
    - Emits: Target.attachedToTarget event
    - Returns targetInfo
    ↓
12. CRBrowser receives Target.attachedToTarget:
    - Creates CRPage for target
    - Sends: Target.setAutoAttach
    - Initializes page
    ↓
13. Server (CrxApplication.attach continues):
    - Waits for page initialization
    - Returns page
    ↓
14. Client receives Page:
    - Creates client Page object
    - Returns to user
```

### Flow 2: Recording User Actions

```javascript
await crxApp.recorder.show({ mode: 'recording', language: 'playwright-test' });
// User clicks on button in attached page
```

**Detailed Steps:**

```
1. User calls: crxApp.recorder.show({ mode: 'recording' })
   ↓
2. Client (CrxRecorder.show):
   - Sends message: { method: 'showRecorder', params: { mode: 'recording' } }
   ↓
3. Dispatcher (CrxApplicationDispatcher.showRecorder):
   - Calls server: this._object.showRecorder(params)
   ↓
4. Server (CrxApplication.showRecorder):
   - Creates recorder: Recorder.show(context, recorderAppFactory, options)
   ↓
5. Recorder.show:
   - Creates Recorder instance
   - Calls recorderAppFactory → creates CrxRecorderApp
   - Returns recorder
   ↓
6. CrxRecorderApp._createRecorderApp:
   - Creates CrxRecorderApp instance
   - Sets up event listeners
   ↓
7. CrxRecorderApp.open:
   - Creates RecorderWindow (popup or sidepanel)
   - Sets up message handlers
   - Opens window: this._window.open()
   - Sets recorder mode: this._recorder.setMode('recording')
   ↓
8. RecorderWindow.open:
   - Creates popup window or opens sidepanel
   - Waits for port connection
   - UI loads and calls: chrome.runtime.connect()
   - Port established
   ↓
9. Recorder.setMode('recording'):
   - Sends message to all attached pages
   - Injects recorder scripts into pages
   - Sets up event listeners for clicks, inputs, etc.
   ↓
10. User clicks button in page:
    - Injected script captures event
    - Sends to recorder: { type: 'action', action: 'click', selector: '...' }
    ↓
11. Recorder receives action:
    - Determines selector
    - Creates Action object: { name: 'click', selector, ... }
    - Adds to action list
    - Generates code
    ↓
12. Recorder calls: recorderApp.setActions(actions, sources)
    ↓
13. CrxRecorderApp.setActions:
    - Stores actions
    - Generates code for selected language
    - Calls: this.setSources(sources)
    ↓
14. CrxRecorderApp.setSources:
    - Decorates sources with edited code
    - Sends to UI: this._sendMessage({ method: 'setSources', sources })
    ↓
15. RecorderWindow.postMessage:
    - Sends via port: port.postMessage({ type: 'recorder', method: 'setSources', sources })
    ↓
16. UI receives message:
    - Updates CodeMirror editor with new code
    - Highlights new line
    - User sees: await page.click('button');
```

### Flow 3: Playing Recorded Code

```javascript
const code = `
test('my test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.click('button');
});
`;
await crxApp.recorder.run(code);
```

**Detailed Steps:**

```
1. User calls: crxApp.recorder.run(code)
   ↓
2. Client (CrxRecorder.run):
   - Sends message: { method: 'run', params: { code } }
   ↓
3. Dispatcher (CrxApplicationDispatcher.run):
   - Calls server: this._object.run(code)
   ↓
4. Server (CrxApplication.run):
   - Parses code: const [{ actions }] = parse(code)
   - Calls player: this._crx.player.run(this._context, actions)
   ↓
5. Parser (parse):
   - Creates AST: acorn.parse(code)
   - Walks AST looking for test() calls
   - Extracts actions from test body
   - Returns: [{ title, actions, location }]
   ↓
6. CrxPlayer.run:
   - Gets or creates page
   - Clears page aliases
   - Emits 'start' event
   - Loops through actions: for (const action of actions)
   ↓
7. For each action:
   - Sets: this._currAction = action
   - Calls: this._performAction(context, action)
   ↓
8. CrxPlayer._performAction (example: navigate):
   - Creates CallMetadata
   - Calls: context.instrumentation.onBeforeCall(metadata)
   - Executes: mainFrame.goto(metadata, url, { timeout: 5000 })
   - Waits for navigation
   - Calls: context.instrumentation.onAfterCall(metadata)
   ↓
9. Instrumentation callbacks:
   - onBeforeCall → Recorder.onBeforeCall
   - Recorder updates UI: current line highlighted
   - CrxRecorderApp sends message to UI
   ↓
10. mainFrame.goto:
    - Sends CDP: Page.navigate
    - Waits for navigation
    - Returns
    ↓
11. Next action (example: click):
    - Creates CallMetadata
    - onBeforeCall → UI highlights line
    - Builds selector: buildFullSelector(framePath, selector)
    - Executes: mainFrame.click(metadata, selector, options)
    - Waits for element and clicks
    - onAfterCall → UI unhighlights
    ↓
12. Continue until all actions complete:
    - Sets: this._currAction = undefined
    - Calls: this.pause()
    - Emits: 'stop' event
    ↓
13. UI updates:
    - Shows "Playback complete"
    - Unhighlights all lines
    - Enables record button
```

---

## Summary

### Client System Summary

The **client** is what you interact with:
- **Purpose:** Provide user-facing API
- **Location:** Runs in background service worker
- **Objects:** Crx, CrxApplication, CrxRecorder, Page, BrowserContext, etc.
- **Communication:** Sends messages to server via channels
- **Responsibilities:**
  - API surface for users
  - Object lifecycle management
  - Event emission
  - Promise resolution

### Server System Summary

The **server** is the implementation:
- **Purpose:** Execute actual functionality
- **Location:** Runs in background service worker (same process as client!)
- **Objects:** Crx, CrxApplication, CRBrowser, CRBrowserContext, CRPage
- **Communication:** Receives messages from dispatchers
- **Responsibilities:**
  - Chrome debugger management
  - CDP command translation
  - Page/context lifecycle
  - Recorder/player logic

### Recorder System Summary

The **recorder** captures and plays actions:
- **Components:**
  - CrxRecorderApp: Server-side coordinator
  - RecorderWindow: UI (popup or sidepanel)
  - Playwright Recorder: Core recording engine
  - Parser: Code → Actions
  - Player: Actions → Execution
- **Flow:**
  1. User opens recorder
  2. Recorder injects scripts
  3. User actions captured
  4. Code generated
  5. User edits code
  6. Code parsed back to actions
  7. Actions executed via player

### Key Takeaways

1. **Client and Server are in the same process** but maintain separation via message passing
2. **Transport layer** bridges Playwright CDP ↔ Chrome debugger API
3. **Recorder** is a full-featured code generator and player
4. **Everything is async** due to chrome.debugger API limitations
5. **Session management** maps CDP sessions to Chrome tab IDs
6. **Parser enables playback** of edited code without re-recording

This architecture allows Playwright to run in a Chrome extension while maintaining its original design and most of its functionality!
