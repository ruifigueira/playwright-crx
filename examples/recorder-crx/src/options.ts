import './options.css';

async function initialize() {
  const formElem = document.getElementById('options-form') as HTMLFormElement;
  const languageElem = document.getElementById('target-language') as HTMLSelectElement;
  const testIdAttributeNameElem = document.getElementById('test-id') as HTMLInputElement;
  const submitElem = document.getElementById('submit') as HTMLButtonElement;

  if (!testIdAttributeNameElem || !formElem || !submitElem) return;

  testIdAttributeNameElem.addEventListener('input', () => {
    submitElem.disabled = false;
  });
  languageElem.addEventListener('change', () => {
    submitElem.disabled = false;
  });

  formElem.addEventListener('submit', (e) => {
    if (!formElem.reportValidity()) return;

    e.preventDefault();

    submitElem.disabled = true;
    const testIdAttributeName = testIdAttributeNameElem.value;
    const targetLanguage = languageElem.value;
    chrome.storage.sync.set({ testIdAttributeName, targetLanguage }).catch(() => {});

    return false;
  });

  submitElem.disabled = true;
  const { testIdAttributeName, targetLanguage } = await chrome.storage.sync.get(['testIdAttributeName', 'targetLanguage']);
  testIdAttributeNameElem.value = testIdAttributeName ?? 'data-testid';
  languageElem.value = targetLanguage ?? 'javascript';
}

initialize();
