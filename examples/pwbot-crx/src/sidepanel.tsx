import './sidepanel.css';
import { render } from 'react-dom';
import { UserScriptList } from "./components/userScriptList";
import { UserScript, getAll } from './userScripts';
import { useEffect, useState } from 'react';

const newUserScript = () => chrome.tabs.create({ url: `chrome-extension://${chrome.runtime.id}/editor.html` });

const SidePanel: React.FC = () => {
  const [userScripts, setUserScripts] = useState<UserScript[]>([]);

  useEffect(() => {
    getAll().then(setUserScripts);
    chrome.storage.sync.onChanged.addListener(async ({ userScripts }) => {
      if (userScripts) {
        setUserScripts(await getAll());
      }
    });
  }, []);

  return <>
    <UserScriptList userScripts={userScripts} />
    <div className='sticky-bottom'>
      <button className='mui-button' onClick={newUserScript}>New User Script</button>
    </div>
  </>;
}

render(<SidePanel />, document.querySelector('#root'));
