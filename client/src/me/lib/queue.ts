// Photos taken while there's no internet wait here, on the phone (IndexedDB),
// and go out by themselves once it's back (lib/evidence.ts flushQueue).
export interface QueuedPhoto {
  id: string;
  date?: string;
  kind?: 'in' | 'out';
  // Set when the photo replaces one already sent (PATCH instead of POST).
  editId?: string;
  takenAt: string;
  note?: string;
  photo: Blob;
  thumb: Blob;
  createdAt: string;
  // Why the server turned it down, if it did — kept for the employee to see.
  error?: string;
}

const DB_NAME = 'romeo-me';
const STORE = 'queue';
const CHANGED = 'me-queue-changed';
// Without IndexedDB (some private modes) photos wait in memory for this visit.
const memory = new Map<string, QueuedPhoto>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

const announce = () => window.dispatchEvent(new Event(CHANGED));
export const onQueueChanged = (handler: () => void) => {
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
};

export async function queuedPhotos(): Promise<QueuedPhoto[]> {
  const stored = (await run<QueuedPhoto[]>('readonly', (s) => s.getAll()).catch(() => undefined)) ?? [];
  return [...stored, ...memory.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueue(item: Omit<QueuedPhoto, 'id' | 'createdAt'>) {
  const full: QueuedPhoto = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString() };
  const saved = await run('readwrite', (s) => s.put(full)).then(() => true, () => false);
  if (!saved || !(await openDb())) memory.set(full.id, full);
  announce();
}

export async function updateQueued(item: QueuedPhoto) {
  if (memory.has(item.id)) memory.set(item.id, item);
  else await run('readwrite', (s) => s.put(item)).catch(() => undefined);
  announce();
}

export async function removeQueued(id: string) {
  memory.delete(id);
  await run('readwrite', (s) => s.delete(id)).catch(() => undefined);
  announce();
}
