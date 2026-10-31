import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => console.error('Service worker registration failed', error));
  });
}
// Netlify Dev can test push explicitly with ?sw=1; Vite-only mode cannot authenticate.
if (
  'serviceWorker' in navigator &&
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has('sw')
)
  void navigator.serviceWorker.register('/sw.js');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
