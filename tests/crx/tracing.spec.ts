/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './crxTest';

// adapted from playwright/tests/library/tracing.spec.ts

test('should collect trace with resources, but no js', async ({ runCrxTestAndParseTraceRaw }) => {
  const { events, actions } = await runCrxTestAndParseTraceRaw(async ({ crxApp, context, server }) => {
    const page = await crxApp.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.PREFIX + '/frames/frame.html');
    await page.setContent('<button>Click</button>');
    await page.click('"Click"');
    await page.mouse.move(20, 20);
    await page.mouse.dblclick(30, 30);
    await page.keyboard.insertText('abc');
    await page.goto(server.PREFIX + '/input/fileupload.html');
    await page.locator('input[type="file"]').setInputFiles({ name: 'file.txt', buffer: Buffer.from('file content'), mimeType: 'text/plain' });
    await page.waitForTimeout(2000);  // Give it some time to produce screenshots.
    await page.close();
    await context.tracing.stop({ path: 'trace.zip' });
  });

  expect(events[0].type).toBe('context-options');
  expect(actions).toEqual([
    'Frame.goto',
    'Frame.setContent',
    'Frame.click',
    'Page.mouseMove',
    'Page.mouseClick',
    'Page.keyboardInsertText',
    'Frame.goto',
    'Frame.setInputFiles',
    'Frame.waitForTimeout',
    'Page.close',
  ]);

  expect(events.some(e => e.type === 'frame-snapshot')).toBeTruthy();
  expect(events.some(e => e.type === 'screencast-frame')).toBeTruthy();
  const style = events.find(e => e.type === 'resource-snapshot' && e.snapshot.request.url.endsWith('style.css'));
  expect(style).toBeTruthy();
  expect(style.snapshot.response.content._sha1).toBeTruthy();
  const script = events.find(e => e.type === 'resource-snapshot' && e.snapshot.request.url.endsWith('script.js'));
  expect(script).toBeTruthy();
  expect(script.snapshot.response.content._sha1).toBe(undefined);
});

test('should not collect snapshots by default', async ({ runCrxTestAndParseTraceRaw }) => {
  const { events } = await runCrxTestAndParseTraceRaw(async ({ crxApp, context, server }) => {
    const page = await crxApp.newPage();
    await context.tracing.start();
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<button>Click</button>');
    await page.click('"Click"');
    await page.close();
    await context.tracing.stop({ path: 'trace.zip' });
  });

  expect(events.some(e => e.type === 'frame-snapshot')).toBeFalsy();
  expect(events.some(e => e.type === 'resource-snapshot')).toBeFalsy();
});

test('can call tracing.group/groupEnd at any time and auto-close', async ({ runCrxTestAndParseTraceRaw }) => {
  const { events } = await runCrxTestAndParseTraceRaw(async ({ page, context, server }) => {
    await context.tracing.group('ignored');
    await context.tracing.groupEnd();
    await context.tracing.group('ignored2');

    await context.tracing.start();
    await context.tracing.group('actual');
    await page.goto(server.EMPTY_PAGE);
    await context.tracing.stopChunk({ path: 'trace.zip' });

    await context.tracing.group('ignored3');
    await context.tracing.groupEnd();
    await context.tracing.groupEnd();
    await context.tracing.groupEnd();
  });

  const groups = events.filter(e => e.method === 'tracingGroup');
  expect(groups).toHaveLength(1);
  expect(groups[0].title).toBe('actual');
  expect(events.some(e => e.type === 'after' && e.callId === groups[0].callId)).toBe(true);
});

test('should not include buffers in the trace', async ({ runCrxTestAndParseTraceRaw }) => {
  const { actionObjects } = await runCrxTestAndParseTraceRaw(async ({ page, context, server }) => {
    await context.tracing.start({ snapshots: true });
    await page.goto(server.PREFIX + '/empty.html');
    await page.screenshot();
    await context.tracing.stop({ path: 'trace.zip' });
  });

  const screenshotEvent = actionObjects.find(a => a.method === 'screenshot')!;
  expect(screenshotEvent.beforeSnapshot).toBeTruthy();
  expect(screenshotEvent.afterSnapshot).toBeTruthy();
  expect(screenshotEvent.result).toEqual({
    'binary': '<Buffer>',
  });
});


