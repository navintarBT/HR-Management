// Every photo is kept here, on the phone (IndexedDB), from the moment it's
// taken until the server has it (lib/evidence.ts flushQueue) — a lost signal, a
// closed app or a forgotten "send" doesn't lose it. The service worker
// (public/me/sw.js) reads the same store to send while the app is closed, so
// the names and fields here are used there too.
export interface QueuedPhoto {
  id: string;
  // The employee whose account took it — never sent under anyone else's, when
  // another person signs in on the same phone. (None on photos from before
  // 26/11/2026.)
  owner?: string;
  date?: string;
  kind?: 'in' | 'out';
  // Set when the photo replaces one already sent (PATCH instead of POST).
  editId?: string;
  takenAt: string;
  note?: string;
  photo: Blob;
  thumb: Blob;
  createdAt: string;
  // Taken but not sent yet: still on the review sheet, or left there.
  draft?: boolean;
  // A draft that goes by itself from this moment (a photo of the shift in
  // progress from the app's own camera); without it the draft waits for a tap.
  sendAfter?: number;
  // Why the server turned it down, if it did — kept for the employee to see.
  error?: string;
}

type Stored = Omit<QueuedPhoto, 'photo' | 'thumb'> & { photo: Blob | ArrayBuffer; thumb: Blob | ArrayBuffer };

const DB_NAME = 'romeo-me';
const STORE = 'queue';
const CHANGED = 'me-queue-changed';
// Without IndexedDB (some private modes) photos wait in memory for this visit.
const memory = new Map<string, QueuedPhoto>();
// Photos still being written — changing or removing one waits for that.
const writing = new Map<string, Promise<void>>();

let connection: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  connection ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        db.onclose = () => (connection = null);
        resolve(db);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    // Try again next time rather than staying without it.
    if (!db) connection = null;
    return db;
  });
  return connection;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) throw new Error('no storage');
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      // The browser closed the connection (iOS does, in the background).
      connection = null;
      reject(err);
      return;
    }
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    // A full phone aborts the write without an error event.
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}
// Once more with a fresh connection if the first try fails.
const tryTwice = <T>(work: () => Promise<T>) => work().catch(() => work());

const announce = () => window.dispatchEvent(new Event(CHANGED));
export const queueChanged = announce;
export const onQueueChanged = (handler: () => void) => {
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
};

const asBlob = (data: Blob | ArrayBuffer) => (data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' }));
const fromStored = (item: Stored): QueuedPhoto => ({ ...item, photo: asBlob(item.photo), thumb: asBlob(item.thumb) });

export async function queuedPhotos(): Promise<QueuedPhoto[]> {
  const stored = (await tryTwice(() => run<Stored[]>('readonly', (s) => s.getAll())).catch(() => undefined)) ?? [];
  return [...stored.map(fromStored), ...memory.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const newPhotoId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function enqueue(item: Omit<QueuedPhoto, 'createdAt'>): Promise<void> {
  const full: QueuedPhoto = { ...item, createdAt: new Date().toISOString() };
  const write = (async () => {
    // Plain bytes: some iPhones can't keep an image Blob in IndexedDB.
    const bytes = await Promise.all([full.photo.arrayBuffer(), full.thumb.arrayBuffer()]).catch(() => null);
    const stored: Stored = bytes ? { ...full, photo: bytes[0], thumb: bytes[1] } : full;
    await tryTwice(() => run('readwrite', (s) => s.put(stored))).catch(() => memory.set(full.id, full));
    announce();
  })().finally(() => writing.delete(full.id));
  writing.set(full.id, write);
  return write;
}

export async function patchQueued(id: string, patch: Partial<Omit<QueuedPhoto, 'id' | 'photo' | 'thumb'>>) {
  await writing.get(id);
  const held = memory.get(id);
  if (held) memory.set(id, { ...held, ...patch });
  else {
    await tryTwice(() =>
      run('readwrite', (s) => {
        const get = s.get(id);
        get.onsuccess = () => {
          if (get.result) s.put({ ...get.result, ...patch });
        };
      })
    ).catch(() => undefined);
  }
  announce();
}

export async function removeQueued(id: string) {
  await writing.get(id);
  memory.delete(id);
  await tryTwice(() => run('readwrite', (s) => s.delete(id))).catch(() => undefined);
  announce();
}

// Asks the browser not to clear the app's storage when the phone runs low.
export function keepStorage() {
  void navigator.storage?.persist?.().catch(() => undefined);
}

// Lets the phone send what's waiting once there's internet even with the app
// closed (Android; an iPhone sends when the app is next opened).
export function requestBackgroundSend() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('me-send'))
    .catch(() => undefined);
}
