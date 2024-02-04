import { CodeMirrorWrapper } from "@web/components/codeMirrorWrapper";
import type React from "react";
import { useMemo, useState } from "react";
import { UserScript, add, deleteById } from "../userScripts";
import './userScriptEditor.css';
import { Toast, ToastProps } from "./toast";

export const UserScriptEditor: React.FC<{
  userScript: UserScript,
  onSave?: (userScript: UserScript) => void | Promise<void>
}> = ({ userScript }) => {
  const [id, setId] = useState(userScript?.id);
  const [name, setName] = useState(userScript?.name ?? '');
  const [newWindow, setNewWindow] = useState(userScript?.newWindow);
  const [urlPatterns, setUrlPatterns] = useState(userScript?.urlPatterns);
  const [code, setCode] = useState(userScript?.code ?? '');
  const [toast, setToast] = useState<ToastProps>({ show: false, message: '' });

  const saveUserScript = async () => {
    const updatedUserScript = { ...userScript, id, name, code, newWindow, urlPatterns };
    try {
      setToast({ show: true, type: 'info', message: `Saving user script ${updatedUserScript.name}` });
      const [{ id }] = await add(updatedUserScript);
      setId(id);
      setToast({ show: true, type: 'success', message: `User script ${updatedUserScript.name} successfully saved` });
    } catch (e) {
      setToast({ show: true, type: 'error', message: `User script ${updatedUserScript.name} failed` });
    }
  }

  const deleteUserScript = async () => {
    if (!userScript.id) return;
    if (window.confirm(`Are you sure you want to delete this user script?`)) {
      await deleteById(userScript.id);
      window.close();
    }
  }

  const disableSave = useMemo(() => !name || !code, [name, code]);

  return <>
    <div className='user-script-editor'>
      <h2>User Script Editor{userScript?.id ? ` (#${userScript.id})` : ''}</h2>
      <div>
        <div className='form-group'>
          <label htmlFor='name'>Name:</label>
          <input type='text' id='name' value={name} onChange={e => setName(e.target.value)} required></input>
        </div>

        <div className='form-group'>
          <label htmlFor='newWindow'>Open in new window:</label>
          <input type='checkbox' id='newWindow' name='newWindow' checked={newWindow} onChange={e => setNewWindow(e.target.checked)} />
        </div>

        {!newWindow && <div className='form-group'>
          <label htmlFor='urlPatterns'>URL Patterns:</label>
          <textarea id='urlPatterns' name='urlPatterns' rows={2} value={urlPatterns?.join('\n')} onChange={e => setUrlPatterns(e.target.value.split('\n'))}></textarea>
        </div>}

        <div className='form-group code'>
          <CodeMirrorWrapper text={code} language='javascript' onChange={code => setCode(code)} />
        </div>

        <div className="button-container">
          <button className="btn-info" onClick={saveUserScript} disabled={disableSave}>Save</button>
          <button className="btn-danger" onClick={deleteUserScript} disabled={!userScript.id}>Delete</button>
        </div>
      </div>
    </div>
    <Toast show={toast.show} type={toast.type} message={toast.message} onClose={() => setToast({ show: false, message: '' })}></Toast>
  </>
};
