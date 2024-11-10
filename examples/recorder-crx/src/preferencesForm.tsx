import './preferencesForm.css';
import React from "react";

type Preferences = {
  testIdAttributeName: string;
  targetLanguage: string;
  sidepanel?: boolean;
};

const defaultPreferences = {
  testIdAttributeName: 'data-testid',
  targetLanguage: 'javascript',
  sidepanel: true,
};

export const PreferencesForm: React.FC = ({}) => {
  const [initialPreferences, setInitialPreferences] = React.useState<Preferences>(defaultPreferences);
  const [preferences, setPreferences] = React.useState<Preferences>(defaultPreferences);

  React.useEffect(() => {
    chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage', 'sidepanel'])
      .then(loadedPreferences => {
        const preferences = { ...defaultPreferences, ...loadedPreferences };
        setInitialPreferences(preferences);
        setPreferences(preferences);
      });
  }, []);

  const canSave = React.useMemo(() => {
    return initialPreferences.sidepanel !== preferences.sidepanel ||
      initialPreferences.targetLanguage !== preferences.targetLanguage ||
      initialPreferences.testIdAttributeName !== preferences.testIdAttributeName;
  }, [preferences, initialPreferences]);

  const savePreferences = (e: React.FormEvent<HTMLFormElement>) => {
    if (!e.currentTarget.reportValidity()) return;

    e.preventDefault();
    chrome.storage.sync.set(preferences)
      .then(() => {
        setInitialPreferences({ ...preferences });
      })
      .catch(() => {});
  };

  return <form id="preferences-form" onSubmit={savePreferences}>
    <label htmlFor="target-language">Default language:</label>
    <select id="target-language" name="target-language" value={preferences.targetLanguage} onChange={e => setPreferences({ ...preferences, targetLanguage: e.target.selectedOptions[0].value })}>
      <optgroup label="Node.js">
        <option value="javascript">Library</option>
        <option value="playwright-test">Test Runner</option>
      </optgroup>
      <optgroup label="Java">
        <option value="java-junit">JUnit</option>
        <option value="java">Library</option>
      </optgroup>
      <optgroup label="Python">
        <option value="python-pytest">Pytest</option>
        <option value="python">Library</option>
        <option value="python-async">Library Async</option>
      </optgroup>
      <optgroup label=".NET C#">
        <option value="csharp-mstest">MSTest</option>
        <option value="csharp-nunit">NUnit</option>
        <option value="csharp">Library</option>
      </optgroup>
    </select>
    <label htmlFor="test-id">TestID Attribute Name:</label>
    <input
      type="text"
      id="test-id"
      name="test-id"
      placeholder="Enter Attribute Name"
      pattern="[a-zA-Z][\w\-]*"
      title="Must be a valid attribute name"
      value={preferences.testIdAttributeName}
      onChange={e => setPreferences({ ...preferences, testIdAttributeName: e.target.value })}
    />
    <div>
      <label htmlFor="sidepanel" className="row">Open in Side Panel:</label>
      <input
        type="checkbox"
        id="sidepanel"
        name="sidepanel"
        checked={preferences.sidepanel}
        onChange={e => setPreferences({ ...preferences, sidepanel: e.target.checked })}
      />
    </div>
    <button id="submit" type="submit" disabled={!canSave}>{canSave ? 'Save' : 'Saved'}</button>
  </form>;
};