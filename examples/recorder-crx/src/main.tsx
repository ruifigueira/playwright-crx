import './main.css';
import * as ReactDOM from 'react-dom/client';

(async () => {
  ReactDOM.createRoot(document.querySelector('#root')!).render(<div className='main'>
    <div className='title'>Saving recorded script</div>
    <div><a href='#'>Select a file</a> to save to</div>
  </div>);
})();
