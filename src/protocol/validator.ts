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

import 'playwright-core/lib/protocol/validator';

import { scheme, tArray, tBoolean, tChannel, tEnum, tNumber, tObject, tOptional, tString } from 'playwright-core/lib/protocol/validatorPrimitives';

// "override" PlaywrightInitializer, adds _crx
scheme.PlaywrightInitializer = tObject({
  chromium: tChannel(['BrowserType']),
  firefox: tChannel(['BrowserType']),
  webkit: tChannel(['BrowserType']),
  android: tChannel(['Android']),
  electron: tChannel(['Electron']),
  utils: tChannel(['LocalUtils']),
  deviceDescriptors: tArray(tObject({
    name: tString,
    descriptor: tObject({
      userAgent: tString,
      viewport: tObject({
        width: tNumber,
        height: tNumber,
      }),
      screen: tOptional(tObject({
        width: tNumber,
        height: tNumber,
      })),
      deviceScaleFactor: tNumber,
      isMobile: tBoolean,
      hasTouch: tBoolean,
      defaultBrowserType: tEnum(['chromium', 'firefox', 'webkit']),
    }),
  })),
  selectors: tChannel(['Selectors']),
  preLaunchedBrowser: tOptional(tChannel(['Browser'])),
  preConnectedAndroidDevice: tOptional(tChannel(['AndroidDevice'])),
  socksSupport: tOptional(tChannel(['SocksSupport'])),
  _crx: tChannel(['Crx']),
});

scheme.CrxInitializer = tOptional(tObject({}));
scheme.CrxStartParams = tObject({
  slowMo: tOptional(tNumber),
});
scheme.CrxStartResult = tObject({
  crxApplication: tChannel(['CrxApplication']),
});
scheme.CrxApplicationInitializer = tObject({
  context: tChannel(['BrowserContext']),
});
scheme.CrxApplicationHideEvent = tOptional(tObject({}));
scheme.CrxApplicationShowEvent = tOptional(tObject({}));
scheme.CrxApplicationAttachedEvent = tObject({
  page: tChannel(['Page']),
  tabId: tNumber,
});
scheme.CrxApplicationDetachedEvent = tObject({
  tabId: tNumber,
});
scheme.CrxApplicationModeChangedEvent = tObject({
  mode: tEnum(['none', 'recording', 'inspecting', 'assertingText', 'recording-inspecting', 'standby', 'assertingVisibility', 'assertingValue']),
});
scheme.CrxApplicationAttachParams = tObject({
  tabId: tNumber,
});
scheme.CrxApplicationAttachResult = tObject({
  page: tChannel(['Page']),
});
scheme.CrxApplicationAttachAllParams = tObject({
  status: tOptional(tEnum(['loading', 'complete'])),
  lastFocusedWindow: tOptional(tBoolean),
  windowId: tOptional(tNumber),
  windowType: tOptional(tEnum(['normal', 'popup', 'panel', 'app', 'devtools'])),
  active: tOptional(tBoolean),
  index: tOptional(tNumber),
  title: tOptional(tString),
  url: tOptional(tArray(tString)),
  currentWindow: tOptional(tBoolean),
  highlighted: tOptional(tBoolean),
  discarded: tOptional(tBoolean),
  autoDiscardable: tOptional(tBoolean),
  pinned: tOptional(tBoolean),
  audible: tOptional(tBoolean),
  muted: tOptional(tBoolean),
  groupId: tOptional(tNumber),
});
scheme.CrxApplicationAttachAllResult = tObject({
  pages: tArray(tChannel(['Page'])),
});
scheme.CrxApplicationDetachParams = tObject({
  tabId: tOptional(tNumber),
  page: tOptional(tChannel(['Page'])),
});
scheme.CrxApplicationDetachResult = tOptional(tObject({}));
scheme.CrxApplicationDetachAllParams = tOptional(tObject({}));
scheme.CrxApplicationDetachAllResult = tOptional(tObject({}));
scheme.CrxApplicationNewPageParams = tObject({
  index: tOptional(tNumber),
  openerTabId: tOptional(tNumber),
  url: tOptional(tString),
  pinned: tOptional(tBoolean),
  windowId: tOptional(tNumber),
  active: tOptional(tBoolean),
  selected: tOptional(tBoolean),
});
scheme.CrxApplicationNewPageResult = tObject({
  page: tChannel(['Page']),
});
scheme.CrxApplicationShowRecorderParams = tObject({
  mode: tOptional(tEnum(['none', 'recording', 'inspecting', 'assertingText', 'recording-inspecting', 'standby', 'assertingVisibility', 'assertingValue'])),
  language: tOptional(tString),
  testIdAttributeName: tOptional(tString),
});
scheme.CrxApplicationShowRecorderResult = tOptional(tObject({}));
scheme.CrxApplicationHideRecorderParams = tOptional(tObject({}));
scheme.CrxApplicationHideRecorderResult = tOptional(tObject({}));
scheme.CrxApplicationCloseParams = tOptional(tObject({}));
scheme.CrxApplicationCloseResult = tOptional(tObject({}));
