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
import { CrxTestServerConnection } from './testServer/crxTestServerTransport';
import './crxRecorder.css';

function setElementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
  window.playwrightElementPicked(elementInfo, userGesture);
};

function setRunningFileId(fileId: string) {
  window.playwrightSetRunningFile(fileId);
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const CrxRecorder: React.FC = ({
}) => {
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [showPreferences, setShowPreferences] = React.useState(false);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [log, setLog] = React.useState(new Map<string, CallLog>());
  const [mode, setMode] = React.useState<Mode>('none');
  const [selectedFileId, setSelectedFileId] = React.useState<string>(defaultSettings.targetLanguage);
  const [testServer, setTestServer] = React.useState<CrxTestServerConnection>();

  React.useEffect(() => {
    const testServer = new CrxTestServerConnection();
    setTestServer(new CrxTestServerConnection());
    return () => testServer.close();
  }, []);

  React.useEffect(() => {
    const port = chrome.runtime.connect({ name: 'crx-recorder' });
    const onMessage = (msg: any) => {
      if (!('type' in msg) || msg.type !== 'recorder') return;
  
      switch (msg.method) {
        case 'setPaused': setPaused(msg.paused); break;
        case 'setMode': setMode(msg.mode); break;
        case 'setSources': setSources(msg.sources); break;
        case 'resetCallLogs': setLog(new Map()); break;
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

    window.dispatch = async (data: any) => {
      port.postMessage({ type: 'recorderEvent', ...data });
      if (data.event === 'fileChanged')
        setSelectedFileId(data.params.file);
    };
    loadSettings().then(setSettings).catch(() => {});

    addSettingsChangedListener(setSettings);

    return () => {
      removeSettingsChangedListener(setSettings)
      port.disconnect();
    };
  }, []);

  const downloadCode = React.useCallback(() => {
    if (!settings.experimental)
      return;

    if (!testServer || !sources.length || !selectedFileId)
      return;

    const source = sources.find(s => s.id === selectedFileId);
    if (!source)
      return;

    let filename: string | undefined;

    switch (selectedFileId) {
      case 'javascript': filename = 'example.js'; break;
      case 'playwright-test': filename = 'example.spec.ts'; break;
      case 'java-junit': filename = 'TestExample.java'; break;
      case 'java': filename = 'Example.java'; break;
      case 'python-pytest': filename = 'test_example.py'; break;
      case 'python': filename = 'example.py'; break;
      case 'python-async': filename = 'example.py'; break;
      case 'csharp-mstest': filename = 'Tests.cs'; break;
      case 'csharp-nunit': filename = 'Tests.cs'; break;
      case 'csharp': filename = 'Example.cs'; break;
    };

    if (!filename)
      return;

    const code = source.text;

    testServer.saveScript({ code, language: 'javascript', suggestedName: filename }).catch(() => {});
  }, [sources, selectedFileId, testServer, settings]);

  React.useEffect(() => {
    if (!settings.experimental)
      return;

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        downloadCode();
      }
    };
    window.addEventListener('keydown', keydownHandler);

    return () => {
      window.removeEventListener('keydown', keydownHandler);
    };
  }, [downloadCode, settings]);

  const dispatchEditedCode = React.useCallback((code: string) => {
    window.dispatch({ event: 'codeChanged', params: { code } });
  }, []);

  const dispatchCursorActivity = React.useCallback((position: { line: number }) => {
    window.dispatch({ event: 'cursorActivity', params: { position } });
  }, []);

  return <>
    <div>
      <Dialog title="Preferences" isOpen={showPreferences} onClose={() => setShowPreferences(false)}>
        <PreferencesForm />
      </Dialog>
    </div>

    <div className="recorder">
      {settings.experimental && <>
      <Toolbar>
        <ToolbarButton icon='save' title='Save' disabled={false} onClick={downloadCode}>Save</ToolbarButton>
        <div style={{ flex: 'auto' }}></div>
          <div className="dropdown">
            <ToolbarButton icon="tools" title='Tools' disabled={false} onClick={() => {}}></ToolbarButton>
            <div className="dropdown-content right-align">
              <a href="#" onClick={() => testServer?.saveStorageState()}>Save storage state</a>
              <a href="#" onClick={() => testServer?.openUiMode()}>Open UI Mode</a>
            </div>
          </div>
          <ToolbarSeparator />
        <ToolbarButton icon='settings-gear' title='Preferences' onClick={() => setShowPreferences(true)}></ToolbarButton>
      </Toolbar>
      </>}
      <Recorder sources={sources} paused={paused} log={log} mode={mode} onEditedCode={dispatchEditedCode} onCursorActivity={dispatchCursorActivity} />
    </div>
  </>;
};