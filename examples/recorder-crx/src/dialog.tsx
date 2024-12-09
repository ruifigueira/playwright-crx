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
import './dialog.css';

export const Dialog: React.FC<React.PropsWithChildren<{
    isOpen: boolean,
    onClose: () => any,
    title: string,
}>> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen)
    return null;

  return (
    <div className='dialog-overlay' role='dialog' aria-label={title} onClick={onClose}>
      <div className='dialog-box' onClick={e => e.stopPropagation()}>
        <div className='dialog-header'>
          <h2>{title}</h2>
          <button className='dialog-close' onClick={onClose}>
            &times;
          </button>
        </div>
        <div className='dialog-content'>{children}</div>
      </div>
    </div>
  );
};
