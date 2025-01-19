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

export const SaveCodeForm: React.FC<{
  suggestedFilename?: string;
  onSubmit: (result: { filename: string }) => any;
}> = ({ suggestedFilename, onSubmit }) => {

  const [filename, setFilename] = React.useState<string>(suggestedFilename ?? '');

  return <form id='save-form' onSubmit={() => onSubmit({ filename })}>
    <label htmlFor='filename'>File Name:</label>
    <input
      type='text'
      id='filename'
      name='filename'
      placeholder='Enter file name'
      required
      value={filename}
      onChange={e => setFilename(e.target.value)}
    />
    <button id='submit' type='submit' disabled={!filename}>Save</button>
  </form>;
};
