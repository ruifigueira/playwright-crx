import './preferences.css';
import { PreferencesForm } from './preferencesForm';
import * as ReactDOM from 'react-dom/client';

(async () => {
  ReactDOM.createRoot(document.querySelector('#root')!).render(<PreferencesForm />);
})();
