import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PrintPreviewPage from '../../app/print-preview/page';
import '../../app/globals.css';

createRoot(document.querySelector('#root')!).render(createElement(PrintPreviewPage));