test('should exclude internal pages', async ({ runCrxTestAndParseTraceRaw }) => {
  const trace = await runCrxTestAndParseTraceRaw(async ({ crxApp, context, server }) => {
    const page = await crxApp.newPage();
    await page.goto(server.EMPTY_PAGE);

    await context.tracing.start();
    await context.storageState();
    await page.close();
    await context.tracing.stop({ path: 'trace.zip' });
  });

  const pageIds = new Set();
  trace.events.forEach(e => {
    const pageId = e.pageId;
    if (pageId)
      pageIds.add(pageId);
  });
  expect(pageIds.size).toBe(1);
});

test('should collect two traces', async ({ runCrxTest, runCrxTestAndParseTraceRaw }) => {
  await runCrxTest(async ({ crxApp, context, server }) => {
    const page = await crxApp.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<button>Click</button>');
    await page.click('"Click"');
    await context.tracing.stop({ path: 'trace1.zip' });

    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.dblclick('"Click"');
    await page.close();
    await context.tracing.stop({ path: 'trace2.zip' });
  });

  {
    const { events, actions } = await runCrxTestAndParseTraceRaw(async () => 'trace1.zip');
    expect(events[0].type).toBe('context-options');
    expect(actions).toEqual([
      'Frame.goto',
      'Frame.setContent',
      'Frame.click',
    ]);
  }

  {
    const { events, actions } = await runCrxTestAndParseTraceRaw(async () => 'trace2.zip');
    expect(events[0].type).toBe('context-options');
    expect(actions).toEqual([
      'Frame.dblclick',
      'Page.close',
    ]);
  }
});

test('should not include trace resources from the previous chunks', async ({ runCrxTest, runCrxTestAndParseTraceRaw }) => {
  await runCrxTest(async ({ page, context, server }) => {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    await context.tracing.startChunk();
    await page.goto(server.EMPTY_PAGE);
    await page.setContent(`
      <style>
        @keyframes move {
          from { marign-left: 0; }
          to   { margin-left: 1000px; }
        }
        button {
          animation: 20s linear move;
          animation-iteration-count: infinite;
        }
      </style>
      <button>Click</button>
    `);
    await page.click('"Click"', { force: true });
    // Give it enough time for both screenshots to get into the trace.
    await new Promise(f => setTimeout(f, 3000));
    await context.tracing.stopChunk({ path: 'trace1.zip' });

    await context.tracing.startChunk();
    await context.tracing.stopChunk({ path: 'trace2.zip' });
  });

  let jpegs: string[] = [];
  {
    const { resources } = await runCrxTestAndParseTraceRaw(async () => 'trace1.zip');
    const names = Array.from(resources.keys());
    expect(names.filter(n => n.endsWith('.html')).length).toBe(1);
    jpegs = names.filter(n => n.endsWith('.jpeg'));
    expect(jpegs.length).toBeGreaterThan(0);
  }

  {
    const { resources } = await runCrxTestAndParseTraceRaw(async () => 'trace2.zip');
    const names = Array.from(resources.keys());
    // 1 network resource should be preserved.
    expect(names.filter(n => n.endsWith('.html')).length).toBe(1);
    // screenshots from the previous chunk should not be preserved.
    expect(names.filter(n => jpegs.includes(n)).length).toBe(0);
  }
});

test('should overwrite existing file', async ({ runCrxTest, runCrxTestAndParseTraceRaw }) => {
  await runCrxTest(async ({ page, context, server }) => {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<button>Click</button>');
    await page.click('"Click"');
    await context.tracing.stop({ path: 'trace1.zip' });
  });
  {
    const { resources } = await runCrxTestAndParseTraceRaw(async () => 'trace1.zip');
    const names = Array.from(resources.keys());
    expect(names.filter(n => n.endsWith('.html')).length).toBe(1);
  }

  await runCrxTest(async ({ context }) => {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await context.tracing.stop({ path: 'trace1.zip' });
  });
  {
    const { resources } = await runCrxTestAndParseTraceRaw(async () => 'trace1.zip');
    const names = Array.from(resources.keys());
    expect(names.filter(n => n.endsWith('.html')).length).toBe(0);
  }
});

test('should not stall on dialogs', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, context, server }) => {
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.EMPTY_PAGE);

    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.evaluate(() => {
      confirm('are you sure');
    });
    await context.tracing.stop();
  });
});


