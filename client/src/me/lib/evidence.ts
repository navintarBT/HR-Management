import { API_URL } from '../../providers/axios';
import { meApi } from '../api';
import { requestFailed } from './connection';
import { patchQueued, queueChanged, queuedPhotos, removeQueued, type QueuedPhoto } from './queue';

export type Kind = 'in' | 'out';

export interface Evidence {
  _id: string;
  date: string;
  kind: Kind;
  takenAt?: string;
  uploadedAt: string;
  backdated: boolean;
  duplicate: boolean;
  note: string;
  editedAt?: string | null;
  thumbUrl: string;
  photoUrl: string;
  history: { takenAt?: string; uploadedAt?: string; replacedAt?: string; thumbUrl: string; photoUrl: string }[];
}

export interface Today {
  date: string;
  shift: { start: string; end: string } | null;
  // No shift, and the day runs noon to noon (a DJ — server: resolveShiftWindow).
  night?: boolean;
  in: Evidence | null;
  out: Evidence | null;
  storageFull: boolean;
}

// Image links are signed by the server and work in a plain <img>.
export const imageSrc = (path: string) => `${API_URL}${path}`;

// A request that gets no answer in this long counts as no internet.
const READ_TIMEOUT = 20000;
const UPLOAD_TIMEOUT = 60000;

export const getToday = () => meApi.get<Today>('/me/evidence/today', { timeout: READ_TIMEOUT }).then((r) => r.data);
export const listEvidence = () => meApi.get<Evidence[]>('/me/evidence', { timeout: READ_TIMEOUT }).then((r) => r.data);
export const updateEvidence = (id: string, fields: { date?: string; kind?: Kind; note?: string }) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
  return meApi.patch<Evidence>(`/me/evidence/${id}`, form, { timeout: READ_TIMEOUT }).then((r) => r.data);
};

async function upload(item: QueuedPhoto) {
  const form = new FormData();
  form.append('photo', item.photo, 'photo.jpg');
  form.append('thumb', item.thumb, 'thumb.jpg');
  form.append('clientId', item.id);
  form.append('takenAt', item.takenAt);
  if (item.date) form.append('date', item.date);
  if (item.kind) form.append('kind', item.kind);
  if (item.note !== undefined) form.append('note', item.note);
  const config = { timeout: UPLOAD_TIMEOUT };
  const res = item.editId
    ? await meApi.patch<Evidence>(`/me/evidence/${item.editId}`, form, config)
    : await meApi.post<Evidence>('/me/evidence', form, config);
  return res.data;
}

// Worth sending again by itself later: no answer, signed out meanwhile, too
// many at once, the server restarting or full. Anything else is the server
// turning this photo down — kept, with the reason, for the employee to fix.
const tryAgainLater = (status?: number) => !status || [401, 408, 425, 429].includes(status) || status >= 500;

// The photo on the review sheet: not sent from under the person looking at it.
let held: string | null = null;
export const hold = (id: string) => {
  held = id;
};
export const release = (id: string) => {
  if (held === id) held = null;
};

let sending: string | null = null;
export const sendingId = () => sending;

// Never someone else's photo on the same phone.
export const isMine = (item: QueuedPhoto, owner: string) => !item.owner || item.owner === owner;
// Sent by the person, or a draft whose time has come.
export const isDue = (item: QueuedPhoto, now = Date.now()) =>
  !item.error && item.id !== held && (!item.draft || (item.sendAfter !== undefined && item.sendAfter <= now));

// One at a time, across the app's windows and its service worker.
async function alone(work: () => Promise<void>) {
  if (!navigator.locks) return work();
  await navigator.locks.request('me-send', { ifAvailable: true }, async (lock) => {
    if (lock) await work();
  });
}

// Sends whatever is due, oldest first; stops when the server can't be reached.
// Returns what went — nothing to a call made while one is already running, so
// "sent" is announced once.
let running: Promise<Evidence[]> | null = null;
export function flushQueue(owner: string): Promise<Evidence[]> {
  if (running) return running.then(() => []);
  running = (async () => {
    const sent: Evidence[] = [];
    await alone(async () => {
      const tried = new Set<string>();
      for (;;) {
        const item = (await queuedPhotos()).find((q) => isMine(q, owner) && isDue(q) && !tried.has(q.id));
        if (!item) return;
        tried.add(item.id);
        sending = item.id;
        queueChanged();
        try {
          const evidence = await upload(item);
          await removeQueued(item.id);
          sent.push(evidence);
        } catch (err: any) {
          const status: number | undefined = err?.response?.status;
          if (tryAgainLater(status)) {
            if (status && status >= 500) requestFailed();
            return;
          }
          await patchQueued(item.id, { draft: false, error: err.response?.data?.message || 'ສົ່ງບໍ່ສຳເລັດ' });
        } finally {
          sending = null;
          queueChanged();
        }
      }
    });
    return sent;
  })().finally(() => {
    running = null;
  });
  return running;
}
