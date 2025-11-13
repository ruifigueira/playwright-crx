# How to Remove Play Functionality - Keep Recording Only

This guide shows you how to disable/remove the player functionality from Playwright CRX, keeping only the recorder.

---

## Overview of What Needs to Change

The play functionality exists in three layers:

1. **UI Layer** - Play/Pause buttons in the recorder window
2. **CrxRecorderApp** - Handles play events and code execution
3. **CrxPlayer** - Executes recorded actions

---

## Option 1: Quick Disable (Keep Code, Hide UI)

This approach keeps all the code but hides/disables the player UI.

### Step 1: Disable Player in CrxRecorderApp

**File: `src/server/recorder/crxRecorderApp.ts`**

Find the `_onMessage` method (line 205) and disable play handling:

```typescript
private _onMessage({ type, event, params }: RecorderEventData) {
  if (type === 'recorderEvent') {
    switch (event) {
      case 'fileChanged':
        this._filename = params.file;
        if (this._editedCode?.hasErrors()) {
          this._updateCode(null);
          if (this._sources)
            this.setSources(this._sources);
        }
        break;

      case 'codeChanged':
        this._updateCode(params.code);
        break;

      case 'cursorActivity':
        this._currentCursorPosition = params.position;
        this._updateLocator(this._currentCursorPosition);
        break;

      // DISABLE THESE CASES - Comment them out
      // case 'resume':
      // case 'step':
      //   this._run().catch(() => {});
      //   break;

      case 'setMode':
        const { mode } = params;
        if (this._mode !== mode) {
          this._mode = mode;
          this.emit('modeChanged', { mode });
        }
        break;
    }

    this.emit('event', { event, params });
  }
}
```

### Step 2: Disable Player Integration

**Same file: `src/server/recorder/crxRecorderApp.ts`**

Comment out the player listener in constructor (line 71):

```typescript
constructor(crx: Crx, recorder: Recorder) {
  super();
  this._crx = crx;
  this._recorder = recorder;

  // COMMENT OUT PLAYER INTEGRATION
  // this._crx.player.on('start', () => {
  //   this._recorder.clearErrors();
  //   this.resetCallLogs().catch(() => {});
  // });
}
```

### Step 3: Hide Play UI Elements

The recorder UI is in `examples/recorder-crx/src/`. You need to modify the React components.

**File: `examples/recorder-crx/src/crxRecorder.tsx`**

Find where the play/pause controls are rendered and hide them with CSS or conditional rendering.

Look for something like:

```tsx
// Around line 150-200 in the recorder UI
<Toolbar>
  <RecordButton />
  <InspectButton />
  {/* HIDE THESE */}
  {/* <PlayButton />
  <PauseButton />
  <StepButton /> */}
</Toolbar>
```

Or add CSS to hide them:

```css
/* In examples/recorder-crx/src/crxRecorder.css */
.toolbar-item.play-button,
.toolbar-item.pause-button,
.toolbar-item.step-button {
  display: none !important;
}
```

---

## Option 2: Complete Removal (Remove Code)

This completely removes player code from the codebase.

### Step 1: Remove Player from Crx Class

**File: `src/server/crx.ts`**

Remove player property (line 56):

```typescript
export class Crx extends SdkObject {
  private _transport?: CrxTransport;
  private _browserPromise?: Promise<CRBrowser>;
  private _crxApplicationPromise: Promise<CrxApplication> | undefined;
  private _incognitoCrxApplicationPromise: Promise<CrxApplication> | undefined;
  // DELETE THIS LINE:
  // readonly player: CrxPlayer;

  constructor(playwright: Playwright) {
    super(playwright, 'crx');
    // DELETE THIS LINE:
    // this.player = new CrxPlayer(this);
  }

  // ... rest of code
}
```

### Step 2: Remove Player Event Handlers from CrxRecorderApp

**File: `src/server/recorder/crxRecorderApp.ts`**

Remove player-related code from constructor:

