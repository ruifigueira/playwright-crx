# What Dispatchers Do - Detailed Explanation

## Overview

**Dispatchers** are the bridge between the client API (what you use) and the server implementation (what actually does the work).

Think of dispatchers as **translators and gatekeepers** in a client-server architecture.

---

## The Three Main Jobs of a Dispatcher

### 1. Receive Messages from Client
### 2. Call Server Implementation
### 3. Wrap Results and Send Back

---

## Detailed Example: `crx.start()`

### Step-by-Step Flow

```javascript
// USER CODE
const crxApp = await crx.start({ slowMo: 500 });
```

#### Step 1: Client Sends Message

**File: `src/client/crx.ts:41`**

```typescript
class Crx extends ChannelOwner {
  async start(options?) {
    // Sends message through channel
    const result = await this._channel.start(options ?? {});
    //                            ↑
    //                    This creates a message like:
    //                    {
    //                      guid: 'Crx@abc123',
    //                      method: 'start',
    //                      params: { slowMo: 500 }
    //                    }

    return result.crxApplication;
  }
}
```

**What happens:**
- `this._channel.start()` doesn't directly call anything
- It creates a **message object**
- Message is serialized and sent to the dispatcher connection

---

#### Step 2: Message Routing

**File: `src/index.ts:54`**

```typescript
// This is the message router setup
clientConnection.onmessage = message =>
  setImmediate(() => dispatcherConnection.dispatch(message));
```

**What happens:**
- Message: `{ guid: 'Crx@abc123', method: 'start', params: {...} }`
- Goes to `dispatcherConnection.dispatch(message)`
- Dispatcher connection looks up which dispatcher handles this GUID
- Finds `CrxDispatcher` instance
- Calls `crxDispatcher.start(params)`

---

#### Step 3: Dispatcher Receives Call

**File: `src/server/dispatchers/crxDispatcher.ts:32`**

```typescript
export class CrxDispatcher extends Dispatcher<Crx, channels.CrxChannel, RootDispatcher> {
  _type_Crx = true;

  constructor(scope: RootDispatcher, crx: Crx) {
    super(scope, crx, 'Crx', { });
    //              ↑
    //         This is the SERVER Crx instance stored in this._object
  }

  async start(params: channels.CrxStartParams): Promise<channels.CrxStartResult> {
    console.log('📨 Dispatcher received start() call');
    console.log('📦 Params:', params);

    // THIS IS THE KEY LINE
    // Call the actual server implementation
    const crxApplication = await this._object.start(params);
    //                                ↑
    //                         this._object = server Crx instance

    console.log('✅ Server returned CrxApplication:', crxApplication);

    // Wrap it in a dispatcher so client can talk to it
    const dispatcher = new CrxApplicationDispatcher(this, crxApplication);

    console.log('📮 Sending back dispatcher:', dispatcher._guid);

    return { crxApplication: dispatcher };
  }
}
```

**What the dispatcher does:**

