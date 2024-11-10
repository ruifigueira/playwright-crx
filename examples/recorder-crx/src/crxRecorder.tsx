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
import { Main } from '@recorder/main';
import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton } from '@web/components/toolbarButton';
import { Dialog } from './dialog';
import { PreferencesForm } from './preferencesForm';

export const CrxRecorder: React.FC = ({
}) => {
  const [showPreferences, setShowPreferences] = React.useState(false);

  return <>
    <div>
      <Dialog title="Preferences" isOpen={showPreferences} onClose={() => setShowPreferences(false)}>
        <PreferencesForm />
      </Dialog>
    </div>

    <div className="recorder">
      <Toolbar>
        <ToolbarButton icon='save' title='Save' disabled={false} onClick={() => {}}>Save</ToolbarButton>
        <div style={{ flex: 'auto' }}></div>
        <ToolbarButton icon='settings-gear' title='Preferences' onClick={() => setShowPreferences(true)}></ToolbarButton>
      </Toolbar>
      <Main />
    </div>
  </>;
};