```typescript
constructor(crx: Crx, recorder: Recorder) {
  super();
  this._crx = crx;
  this._recorder = recorder;

  // DELETE THESE LINES:
  // this._crx.player.on('start', () => {
  //   this._recorder.clearErrors();
  //   this.resetCallLogs().catch(() => {});
  // });
}
```

Remove the `_run` method entirely:

```typescript
// DELETE THIS ENTIRE METHOD (line 241-251):
// private async _run() {
//   if (this._crx.player.isPlaying())
//     return;
//   const incognito = this._playInIncognito;
//   if (incognito) {
//     const incognitoCrxApp = await this._crx.get({ incognito });
//     await incognitoCrxApp?.close({ closeWindows: true });
//   }
//   const crxApp = await this._crx.get({ incognito }) ?? await this._crx.start({ incognito }, serverSideCallMetadata());
//   await this._crx.player.run(crxApp._context, this._getActions());
// }
```

Remove play/pause handling from `_onMessage`:

```typescript
private _onMessage({ type, event, params }: RecorderEventData) {
  if (type === 'recorderEvent') {
    switch (event) {
      case 'fileChanged':
        // ... keep this
        break;

      case 'codeChanged':
        // ... keep this
        break;

      case 'cursorActivity':
        // ... keep this
        break;

      // DELETE THESE CASES:
      // case 'resume':
      // case 'step':
      //   this._run().catch(() => {});
      //   break;

      case 'setMode':
        // ... keep this
        break;
    }

    this.emit('event', { event, params });
  }
}
```

Remove mode change player handling from `setMode`:

```typescript
async setMode(mode: Mode) {
  // DELETE THESE LINES:
  // if (!this._recorder._isRecording())
  //   this._crx.player.pause().catch(() => {});
  // else
  //   this._crx.player.stop().catch(() => {});

  if (this._mode !== mode) {
    this._mode = mode;
    this.emit('modeChanged', { mode });
  }
  this._sendMessage({ type: 'recorder', method: 'setMode', mode });
}
```

### Step 3: Remove Player-Related Properties

**File: `src/server/recorder/crxRecorderApp.ts`**

Remove these properties from the class:

```typescript
export class CrxRecorderApp extends EventEmitter implements IRecorderApp {
  readonly wsEndpointForTest: string | undefined;
  private _crx: Crx;
  readonly _recorder: Recorder;
  private _filename?: string;
  private _sources?: Source[];
  private _mode: Mode = 'none';
  private _window?: RecorderWindow;
  private _editedCode?: EditedCode;
  private _recordedActions: ActionInContextWithLocation[] = [];
  // DELETE THIS:
  // private _playInIncognito = false;
  private _currentCursorPosition: { line: number } | undefined;

  // ... in open() method, DELETE THIS:
  async open(options?: channels.CrxApplicationShowRecorderParams) {
    // ...
    // DELETE THIS LINE:
    // this._playInIncognito = options?.playInIncognito ?? false;
    // ...
  }
}
```

### Step 4: Remove run(), load(), list() from CrxApplication

**File: `src/server/crx.ts`**

Remove these methods from CrxApplication class:

```typescript
export class CrxApplication extends SdkObject {
  // ... other code ...

  // DELETE THESE METHODS:
  // list(code: string) {
  //   const tests = parse(code);
  //   return tests.map(({ title, options, location }) => ({ title, options, location }));
  // }

  // load(code: string) {
  //   this._recorderApp?.load(code);
  // }

  // async run(code: string, page?: Page) {
  //   const [{ actions }] = parse(code);
  //   await this._crx.player.run(page ?? this._context, actions);
  // }

  // async parseForTest(originCode: string) {
  //   const [{ actions, options }] = parse(originCode);
  //   const jsLanguage = [...languageSet()].find(l => l.id === 'playwright-test');
  //   const code = generateCode(actions, jsLanguage!, { browserName: '', launchOptions: {}, contextOptions: {}, ...options } as LanguageGeneratorOptions).text;
  //   return { actions, options, code };
  // }
}
```

