import type { Shift } from '../types';

// Mirrors pickDayOverride in server/src/utils/attendanceProcessor.js — keep
// the two in step. When one person has more than one Shift row on a date, a
// working shift wins over a swapped-blank day, which wins over a rest day,
// and 'cancelled' never counts — the order ສະຫຼຸບເງິນເດືອນ, ປະຫວັດການສະແກນ and
// the absence sweep all follow.
const OVERRIDE_PRECEDENCE: Shift['status'][] = ['scheduled', 'swapped', 'rest'];

export function preferredOverride(current: Shift | undefined, candidate: Shift): Shift | undefined {
  const rank = OVERRIDE_PRECEDENCE.indexOf(candidate.status);
  if (rank === -1) return current;
  if (!current || rank < OVERRIDE_PRECEDENCE.indexOf(current.status)) return candidate;
  return current;
}
