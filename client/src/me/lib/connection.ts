import { useSyncExternalStore } from 'react';
import { API_URL } from '../../providers/axios';

// Whether the server can be reached right now — not just whether the phone
// thinks it has a signal (Wi-Fi without internet says it does). Every request
// reports back (api.ts); once one fails, the server is asked again every few
// seconds until it answers.
//   online — fine; offline — the phone says it has no internet;
//   unreachable — it says it has, but the server doesn't answer.
export type Connection = 'online' | 'offline' | 'unreachable';

const PROBE_EVERY = 6000;
const PROBE_TIMEOUT = 8000;

let state: Connection = navigator.onLine === false ? 'offline' : 'online';
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

export const connection = () => state;

function set(next: Connection) {
  if (next !== 'online') schedule();
  if (next === state) return;
  state = next;
  if (next === 'online' && timer) {
    clearTimeout(timer);
    timer = null;
  }
  listeners.forEach((l) => l());
}

function schedule() {
  timer ??= setTimeout(() => {
    timer = null;
    void probe();
  }, PROBE_EVERY);
}

async function probe() {
  if (document.hidden) return schedule();
  const stop = new AbortController();
  const limit = setTimeout(() => stop.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store', signal: stop.signal });
    if (res.ok) set('online');
    else set('unreachable');
  } catch {
    set(navigator.onLine === false ? 'offline' : 'unreachable');
  } finally {
    clearTimeout(limit);
  }
}

export const requestWorked = () => set('online');
export const requestFailed = () => set(navigator.onLine === false ? 'offline' : 'unreachable');
export const checkConnection = () => void probe();

window.addEventListener('offline', () => set('offline'));
window.addEventListener('online', () => void probe());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state !== 'online') void probe();
});
if (state !== 'online') schedule();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const onConnectionChanged = subscribe;
export const useConnection = () => useSyncExternalStore(subscribe, connection);
