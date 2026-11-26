// Service worker for the employees' app (/me): keeps the app itself on the
// phone so it opens without internet, and sends photos still waiting there once
// there's internet even with the app closed (Background Sync — Android; an
// iPhone sends when the app is next opened). Never caches the API — evidence
// and sign-in always go to the server.
const CACHE = 'romeo-me-v2';
const SHELL = ['/me/', '/me/manifest.webmanifest', '/me/icon-192.png', '/logo.png'];
// A page that takes longer than this comes from the phone instead.
const PAGE_WAIT = 4000;

// A file that's gone from the host comes back as the app's page (its rewrites)
// — kept under a script's name it would break the app for good.
const keepable = (res, url) => res.ok && !(new URL(url).pathname.startsWith('/assets/') && (res.headers.get('content-type') || '').includes('text/html'));

// These files and every other built file they name — the parts the app only
// loads when it needs them must be there without internet too.
async function keep(paths) {
  const cache = await caches.open(CACHE);
  const todo = [...paths];
  const seen = new Set();
  while (todo.length) {
    const path = todo.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, self.location.origin).href;
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url).catch(() => null);
      if (!res || !keepable(res, url)) continue;
      await cache.put(url, res.clone());
    }
    if (!path.endsWith('.js')) continue;
    const code = await res.clone().text();
    for (const [, name] of code.matchAll(/["'`](?:\.\/|\/?assets\/)([\w.-]+\.(?:js|css))["'`]/g)) todo.push(`/assets/${name}`);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The app's own scripts, kept after its first visit (src/me/main.tsx).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'me-keep') event.waitUntil(keep(event.data.urls || []));
});

async function page(request) {
  const fresh = fetch(request).then(async (res) => {
    if (res.ok) (await caches.open(CACHE)).put('/me/', res.clone());
    return res;
  });
  const kept = await caches.match('/me/');
  if (!kept) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(kept), PAGE_WAIT));
  return Promise.race([fresh.catch(() => kept), slow]);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // The app's page: the newest from the network, the kept copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }

  // Built files are named by their content, so a kept copy is always right.
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (keepable(res, request.url)) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
    );
  }
});

// ---- Sending what waits on the phone while the app is closed. The same store
// and rules as src/me/lib/queue.ts and evidence.ts.

function open(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    // Not made yet: nothing waiting, and the app makes it its own way.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function ask(db, store, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request && request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const tryAgainLater = (status) => [401, 408, 425, 429].includes(status) || status >= 500;
const blob = (data) => (data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' }));

async function sendWaiting() {
  const sessions = await open('romeo-me-session').catch(() => null);
  if (!sessions) return;
  const session = await ask(sessions, 'kv', 'readonly', (s) => s.get('session'));
  sessions.close();
  if (!session) return; // signed out: they wait for their owner
  const db = await open('romeo-me').catch(() => null);
  if (!db) return;
  try {
    // The app is closed, so a photo left on the review sheet that was to go by
    // itself is due now.
    const due = (await ask(db, 'queue', 'readonly', (s) => s.getAll()))
      .filter((q) => !q.error && (!q.owner || q.owner === session.owner) && (!q.draft || q.sendAfter))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of due) {
      const form = new FormData();
      form.append('photo', blob(item.photo), 'photo.jpg');
      form.append('thumb', blob(item.thumb), 'thumb.jpg');
      form.append('clientId', item.id);
      form.append('takenAt', item.takenAt);
      if (item.date) form.append('date', item.date);
      if (item.kind) form.append('kind', item.kind);
      if (item.note !== undefined) form.append('note', item.note);
      const res = await fetch(`${session.api}/me/evidence${item.editId ? `/${item.editId}` : ''}`, {
        method: item.editId ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: form,
      });
      if (res.ok) await ask(db, 'queue', 'readwrite', (s) => s.delete(item.id));
      else if (tryAgainLater(res.status)) throw new Error(`server ${res.status}`);
      else {
        const body = await res.json().catch(() => ({}));
        await ask(db, 'queue', 'readwrite', (s) => s.put({ ...item, draft: false, error: body.message || 'ສົ່ງບໍ່ສຳເລັດ' }));
      }
    }
  } finally {
    db.close();
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'me-send') return;
  event.waitUntil(
    (async () => {
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((c) => new URL(c.url).pathname.startsWith('/me'));
      if (windows.some((c) => c.visibilityState === 'visible')) {
        // The app is on screen: it sends, and shows it. Asked again later, in
        // case it's closed before it could.
        windows.forEach((c) => c.postMessage({ type: 'me-flush' }));
        const db = await open('romeo-me').catch(() => null);
        if (!db) return;
        const left = await ask(db, 'queue', 'readonly', (s) => s.getAll()).finally(() => db.close());
        if (left.some((q) => !q.error && (!q.draft || q.sendAfter)) && !event.lastChance) throw new Error('still waiting');
        return;
      }
      // Never at the same time as the app itself (evidence.ts takes the same lock).
      const done = await self.navigator.locks.request('me-send', { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        await sendWaiting();
        return true;
      });
      if (!done && !event.lastChance) throw new Error('busy');
    })()
  );
});
