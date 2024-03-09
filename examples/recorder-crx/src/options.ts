import './options.css';

async function initialize() {
  const formElem = document.getElementById('options-form') as HTMLFormElement;
  const testIdAttributeNameElem = document.getElementById('test-id') as HTMLInputElement;
  const submitElem = document.getElementById('submit') as HTMLButtonElement;

  if (!testIdAttributeNameElem || !formElem || !submitElem) return;

  testIdAttributeNameElem.addEventListener('input', () => {
    submitElem.disabled = false;
  });

  formElem.addEventListener('submit', (e) => {
    if (!formElem.reportValidity()) return;

    e.preventDefault();

    submitElem.disabled = true;
    const testIdAttributeName = testIdAttributeNameElem.value;
    chrome.storage.sync.set({ testIdAttributeName }).catch(() => {});

    return false;
  });

  submitElem.disabled = true;
  const { testIdAttributeName } = await chrome.storage.sync.get('testIdAttributeName');
  testIdAttributeNameElem.value = testIdAttributeName ?? 'data-testid';
}

initialize();