### Step 5: Remove Client-Side Player Methods

**File: `src/client/crx.ts`**

Remove run(), load(), list() from CrxRecorder:

```typescript
export class CrxRecorder extends EventEmitter implements api.CrxRecorder {
  // ... other code ...

  // DELETE THESE METHODS:
  // async list(code: string) {
  //   const { tests } = await this._channel.list({ code });
  //   return tests;
  // }

  // async load(code: string) {
  //   await this._channel.load({ code });
  // }

  // async run(code: string, page?: Page): Promise<void> {
  //   await this._channel.run({ code, page: page?._channel });
  // }
}
```

### Step 6: Remove Dispatcher Methods

**File: `src/server/dispatchers/crxDispatcher.ts`**

Remove these methods from CrxApplicationDispatcher:

```typescript
export class CrxApplicationDispatcher extends Dispatcher {
  // ... other code ...

  // DELETE THESE METHODS:
  // async list(params: channels.CrxApplicationListParams): Promise<channels.CrxApplicationListResult> {
  //   const tests = this._object.list(params.code);
  //   return { tests };
  // }

  // async load(params: channels.CrxApplicationLoadParams): Promise<channels.CrxApplicationLoadResult> {
  //   this._object.load(params.code);
  // }

  // async run(params: channels.CrxApplicationRunParams): Promise<void> {
  //   await this._object.run(params.code, (params.page as PageDispatcher)?._object);
  // }
}
```

### Step 7: Remove Player File Entirely

**Delete file: `src/server/recorder/crxPlayer.ts`**

```bash
rm src/server/recorder/crxPlayer.ts
```

### Step 8: Remove Parser (Optional)

If you remove the player, you don't need the parser either.

**Delete file: `src/server/recorder/parser.ts`**

```bash
rm src/server/recorder/parser.ts
```

### Step 9: Update Channel Definitions

**File: `src/protocol/channels.ts`**

Remove player-related channel methods:

```typescript
export interface CrxApplicationChannel extends CrxApplicationEventTarget, Channel {
  _type_CrxApplication: boolean;
  attach(params: CrxApplicationAttachParams, metadata?: CallMetadata): Promise<CrxApplicationAttachResult>;
  attachAll(params: CrxApplicationAttachAllParams, metadata?: CallMetadata): Promise<CrxApplicationAttachAllResult>;
  detach(params: CrxApplicationDetachParams, metadata?: CallMetadata): Promise<CrxApplicationDetachResult>;
  detachAll(params?: CrxApplicationDetachAllParams, metadata?: CallMetadata): Promise<CrxApplicationDetachAllResult>;
  newPage(params: CrxApplicationNewPageParams, metadata?: CallMetadata): Promise<CrxApplicationNewPageResult>;
  showRecorder(params: CrxApplicationShowRecorderParams, metadata?: CallMetadata): Promise<CrxApplicationShowRecorderResult>;
  hideRecorder(params?: CrxApplicationHideRecorderParams, metadata?: CallMetadata): Promise<CrxApplicationHideRecorderResult>;
  setMode(params: CrxApplicationSetModeParams, metadata?: CallMetadata): Promise<CrxApplicationSetModeResult>;
  close(params?: CrxApplicationCloseParams, metadata?: CallMetadata): Promise<CrxApplicationCloseResult>;

  // DELETE THESE:
  // list(params?: CrxApplicationListParams, metadata?: CallMetadata): Promise<CrxApplicationListResult>;
  // load(params?: CrxApplicationLoadParams, metadata?: CallMetadata): Promise<CrxApplicationLoadResult>;
  // run(params?: CrxApplicationRunParams, metadata?: CallMetadata): Promise<CrxApplicationRunResult>;
}

// DELETE THESE TYPE DEFINITIONS:
// export type CrxApplicationListParams = { code: string };
// export type CrxApplicationListOptions = { code: string };
// export type CrxApplicationListResult = { ... };
// export type CrxApplicationLoadParams = { code: string };
// export type CrxApplicationLoadOptions = { code: string };
// export type CrxApplicationLoadResult = void;
// export type CrxApplicationRunParams = { page?: PageChannel, code: string };
// export type CrxApplicationRunOptions = { page?: PageChannel, code: string};
// export type CrxApplicationRunResult = void;
```

