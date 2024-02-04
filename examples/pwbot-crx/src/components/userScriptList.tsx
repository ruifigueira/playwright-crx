import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton } from '@web/components/toolbarButton';
import { UserScript } from "../userScripts";
import "./userScriptList.css";
import { useEffect, useState } from 'react';
import { matchesUrlPattern } from '../utils';

function byUserScriptName(a: UserScript, b: UserScript) {
  return a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase());
}

type UserScriptListProps = {
  userScripts: UserScript[];
}

export const UserScriptList: React.FC<UserScriptListProps> = ({ userScripts }) => {
  const [running, setRunning] = useState<number | undefined>();
  const [activeUrl, setActiveUrl] = useState<string | undefined>();

  useEffect(() => {
    chrome.runtime.onMessage.addListener(msg => {
      switch (msg.type) {
        case 'runUserScriptCompleted':
          setRunning(undefined);
          break;
        case 'currentTabUpdated':
          setActiveUrl(msg.currentTabInfo?.url);
          break;
      }
    });
  }, []);

  const items = userScripts.sort(byUserScriptName).map(({ id, name, newWindow, urlPatterns }) => {
    const runUserScript = async () => {
      setRunning(id);
      await chrome.runtime.sendMessage({ type: 'runUserScript', id });
    };
    const editUserScript = () => chrome.tabs.create({ url: `chrome-extension://${chrome.runtime.id}/editor.html?id=${id}` });
    const canRun = newWindow || (!!activeUrl && (!urlPatterns || urlPatterns.length === 0 || urlPatterns.some(up => matchesUrlPattern(up, activeUrl))));

    return <div className={`item ${id === running ? 'running' : ''}`}>
      <Toolbar>
        <ToolbarButton disabled={!canRun} icon='play-circle' title='Run script' onClick={runUserScript}></ToolbarButton>
        <div>
          <div>{name}</div>
          <small>{newWindow ? 'Runs in new tab' : (canRun ? 'Runs in current active tab' : 'Does not run in current active tab')}</small>
        </div>
      </Toolbar>
      <Toolbar>
        <ToolbarButton icon='edit' title='Edit script' onClick={editUserScript}></ToolbarButton>
      </Toolbar>
    </div>;
  });

  return items.length > 0 ?
    <div className='user-script-list'>{items}</div> :
    <div className='user-script-list empty-state'>No user scripts, please create one.</div>;
};
