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
import type { GraphxSuite, PlaywrightServer } from './graphx';
import { listServers, listSuites } from './graphx';
import { loadCredentials, storeCredentials } from './credentials';

export type SaveToGraphxResult = {
  serverId: string;
  username: string;
  password: string;
  suiteId?: number;
  newSuiteName?: string;
  testcaseName: string;
};

type SuiteMode = 'existing' | 'new';

export const SaveToGraphxForm: React.FC<{
  onSubmit: (result: SaveToGraphxResult) => any;
}> = ({ onSubmit }) => {
  const [servers, setServers] = React.useState<PlaywrightServer[] | null>(null);
  const [serverId, setServerId] = React.useState<string>('');
  const [username, setUsername] = React.useState<string>('');
  const [password, setPassword] = React.useState<string>('');
  const [suites, setSuites] = React.useState<GraphxSuite[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<SuiteMode>('existing');
  const [suiteId, setSuiteId] = React.useState<number | null>(null);
  const [newSuiteName, setNewSuiteName] = React.useState<string>('');
  const [testcaseName, setTestcaseName] = React.useState<string>('');

  // Load the server list once on mount, then default to the first server.
  React.useEffect(() => {
    listServers()
      .then(loaded => {
        setServers(loaded);
        if (loaded.length > 0)
          setServerId(loaded[0].id);
        else
          setLoadError('No Playwright servers available.');
      })
      .catch(err => setLoadError(err?.message ?? String(err)));
  }, []);

  // Re-fetch suites whenever (server, username, password) all become valid.
  // Debounced 500ms so typing the password doesn't fire one request per keystroke.
  React.useEffect(() => {
    if (!serverId)
      return;
    setSuites(null);
    setSuiteId(null);
    setLoadError(null);
    if (!username.trim() || !password)
      return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (username.trim() && password) {
        listSuites(serverId, { username: username.trim(), password })
          .then(loaded => {
            if (cancelled)
              return;
            setSuites(loaded);
            if (loaded.length > 0) {
              setSuiteId(loaded[0].id);
              setMode('existing');
            } else {
              setMode('new');
            }
          })
          .catch(err => {
            if (cancelled)
              return;
            setLoadError(err?.message ?? String(err));
          });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [serverId, username, password]);

  // Auto-populate username + password for the selected server. Cancellation
  // guard avoids a race when the user flips servers faster than the storage
  // call resolves.
  React.useEffect(() => {
    if (!serverId) {
      setUsername('');
      setPassword('');
      return;
    }
    let cancelled = false;
    loadCredentials(serverId)
      .then(creds => {
        if (cancelled)
          return;
        setUsername(creds.username);
        setPassword(creds.password);
      })
      .catch(() => {
        if (cancelled)
          return;
        setUsername('');
        setPassword('');
      });
    return () => { cancelled = true; };
  }, [serverId]);

  const canSubmit = !!serverId && !!username.trim() && !!password && !!testcaseName.trim() &&
    (mode === 'existing' ? suiteId !== null : !!newSuiteName.trim());

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit)
      return;
    const trimmedUsername = username.trim();
    storeCredentials(serverId, { username: trimmedUsername, password }).catch(() => { });
    onSubmit({
      serverId,
      username: trimmedUsername,
      password,
      suiteId: mode === 'existing' && suiteId !== null ? suiteId : undefined,
      newSuiteName: mode === 'new' ? newSuiteName.trim() : undefined,
      testcaseName: testcaseName.trim(),
    });
  };

  const credentialsReady = !!username.trim() && !!password;

  return <form id='save-graphx-form' onSubmit={handleSubmit}>
    <div className='form-group'>
      <label htmlFor='graphx-server'>Playwright server</label>
      {servers === null
        ? <div className='note'>Loading servers…</div>
        : <select
          id='graphx-server'
          name='graphx-server'
          value={serverId}
          onChange={e => setServerId(e.target.value)}
          required
        >
          {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      }

      <label htmlFor='graphx-username'>Username</label>
      <input
        type='text'
        id='graphx-username'
        name='graphx-username'
        autoComplete='username'
        placeholder='GraphX username'
        value={username}
        onChange={e => setUsername(e.target.value)}
        required
      />

      <label htmlFor='graphx-password'>Password</label>
      <input
        type='password'
        id='graphx-password'
        name='graphx-password'
        autoComplete='current-password'
        placeholder='GraphX password'
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
      />
    </div>

    <div className='form-group'>
      <label>Suite</label>
      <div className='radio-row'>
        <label>
          <input
            type='radio'
            name='suite-mode'
            value='existing'
            checked={mode === 'existing'}
            disabled={!suites || suites.length === 0}
            onChange={() => setMode('existing')}
          />
          Existing
        </label>
        <label>
          <input
            type='radio'
            name='suite-mode'
            value='new'
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          New
        </label>
      </div>

      {mode === 'existing' && (
        !credentialsReady
          ? <div className='note'>Enter credentials above to load suites.</div>
          : suites === null
            ? <div className='note'>Loading suites…</div>
            : suites.length === 0
              ? <div className='note error'>No suites on this server — create a new one.</div>
              : <select
                id='graphx-suite'
                name='graphx-suite'
                value={suiteId !== null ? String(suiteId) : ''}
                onChange={e => setSuiteId(Number(e.target.value))}
              >
                {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
      )}

      {mode === 'new' && (
        <input
          type='text'
          id='graphx-new-suite'
          name='graphx-new-suite'
          placeholder='New suite name'
          value={newSuiteName}
          onChange={e => setNewSuiteName(e.target.value)}
          required
        />
      )}

      <label htmlFor='graphx-testcase-name'>Testcase name</label>
      <input
        type='text'
        id='graphx-testcase-name'
        name='graphx-testcase-name'
        placeholder='Enter testcase name'
        value={testcaseName}
        onChange={e => setTestcaseName(e.target.value)}
        required
      />

      {loadError && <div className='note error'>{loadError}</div>}

      <button id='submit' type='submit' disabled={!canSubmit}>Save to GraphX</button>
    </div>
  </form>;
};