### Step 10: Remove from Type Definitions

**File: `src/types/types.d.ts`**

Remove player methods from CrxRecorder interface:

```typescript
export interface CrxRecorder extends EventEmitter {
  mode(): Mode;
  isHidden(): boolean;
  setMode(mode: Mode): Promise<void>;
  show(options?: CrxApplicationShowRecorderOptions): Promise<void>;
  hide(): Promise<void>;

  // DELETE THESE:
  // list(code: string): Promise<Array<{ ... }>>;
  // load(code: string): Promise<void>;
  // run(code: string, page?: Page): Promise<void>;
}
```

---

## Option 3: Minimal Changes (Recommended)

If you just want to hide the play button from users but keep the code for future use:

### Single File Change

**File: `examples/recorder-crx/src/crxRecorder.tsx`**

Find the toolbar section and hide play controls:

```tsx
// Look for something like this:
const Toolbar = () => {
  return (
    <div className="toolbar">
      <button onClick={handleRecord}>Record</button>
      <button onClick={handleInspect}>Inspect</button>

      {/* ADD THIS CONDITION TO HIDE PLAY CONTROLS */}
      {false && (
        <>
          <button onClick={handlePlay}>Play</button>
          <button onClick={handlePause}>Pause</button>
          <button onClick={handleStep}>Step</button>
        </>
      )}
    </div>
  );
};
```

Or add CSS:

**File: `examples/recorder-crx/src/crxRecorder.css`**

```css
/* Hide all play controls */
.action-button[title="Resume (F8)"],
.action-button[title="Pause (F8)"],
.action-button[title="Step over (F10)"] {
  display: none !important;
}
```

---

## Testing After Changes

### Test Recording Still Works

```javascript
// In extension background script
const crxApp = await crx.start();
await crxApp.recorder.show({ mode: 'recording' });

// Click extension icon → Recorder should open
// Click Record button → Should start recording
// Interact with page → Actions should be recorded
// See generated code → Should appear in editor
```

### Verify Play is Disabled

```javascript
// Try to call play methods - should not exist or do nothing
await crxApp.recorder.run(code); // Should error or be undefined

// In UI - play buttons should be hidden
// Code editor should still work
// Can still copy/paste generated code
```

---

## Summary

### Quick Disable (Option 1)
- ✅ Fastest approach
- ✅ Easy to reverse
- ✅ Just hide UI elements
- ❌ Code still in bundle

### Complete Removal (Option 2)
- ✅ Smallest bundle size
- ✅ No player code at all
- ❌ More files to modify
- ❌ Harder to reverse

### Minimal Changes (Option 3 - RECOMMENDED)
- ✅ One or two files
- ✅ Easy to reverse
- ✅ Keep code for future
- ✅ Just hide from users

---

## Files Modified by Approach

### Option 1 (Quick Disable)
```
src/server/recorder/crxRecorderApp.ts  (2 changes)
examples/recorder-crx/src/crxRecorder.css  (1 CSS rule)
```

### Option 2 (Complete Removal)
```
src/server/crx.ts
src/server/recorder/crxRecorderApp.ts
src/server/recorder/crxPlayer.ts (DELETE)
src/server/recorder/parser.ts (DELETE)
src/client/crx.ts
src/server/dispatchers/crxDispatcher.ts
src/protocol/channels.ts
src/types/types.d.ts
examples/recorder-crx/src/crxRecorder.tsx
```

### Option 3 (Minimal - RECOMMENDED)
```
examples/recorder-crx/src/crxRecorder.css  (3 CSS rules)
```

Choose based on your needs!