test('should include interrupted actions', async ({ context, runCrxTestAndParseTraceRaw }) => {
  const { events } = await runCrxTestAndParseTraceRaw(async ({ page, context, server }) => {
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<button>Click</button>');
    page.click('"ClickNoButton"').catch(() =>  {});
    await context.tracing.stop({ path: 'trace.zip' });
  });
  await context.close();
  const clickEvent = events.find(e => e.class === 'Frame' && e.method === 'click');
  expect(clickEvent).toBeTruthy();
});

test('should throw when starting with different options', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, expect }) => {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const error = await context.tracing.start({ screenshots: false, snapshots: false }).catch(e => e);
    expect(error.message).toContain('Tracing has been already started');
  });
});

test('should throw when stopping without start', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, expect }) => {
    const error = await context.tracing.stop({ path: 'trace.zip' }).catch(e => e);
    expect(error.message).toContain('Must start tracing before stopping');
  });
});

test('should not throw when stopping without start but not exporting', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context }) => {
    await context.tracing.stop();
  });
});

test.fixme('should work with multiple chunks', async ({ runCrxTestAndParseTraceRaw }) => {
  const trace1 = await runCrxTestAndParseTraceRaw(async ({ context, page, server }) => {
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.PREFIX + '/frames/frame.html');

    await context.tracing.startChunk();
    await page.setContent('<button>Click</button>');
    await page.click('"Click"');
    page.click('"ClickNoButton"', { timeout: 0 }).catch(() =>  {});
    await page.evaluate(() => {});
    await context.tracing.stopChunk({ path: 'trace.zip' });

    await context.tracing.startChunk();
    await page.hover('"Click"');
    await context.tracing.stopChunk({ path: 'trace2.zip' });

    await context.tracing.startChunk();
    await page.click('"Click"');
    await context.tracing.stopChunk();  // Should stop without a path.
  });

  expect(trace1.events[0].type).toBe('context-options');
  expect(trace1.actions).toEqual([
    'page.setContent',
    'page.click',
    'page.click',
    'page.evaluate',
  ]);
  expect(trace1.events.some(e => e.type === 'frame-snapshot')).toBeTruthy();
  expect(trace1.events.some(e => e.type === 'resource-snapshot' && e.snapshot.request.url.endsWith('style.css'))).toBeTruthy();

  const trace2 = await runCrxTestAndParseTraceRaw(async () => 'trace2.zip');
  expect(trace2.events[0].type).toBe('context-options');
  expect(trace2.actions).toEqual([
    'page.hover',
  ]);
  expect(trace2.events.some(e => e.type === 'frame-snapshot')).toBeTruthy();
  expect(trace2.events.some(e => e.type === 'resource-snapshot' && e.snapshot.request.url.endsWith('style.css'))).toBeTruthy();
});

test('should export trace concurrently to second navigation', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, page, server }) => {
    for (let timeout = 0; timeout < 200; timeout += 20) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      await page.goto(server.PREFIX + '/grid.html');

      // Navigate to the same page to produce the same trace resources
      // that might be concurrently exported.
      const promise = page.goto(server.PREFIX + '/grid.html');
      await page.waitForTimeout(timeout);
      await Promise.all([
        promise,
        context.tracing.stop({ path: 'trace.zip' }),
      ]);
    }
  });
});

test('should not hang for clicks that open dialogs', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, page }) => {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const dialogPromise = page.waitForEvent('dialog');
    await page.setContent(`<div onclick='window.alert(123)'>Click me</div>`);
    await page.click('div', { timeout: 2000 }).catch(() => {});
    const dialog = await dialogPromise;
    await dialog.dismiss();
    await context.tracing.stop();
  });
});

test('should ignore iframes in head', async ({ runCrxTestAndParseTraceRaw }) => {
  const trace = await runCrxTestAndParseTraceRaw(async ({ context, page, server }) => {
    await page.goto(server.PREFIX + '/input/button.html');
    await page.evaluate(() => {
      document.head.appendChild(document.createElement('iframe'));
      // Add iframe in a shadow tree.
      const div = document.createElement('div');
      document.head.appendChild(div);
      const shadow = div.attachShadow({ mode: 'open' });
      shadow.appendChild(document.createElement('iframe'));
    });

    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.click('button');
    await context.tracing.stopChunk({ path: 'trace.zip' });
  });

  expect(trace.actions).toEqual([
    'Frame.click',
  ]);
  expect(trace.events.find(e => e.type === 'frame-snapshot')).toBeTruthy();
  expect(trace.events.find(e => e.type === 'frame-snapshot' && JSON.stringify(e.snapshot.html).includes('IFRAME'))).toBeFalsy();
});
