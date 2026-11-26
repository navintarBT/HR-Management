import React from 'react';
import ReactDOM from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import './me.css';
import { MeApp } from './MeApp';

// One look on every phone (iOS-style components on Android too).
setupIonicReact({ mode: 'ios' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MeApp />
  </React.StrictMode>
);

// Installable app + opens without internet (public/me/sw.js). Production only:
// in development the service worker would hold on to stale code.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/me/sw.js', { scope: '/me/' }).catch(() => undefined);
    // Everything this page loaded is kept, so the very first visit is already
    // enough to open without internet.
    const keep = () =>
      navigator.serviceWorker.ready.then((reg) => {
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => new URL(e.name))
          .filter((u) => u.origin === window.location.origin && u.pathname.startsWith('/assets/'))
          .map((u) => u.pathname);
        reg.active?.postMessage({ type: 'me-keep', urls: [...new Set(urls)] });
      });
    setTimeout(() => void keep().catch(() => undefined), 3000);
  });
}
