import { getById } from "./userScripts";
import { render } from 'react-dom';
import { UserScriptEditor } from "./components/userScriptEditor";
import './editor.css';

const kCodeTemplate = `async function run({ page }) {

}`;

(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const idStr = urlParams.get('id');

  const userScript = idStr ? await getById(parseInt(idStr)) : { name: '', code: kCodeTemplate };
  console.log(`loaded user script`);

  render(<UserScriptEditor userScript={userScript} />, document.querySelector('#root'));
})();
