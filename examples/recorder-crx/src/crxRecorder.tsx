/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton, ToolbarSeparator } from '@web/components/toolbarButton';
import { Dialog } from './dialog';
import { PreferencesForm } from './preferencesForm';
import { CallLog, ElementInfo, Mode, Source } from '@recorder/recorderTypes';
import { Recorder } from '@recorder/recorder';
import { addSettingsChangedListener, CrxSettings, defaultSettings, loadSettings, removeSettingsChangedListener } from './settings';
import './crxRecorder.css';

function setElementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
  window.playwrightElementPicked(elementInfo, userGesture);
};

function setRunningFileId(fileId: string) {
  window.playwrightSetRunningFile(fileId);
}

export const CrxRecorder: React.FC = ({
}) => {
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [showPreferences, setShowPreferences] = React.useState(false);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [log, setLog] = React.useState(new Map<string, CallLog>());
  const [mode, setMode] = React.useState<Mode>('none');
  const [selectedFileId, setSelectedFileId] = React.useState<string | undefined>();

  React.useEffect(() => {
    const port = chrome.runtime.connect({ name: 'recorder' });
    const onMessage = (msg: any) => {
      if (!('type' in msg) || msg.type !== 'recorder') return;
  
      switch (msg.method) {
        case 'setPaused': setPaused(msg.paused); break;
        case 'setMode': setMode(msg.mode); break;
        case 'setSources': setSources(msg.sources); break;
        case 'updateCallLogs': setLog(log => {
          const newLog = new Map<string, CallLog>(log);
          for (const callLog of msg.callLogs) {
            callLog.reveal = !log.has(callLog.id);
            newLog.set(callLog.id, callLog);
          }
          return newLog;
        }); break;
        case 'setRunningFile': setRunningFileId(msg.file); break;
        case 'elementPicked': setElementPicked(msg.elementInfo, msg.userGesture); break;
      }
    };
    port.onMessage.addListener(onMessage);

    const dispatch = async (data: any) => {
      port.postMessage({ type: 'recorderEvent', ...data });
      if (data.event === 'fileChanged')
        setSelectedFileId(data.params.file);
    };
    window.dispatch = dispatch;
    loadSettings().then(settings => {
      setSettings(settings);
      setSelectedFileId(settings.targetLanguage);
    }).catch(() => {});

    addSettingsChangedListener(setSettings);

    return () => {
      removeSettingsChangedListener(setSettings)
      port.disconnect();
    };
  }, []);

  const requestSave = React.useCallback(() => {
    if (!sources.length || !selectedFileId)
      return;

    const source = sources.find(s => s.id === selectedFileId);
    if (!source)
      return;

    const code = [
      source.header,
      ...(source.actions ?? []),
      source.footer,
    ].filter(Boolean).join('\n');

    let suggestedName: string | undefined;
    switch (selectedFileId) {
      case 'javascript': suggestedName = 'example.js'; break;
      case 'playwright-test': suggestedName = 'example.spec.ts'; break;
      case 'java-junit': suggestedName = 'TestExample.java'; break;
      case 'java': suggestedName = 'Example.java'; break;
      case 'python-pytest': suggestedName = 'test_example.py'; break;
      case 'python': suggestedName = 'example.py'; break;
      case 'python-async': suggestedName = 'example.py'; break;
      case 'csharp-mstest': suggestedName = 'Tests.cs'; break;
      case 'csharp-nunit': suggestedName = 'Tests.cs'; break;
      case 'csharp': suggestedName = 'Example.cs'; break;
    };

    if (!suggestedName)
      return;

    // send message to background script because we can't save files directly from the extension
    // see: https://issues.chromium.org/issues/337540332
    chrome.runtime.sendMessage({ event: 'saveRequested', params: { code, suggestedName } });
  }, [sources, selectedFileId]);

  const requestSaveStorageState = React.useCallback(() => {
    chrome.runtime.sendMessage({ event: 'saveStorageStateRequested' });
  }, []);

  React.useEffect(() => {
    const keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        requestSave();
      }
    };
    window.addEventListener('keydown', keydownHandler);

    return () => {
      window.removeEventListener('keydown', keydownHandler);
    };
  }, [requestSave]);

  return <>
    <div>
      <Dialog title="Preferences" isOpen={showPreferences} onClose={() => setShowPreferences(false)}>
        <PreferencesForm />
      </Dialog>
    </div>

    <div className="recorder">
      {settings.experimental && <>
      <Toolbar>
        <ToolbarButton icon='save' title='Save' disabled={false} onClick={requestSave}>Save</ToolbarButton>
        <div style={{ flex: 'auto' }}></div>
          <div className="dropdown">
            <ToolbarButton icon="tools" title='Tools' disabled={false} onClick={() => {}}></ToolbarButton>
            <div className="dropdown-content right-align">
              <a href="#" onClick={requestSaveStorageState}>Save storage state</a>
            </div>
          </div>
          <ToolbarSeparator />
        <ToolbarButton icon='settings-gear' title='Preferences' onClick={() => setShowPreferences(true)}></ToolbarButton>
      </Toolbar>
      </>}
      <Recorder sources={sources} paused={paused} log={log} mode={mode} />
    </div>
  </>;
};