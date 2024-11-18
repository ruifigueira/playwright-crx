import './fs.css';
import * as ReactDOM from 'react-dom/client';
import { clientRequestFs, FsMethodsParamsMap, FsPageOptions } from './utils/virtualFs';

const searchParams = new URLSearchParams(window.location.search);

const method = searchParams.get('method') as keyof FsMethodsParamsMap;

const defaultTitles: Record<keyof FsMethodsParamsMap, Pick<FsPageOptions, 'title' | 'subtitle'>> = {
  'requestPermission': { title: 'Request permission', subtitle: 'Please allow the extension to access your file system' },
  'showDirectoryPicker': { title: 'Pick a directory', subtitle: 'Please choose a directory in your file system' },
  'showSaveFilePicker': { title: 'Saving file', subtitle: 'Please choose a location to save the file' },
};
const title = searchParams.get('title') ?? defaultTitles[method]?.title;
const subtitle = searchParams.get('subtitle') ?? defaultTitles[method]?.subtitle;

(async () => {
  ReactDOM.createRoot(document.querySelector('#root')!).render(
    <div className='fs'>
      <div className='title'>{title}</div>
      {subtitle && <div>{subtitle}</div>}
      <button onClick={() => clientRequestFs()}>Go!</button>
    </div>
  );
})();
