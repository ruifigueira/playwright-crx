# Screenshot Feature

## Overview

The Playwright CRX recorder now automatically takes screenshots and **downloads them to your Downloads folder** whenever a Playwright action is recorded (clicks, fills, navigations, etc.).

## How It Works

When you record actions using the Playwright CRX extension, the system now:

1. **Detects New Actions**: Monitors when new actions are added to the recording
2. **Takes Screenshots**: Automatically captures a screenshot of the active page for each action
3. **Downloads to Disk**: Saves screenshots directly to your Downloads folder with timestamps and action names

## Implementation Details

### Location
Screenshots are automatically downloaded to:
```
~/Downloads/playwright-screenshots/
```

### Filename Format
```
screenshot-{actionName}-{timestamp}.png
```

Example:
```
screenshot-click-2025-01-09T12-34-56-789Z.png
screenshot-fill-2025-01-09T12-34-58-123Z.png
screenshot-navigate-2025-01-09T12-35-00-456Z.png
```

### Code Changes

**File: `src/server/recorder/crxRecorderApp.ts`**

Added:
- `_previousActionsCount`: Tracks the number of actions to detect new ones
- `setActions()`: Enhanced to detect and capture screenshots for new actions
- `_takeScreenshotForAction()`: Takes a screenshot and downloads it to disk

**File: `examples/recorder-crx/public/manifest.json`**

Added permission:
- `"downloads"`: Required for downloading screenshots to disk

## How to Use

1. **Reload Extension**: After updating, reload the extension in Chrome
2. **Start Recording**: Open the Playwright CRX recorder and start recording actions
3. **Perform Actions**: Click, fill forms, navigate - each action automatically downloads a screenshot
4. **Find Screenshots**: Check your `Downloads/playwright-screenshots/` folder

## Accessing Screenshots

Screenshots are automatically saved to your Downloads folder! No code needed - just:

1. Open your Downloads folder
2. Look for the `playwright-screenshots` subfolder
3. Screenshots are named with action type and timestamp

Example path:
```
~/Downloads/playwright-screenshots/screenshot-click-2025-01-09T12-34-56-789Z.png
~/Downloads/playwright-screenshots/screenshot-fill-2025-01-09T12-35-00-123Z.png
```

## Error Handling

- If screenshot capture fails, it silently continues without breaking the recording
- Recording continues normally even if screenshots fail
- Errors are caught and suppressed to ensure a smooth recording experience

## Next Steps

To enhance this feature, you could:

1. ✅ **Auto-download to disk** - DONE! Screenshots now download automatically
2. **Link to Actions**: Create a JSON manifest linking screenshots to specific actions
3. **Thumbnail Preview**: Show screenshot thumbnails in the recorder UI
4. **Configurable**: Add settings to enable/disable screenshot capture
5. **Selective Capture**: Only capture screenshots for specific action types (e.g., only clicks)
6. **Custom Location**: Allow users to choose download folder
7. **Organize by Session**: Create timestamped folders for each recording session

## Example Usage

```javascript
// Start the recorder
const crxApp = await crx.start();
await crxApp.recorder.show({ mode: 'recording' });

// Attach to a tab
const page = await crxApp.attach(tabId);

// Perform actions - screenshots are captured and downloaded automatically!
await page.click('button');        // → Downloads screenshot-click-2025-...png
await page.fill('input', 'test');  // → Downloads screenshot-fill-2025-...png
await page.goto('https://example.com'); // → Downloads screenshot-navigate-2025-...png

// Check your Downloads/playwright-screenshots/ folder!
```

## What You'll See

After recording 3 actions (click, fill, navigate), your Downloads folder will have:

```
Downloads/
  └── playwright-screenshots/
      ├── screenshot-click-2025-01-09T12-34-56-789Z.png
      ├── screenshot-fill-2025-01-09T12-35-00-123Z.png
      └── screenshot-navigate-2025-01-09T12-35-02-456Z.png
```

## Technical Notes

- Screenshots are taken of the **first page** in the browser context (usually the active/attached page)
- In multi-page scenarios, you may want to enhance the code to match the `pageAlias` to find the correct page
- Screenshots are saved as PNG files with base64 encoding
- Downloads happen asynchronously and don't block the recording
- Chrome's downloads API automatically creates the `playwright-screenshots` subfolder
