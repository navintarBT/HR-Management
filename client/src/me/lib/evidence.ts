import { API_URL } from '../../providers/axios';
import { meApi } from '../api';
import type { PreparedPhoto } from './image';
import { enqueue, queuedPhotos, removeQueued, updateQueued, type QueuedPhoto } from './queue';

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
  in: Evidence | null;
  out: Evidence | null;
  storageFull: boolean;
}

// Image links are signed by the server and work in a plain <img>.
export const imageSrc = (path: string) => `${API_URL}${path}`;

export const getToday = () => meApi.get<Today>('/me/evidence/today').then((r) => r.data);
export const listEvidence = () => meApi.get<Evidence[]>('/me/evidence').then((r) => r.data);
export const updateEvidence = (id: string, fields: { date?: string; kind?: Kind; note?: string }) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
  return meApi.patch<Evidence>(`/me/evidence/${id}`, form).then((r) => r.data);
};

export type SendResult =
  | { status: 'sent'; evidence: Evidence }
  | { status: 'queued' }
  | { status: 'needsKind'; message: string }
  | { status: 'error'; message: string };

interface Upload {
  photo: Blob;
  thumb: Blob;
  takenAt: string;
  date?: string;
  kind?: Kind;
  note?: string;
  editId?: string;
}

async function upload(item: Upload) {
  const form = new FormData();
  form.append('photo', item.photo, 'photo.jpg');
  form.append('thumb', item.thumb, 'thumb.jpg');
  form.append('takenAt', item.takenAt);
  if (item.date) form.append('date', item.date);
  if (item.kind) form.append('kind', item.kind);
  if (item.note !== undefined) form.append('note', item.note);
  const res = item.editId ? await meApi.patch<Evidence>(`/me/evidence/${item.editId}`, form) : await meApi.post<Evidence>('/me/evidence', form);
  return res.data;
}

const isOffline = (err: any) => !err?.response;

// Sends one photo. No internet → it waits on the phone and goes later.
export async function sendPhoto(prepared: PreparedPhoto, options: { date?: string; kind?: Kind; note?: string; editId?: string }): Promise<SendResult> {
  const item: Upload = { photo: prepared.photo, thumb: prepared.thumb, takenAt: prepared.takenAt, ...options };
  try {
    return { status: 'sent', evidence: await upload(item) };
  } catch (err: any) {
    if (isOffline(err)) {
      await enqueue(item);
      return { status: 'queued' };
    }
    if (err.response?.data?.needsKind) return { status: 'needsKind', message: err.response.data.message };
    return { status: 'error', message: err.response?.data?.message || 'ສົ່ງບໍ່ສຳເລັດ' };
  }
}

// Sends whatever is waiting, oldest first; stops at the first sign of still
// being offline. A photo the server turns down stays, with the reason.
// Returns how many went — 0 to a call made while one is already running, so
// "sent" is announced once.
let flushing: Promise<number> | null = null;
export function flushQueue(): Promise<number> {
  if (flushing) return flushing.then(() => 0);
  flushing = (async () => {
    let sent = 0;
    for (const item of await queuedPhotos()) {
      if (item.error) continue;
      try {
        await upload(item);
        await removeQueued(item.id);
        sent += 1;
      } catch (err: any) {
        if (isOffline(err)) break;
        await updateQueued({ ...item, error: err.response?.data?.message || 'ສົ່ງບໍ່ສຳເລັດ' } as QueuedPhoto);
      }
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
