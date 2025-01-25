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
import React from 'react';
import type { CrxSettings } from './settings';
import { defaultSettings, loadSettings, storeSettings } from './settings';

export const PreferencesForm: React.FC = ({}) => {
  const [initialSettings, setInitialSettings] = React.useState<CrxSettings>(defaultSettings);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [isAllowedIncognitoAccess, setIsAllowedIncognitoAccess] = React.useState<boolean>(false);

  React.useEffect(() => {
    loadSettings()
        .then(settings => {
          setInitialSettings(settings);
          setSettings(settings);
        });
    chrome.extension.isAllowedIncognitoAccess().then(setIsAllowedIncognitoAccess);
  }, []);

  const canSave = React.useMemo(() => {
    return initialSettings.sidepanel !== settings.sidepanel ||
      initialSettings.targetLanguage !== settings.targetLanguage ||
      initialSettings.testIdAttributeName !== settings.testIdAttributeName ||
      initialSettings.playInIncognito !== settings.playInIncognito ||
      initialSettings.experimental !== settings.experimental;
  }, [settings, initialSettings]);

  const saveSettings = React.useCallback((e: React.FormEvent<HTMLFormElement>) => {
    if (!e.currentTarget.reportValidity())
      return;

    e.preventDefault();
    storeSettings(settings)
        .then(() => setInitialSettings(settings))
        .catch(() => {});
  }, [settings]);

  return <form id='preferences-form' onSubmit={saveSettings}>
    <label htmlFor='target-language'>Default language:</label>
    <select id='target-language' name='target-language' value={settings.targetLanguage} onChange={e => setSettings({ ...settings, targetLanguage: e.target.selectedOptions[0].value })}>
      <optgroup label='Node.js'>
        <option value='javascript'>Library</option>
        <option value='playwright-test'>Test Runner</option>
      </optgroup>
      <optgroup label='Java'>
        <option value='java-junit'>JUnit</option>
        <option value='java'>Library</option>
      </optgroup>
      <optgroup label='Python'>
        <option value='python-pytest'>Pytest</option>
        <option value='python'>Library</option>
        <option value='python-async'>Library Async</option>
      </optgroup>
      <optgroup label='.NET C#'>
        <option value='csharp-mstest'>MSTest</option>
        <option value='csharp-nunit'>NUnit</option>
        <option value='csharp'>Library</option>
      </optgroup>
    </select>
    <label htmlFor='test-id'>TestID Attribute Name:</label>
    <input
      type='text'
      id='test-id'
      name='test-id'
      placeholder='Enter Attribute Name'
      pattern='[a-zA-Z][\w\-]*'
      title='Must be a valid attribute name'
      value={settings.testIdAttributeName}
      onChange={e => setSettings({ ...settings, testIdAttributeName: e.target.value })}
    />
    <div>
      <label htmlFor='sidepanel' className='row'>Open in Side Panel:</label>
      <input
        type='checkbox'
        id='sidepanel'
        name='sidepanel'
        checked={settings.sidepanel}
        onChange={e => setSettings({ ...settings, sidepanel: e.target.checked })}
      />
    </div>
    <div>
      <label htmlFor='playInIncognito' className='row'>Play in incognito:</label>
      <input
        disabled={!isAllowedIncognitoAccess}
        type='checkbox'
        id='playInIncognito'
        name='playInIncognito'
        checked={settings.playInIncognito}
        onChange={e => setSettings({ ...settings, playInIncognito: e.target.checked })}
      />
      {!isAllowedIncognitoAccess && <div className='note error'>This feature requires the extension to be allowed to run in incognito mode.</div>}
    </div>
    <div>
      <label htmlFor='experimental' className='row'>Allow experimental features:</label>
      <input
        type='checkbox'
        id='experimental'
        name='experimental'
        checked={settings.experimental}
        onChange={e => setSettings({ ...settings, experimental: e.target.checked })}
      />
    </div>
    <button id='submit' type='submit' disabled={!canSave}>{canSave ? 'Save' : 'Saved'}</button>
  </form>;
};