1. **Receives the call**: `start(params)`
2. **Validates parameters**: (done by Playwright's protocol validator)
3. **Calls server**: `this._object.start(params)`
4. **Waits for result**: `await ...`
5. **Wraps result**: `new CrxApplicationDispatcher(...)`
6. **Returns wrapped result**: `{ crxApplication: dispatcher }`

---

#### Step 4: Server Does the Work

**File: `src/server/crx.ts:63`**

```typescript
export class Crx extends SdkObject {

  async start(options?: CrxStartParams): Promise<CrxApplication> {
    console.log('🔧 SERVER: Starting CRX...');

    // Create transport
    this._transport = new CrxTransport();

    // Create browser connection
    this._browserPromise = CRBrowser.connect(
      this.attribution.playwright,
      this._transport,
      browserOptions
    );

    const browser = await this._browserPromise;
    console.log('🔧 SERVER: Browser connected');

    // Create CrxApplication
    const crxApp = new CrxApplication(this, context, transport);
    console.log('🔧 SERVER: Created CrxApplication');

    return crxApp;
    //     ↑
    //  This is the ACTUAL server object
  }
}
```

**What the server does:**
- Creates `CrxTransport`
- Connects to browser via `chrome.debugger`
- Creates `CrxApplication` instance
- Returns it

---

#### Step 5: Dispatcher Wraps Result

**Back in: `src/server/dispatchers/crxDispatcher.ts:32`**

```typescript
async start(params) {
  // Server returned CrxApplication instance
  const crxApplication = await this._object.start(params);

  // Create dispatcher to wrap it
  const dispatcher = new CrxApplicationDispatcher(this, crxApplication);
  //                                                      ↑
  //                                        Wraps the server object

  return { crxApplication: dispatcher };
  //                        ↑
  //              This dispatcher has a GUID like 'CrxApplication@xyz789'
}
```

**What wrapping does:**

```typescript
class CrxApplicationDispatcher extends Dispatcher {
  constructor(scope, crxApplication) {
    super(scope, crxApplication, 'CrxApplication', {
      context: new BrowserContextDispatcher(scope, crxApplication._context)
    });
    //  ↑
    //  Assigns a unique GUID to this dispatcher
    //  Stores the server object in this._object
    //  Registers dispatcher in the dispatcher registry

    // Set up event forwarding
    this.addObjectListener(CrxApplication.Events.Attached, ({ tabId, page }) => {
      this._dispatchEvent('attached', {
        tabId,
        page: PageDispatcher.from(this._context, page)
      });
    });
  }
}
```

---

#### Step 6: Dispatcher Sends Response

The dispatcher sends a response message back:

```javascript
{
  id: 'original-message-id',
  result: {
    crxApplication: {
      guid: 'CrxApplication@xyz789',
      type: 'CrxApplication'
    }
  }
}
```

---

#### Step 7: Client Creates Object

**File: `src/client/crxConnection.ts:29`**

```typescript
class CrxConnection extends Connection {
  dispatch(message: object): void {
    const { guid: parentGuid, method, params } = message as any;

    if (method === '__create__') {
      // Server told us to create a client object
      const { type, guid } = params;

      switch (type) {
        case 'CrxApplication':
          new CrxApplication(parent, type, guid, initializer);
          //  ↑
          //  Creates client-side CrxApplication object
          //  Stores it in registry with GUID 'CrxApplication@xyz789'
          return;
      }
    }
  }
}
```

**What happens:**
- Client receives response with GUID
- Client creates `CrxApplication` instance
- Stores it in object registry
- Future calls to this object use this GUID

---

#### Step 8: User Gets Result

```javascript
const crxApp = await crx.start({ slowMo: 500 });
//     ↑
//  This is the CLIENT CrxApplication object
//  It has a _guid property: 'CrxApplication@xyz789'
//  When you call methods on it, they send messages with this GUID
```

---

## Why Do We Need Dispatchers?

### 1. **Object Lifecycle Management**

Dispatchers track which objects exist:

```typescript
class Dispatcher {
  constructor(scope, object, type, initializer) {
    this._guid = `${type}@${createGuid()}`;
    this._object = object;  // The actual server object

    // Register in dispatcher registry
    scope._dispatcherByGuid.set(this._guid, this);

    // Tell client to create matching object
    scope._sendCreate(this._guid, type, initializer);
  }
}
```

### 2. **Method Routing**

When client calls a method:

```javascript
await crxApp.attach(123);
```

Message sent:
```javascript
{
  guid: 'CrxApplication@xyz789',
  method: 'attach',
  params: { tabId: 123 }
}
```

Dispatcher finds handler:
```typescript
// Dispatcher registry looks up GUID
const dispatcher = dispatcherByGuid.get('CrxApplication@xyz789');
// Calls the method
dispatcher.attach({ tabId: 123 });
```

### 3. **Event Forwarding**

Server emits event:
```typescript
// Server side
crxApplication.emit(CrxApplication.Events.Attached, { page, tabId });
```

Dispatcher catches it:
```typescript
class CrxApplicationDispatcher {
  constructor(scope, crxApplication) {
    // Listen to server events
    this.addObjectListener(CrxApplication.Events.Attached, ({ page, tabId }) => {
      // Forward to client with wrapped objects
      this._dispatchEvent('attached', {
        tabId,
        page: PageDispatcher.from(this._context, page)
        //    ↑
        //   Wrap page in PageDispatcher so client can reference it
      });
    });
  }
}
```

Client receives event:
```typescript
// Client side
crxApp.on('attached', ({ page, tabId }) => {
  console.log('Page attached!', page.url());
});
```

### 4. **Serialization**

Dispatchers handle converting server objects to client references:

```typescript
// Server has: CrxApplication instance (object in memory)
// Client needs: Reference to call methods on it
// Dispatcher provides: GUID that both sides understand

// Server → Dispatcher → Client
CrxApplication (object) → CrxApplicationDispatcher → { guid: 'CrxApplication@xyz789' }
```

---

## Complete Message Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│  USER CODE                                              │
│  const crxApp = await crx.start({ slowMo: 500 });      │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT (src/client/crx.ts)                             │
│  async start(options) {                                 │
│    return await this._channel.start(options);           │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  MESSAGE CREATED                                        │
│  {                                                       │
│    guid: 'Crx@abc123',                                  │
│    method: 'start',                                     │
│    params: { slowMo: 500 }                              │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT CONNECTION (src/client/crxConnection.ts)        │
│  Sends message via onmessage handler                    │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  MESSAGE ROUTING (src/index.ts:54)                      │
│  setImmediate(() => dispatcherConnection.dispatch())    │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  DISPATCHER CONNECTION                                  │
│  Looks up dispatcher by GUID                            │
│  Finds: CrxDispatcher                                   │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  DISPATCHER (src/server/dispatchers/crxDispatcher.ts)   │
│  async start(params) {                                  │
│    ┌─────────────────────────────────────────────┐     │
│    │ 1. Validate params                          │     │
│    │ 2. Call: this._object.start(params)         │     │
│    │ 3. Wait for server to finish                │     │
│    │ 4. Wrap result in CrxApplicationDispatcher  │     │
│    │ 5. Return wrapped result                    │     │
│    └─────────────────────────────────────────────┘     │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  SERVER (src/server/crx.ts)                             │
│  async start(options) {                                 │
│    // Create transport                                  │
│    this._transport = new CrxTransport();                │
│    // Connect browser                                   │
│    const browser = await CRBrowser.connect(...);        │
│    // Create CrxApplication                             │
│    const crxApp = new CrxApplication(...);              │
│    return crxApp;                                       │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  DISPATCHER WRAPS RESULT                                │
│  const dispatcher = new CrxApplicationDispatcher(       │
│    this,                                                │
│    crxApp  ← server object                             │
│  );                                                      │
│  return { crxApplication: dispatcher };                 │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  RESPONSE MESSAGE CREATED                               │
│  {                                                       │
│    id: 'message-id',                                    │
│    result: {                                            │
│      crxApplication: {                                  │
│        guid: 'CrxApplication@xyz789',                   │
│        type: 'CrxApplication',                          │
│        initializer: {                                   │
│          context: { guid: 'BrowserContext@...' }        │
│        }                                                 │
│      }                                                   │
│    }                                                     │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  DISPATCHER CONNECTION SENDS BACK                       │
│  dispatcherConnection.onmessage(response)               │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT CONNECTION RECEIVES                             │
│  clientConnection.dispatch(response)                    │
│  Creates __create__ message                             │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  CLIENT CREATES OBJECT (src/client/crxConnection.ts)    │
│  if (method === '__create__' && type === 'CrxApp...') { │
│    new CrxApplication(parent, type, guid, initializer); │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  USER GETS RESULT                                       │
│  const crxApp = ... ← Client CrxApplication object      │
└─────────────────────────────────────────────────────────┘
```

---

## Key Dispatcher Responsibilities

### 1. **Parameter Validation**
```typescript
// Ensures params match expected schema
const validator = findValidator('CrxStartParams');
validator(params);
```

### 2. **Calling Server Methods**
```typescript
const result = await this._object.start(params);
//                   ↑
//              Server implementation
```

### 3. **Wrapping Results**
```typescript
// If result contains objects, wrap them in dispatchers
return {
  crxApplication: new CrxApplicationDispatcher(this, result)
};
```

### 4. **Forwarding Events**
```typescript
this.addObjectListener('eventName', (data) => {
  this._dispatchEvent('eventName', data);
});
```

### 5. **Object Cleanup**
```typescript
async close() {
  await this._object.close();
  this._dispose();  // Removes from dispatcher registry
}
```

---

## Summary

**What Dispatcher Does:**

1. ✅ **Receives** method calls from client
2. ✅ **Validates** parameters
3. ✅ **Calls** actual server implementation (`this._object.methodName()`)
4. ✅ **Wraps** server objects in dispatchers
5. ✅ **Sends** results back to client
6. ✅ **Forwards** events from server to client
7. ✅ **Manages** object lifecycle

**In One Sentence:**
> Dispatchers are **remote procedure call handlers** that receive messages from the client, invoke server methods, and return wrapped results.

**Why It's Needed:**
- Client and server are separated (even though in same process)
- Need way to reference server objects from client
- Need way to route method calls to correct objects
- Need way to serialize/deserialize complex objects
- Need way to forward events across the boundary

The dispatcher pattern is what makes Playwright's client-server architecture work!
