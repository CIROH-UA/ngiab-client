import { BrowserRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'index.css';
import App from 'App';

const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;
let container = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!container) {
    container = document.getElementById('root');
    const root = createRoot(container);
    root.render(
      // <StrictMode>
        <BrowserRouter basename={APP_ROOT_URL}>
          <App />
        </BrowserRouter>
      // </StrictMode>
    );

    if (module.hot) {
        module.hot.accept();
    }
  }
});