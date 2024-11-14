import './saving.css';
import * as ReactDOM from 'react-dom/client';

(async () => {
  ReactDOM.createRoot(document.querySelector('#root')!).render(<div className='saving'>
    <div className='title'>Saving file</div>
    <div><a href='#'>Pick a file</a> to save to.</div>
  </div>);
})();
