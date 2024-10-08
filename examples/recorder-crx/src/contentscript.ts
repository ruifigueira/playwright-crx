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

window.addEventListener('load', () => {
  // if not running as a chrome extension, skip this...
  if (typeof chrome === 'undefined' || !chrome.runtime)
    return;

  const wnd: any = window;
  const port = chrome.runtime.connect();

  const dispatch = async (data: any) => {
    port.postMessage({ type: 'recorderEvent', ...data });
  };

  wnd.dispatch = dispatch;

  const onMessage = (msg: any) => {
    if (!('type' in msg) || msg.type !== 'recorder') return;

    switch (msg.method) {
      case 'setPaused': wnd.playwrightSetPaused(msg.paused); break;
      case 'setMode': wnd.playwrightSetMode(msg.mode); break;
      case 'setSources': wnd.playwrightSetSources(msg.sources); break;
      case 'updateCallLogs': wnd.playwrightUpdateLogs(msg.callLogs); break;
      case 'setSelector': wnd.playwrightSetSelector(msg.selector, msg.userGesture); break;
      case 'setFile': wnd.playwrightSetFile(msg.file); break;
    }
  };

  port.onMessage.addListener(onMessage);
});
