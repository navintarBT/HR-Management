import dayjs from 'dayjs';
import type { Evidence, Kind, Today } from './evidence';
import type { QueuedPhoto } from './queue';

// One of the shift's two photos: on the server, or waiting on the phone.
export interface SlotNow {
  takenAt?: string;
  waiting?: boolean;
}

// The shift the next photo is for. Without internet it comes from what the
// server last said (kept on the phone), plus the photos still waiting here —
// so the second photo taken offline is the out, not another in.
export interface ShiftNow {
  date: string;
  shift: Today['shift'];
  // A day with no shift that runs noon to noon (see Kept.night).
  night: boolean;
  in: SlotNow | null;
  out: SlotNow | null;
  storageFull: boolean;
}

export interface Kept {
  owner: string;
  date: string;
  shift: Today['shift'];
  // No shift, works nights: the day runs noon to noon, so the small hours
  // belong to the evening before (server: attendanceProcessor resolveShiftWindow).
  night?: boolean;
  in: string | null;
  out: string | null;
  storageFull: boolean;
}

const KEY = 'me_today';
// The server keeps a night's small hours with the evening before until this
// long after the shift ends (server: attendanceProcessor OVERNIGHT_BUFFER_HOURS).
const AFTER_END_HOURS = 3;

export function keepToday(owner: string, today: Today): Kept {
  const kept: Kept = {
    owner,
    date: today.date,
    shift: today.shift,
    night: !!today.night,
    in: today.in ? today.in.takenAt ?? today.in.uploadedAt : null,
    out: today.out ? today.out.takenAt ?? today.out.uploadedAt : null,
    storageFull: today.storageFull,
  };
  save(kept);
  return kept;
}

export function save(kept: Kept) {
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // private mode: only this visit knows
  }
}

export function keptToday(owner: string): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Kept | null;
    return kept && kept.owner === owner ? kept : null;
  } catch {
    return null;
  }
}

// A photo that has just reached the server, before the server is asked again.
export function withSent(kept: Kept | null, sent: Evidence[]): Kept | null {
  return sent.reduce<Kept | null>((k, e) => {
    if (!k || e.date < k.date) return k;
    const base = e.date === k.date ? k : { ...k, date: e.date, in: null, out: null };
    return { ...base, [e.kind]: e.takenAt ?? e.uploadedAt };
  }, kept);
}

const overnight = (shift: Today['shift']) => !!shift && shift.end <= shift.start;
// The hour a night worker's day with no shift starts (server: NIGHT_DAY_START_HOUR).
const NIGHT_DAY_START_HOUR = 12;
const runsNoonToNoon = (kept: Kept) => !kept.shift && !!kept.night;
// When shift-day `date` is over and the next one begins.
function over(date: string, shift: Today['shift'], night = false) {
  if (!shift && night) return dayjs(date).add(1, 'day').hour(NIGHT_DAY_START_HOUR).startOf('hour');
  if (!shift || !overnight(shift)) return dayjs(date).add(1, 'day');
  const [h, m] = shift.end.split(':').map(Number);
  return dayjs(date).add(1, 'day').hour(h).minute(m).add(AFTER_END_HOURS, 'hour');
}

// The shift-day it is now. Null when nothing at all is known (first time
// opened without internet) — the server then places the photo by its time.
export function shiftNow(kept: Kept | null, queued: QueuedPhoto[], now = dayjs()): ShiftNow | null {
  if (!kept) return null;
  let date = kept.date;
  let slots = { in: kept.in, out: kept.out };
  const night = runsNoonToNoon(kept);
  if (!now.isBefore(over(kept.date, kept.shift, night))) {
    // A new shift-day since the server was last asked: nothing sent for it yet.
    const yesterday = now.subtract(1, 'day').format('YYYY-MM-DD');
    date = (overnight(kept.shift) || night) && now.isBefore(over(yesterday, kept.shift, night)) ? yesterday : now.format('YYYY-MM-DD');
    slots = { in: null, out: null };
  }
  const slot = (kind: Kind): SlotNow | null => {
    const waiting = queued.filter((q) => q.date === date && q.kind === kind && !q.editId && !q.error).pop();
    if (waiting) return { takenAt: waiting.takenAt, waiting: true };
    return slots[kind] ? { takenAt: slots[kind]! } : null;
  };
  return { date, shift: kept.shift, night, in: slot('in'), out: slot('out'), storageFull: kept.storageFull };
}

// The next photo this shift needs: in first, then out (once both are in, a
// new one replaces out — changeable on the review sheet).
export const nextKind = (now: ShiftNow | null): Kind => (now?.in ? 'out' : 'in');
