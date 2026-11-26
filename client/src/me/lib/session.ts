// What the service worker (public/me/sw.js) needs to send waiting photos while
// the app is closed: it can't read localStorage, so the sign-in is kept here
// too — and removed on signing out.
const DB_NAME = 'romeo-me-session';
const STORE = 'kv';

interface Session {
  token: string;
  owner: string;
  api: string;
}

function write(value: Session | null): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE, 'readwrite');
        if (value) tx.objectStore(STORE).put(value, 'session');
        else tx.objectStore(STORE).delete('session');
        const end = () => {
          db.close();
          resolve();
        };
        tx.oncomplete = end;
        tx.onerror = end;
        tx.onabort = end;
      };
    } catch {
      resolve();
    }
  });
}

export const keepSession = (session: Session) => void write(session);
export const dropSession = () => void write(null);
