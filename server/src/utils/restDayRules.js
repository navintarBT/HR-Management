const Position = require('../models/Position');
const { toDateKey } = require('./attendanceProcessor');

// Given an already-loaded position doc and the requested rest-day weekdays
// (0=Sun..6=Sat, one or more), returns the weekdays that should actually be
// used: each one unchanged if the position has no objection to it, redirected
// to the position's configured fallback if it does and one is set, or throws
// if it does and none is set — same per-day rule whether there's one day or
// several, deduplicated in case two different days both fall back to the same
// one. Sick leave and company-wide holiday closures go through entirely
// separate code paths and never call this at all — only deliberately *chosen*
// rest days are ever redirected or rejected.
function resolveRestDayForPosition(position, daysOfWeek) {
  const days = Array.isArray(daysOfWeek) ? daysOfWeek : daysOfWeek == null ? [] : [daysOfWeek];
  if (!position || !position.restrictedRestDays?.length) return days;
  const resolved = days.map((dow) => {
    if (!position.restrictedRestDays.includes(dow)) return dow;
    if (position.restDayFallback != null) return position.restDayFallback;
    const err = new Error('ຕຳແໜ່ງນີ້ບໍ່ອະນຸຍາດໃຫ້ຕັ້ງວັນພັກໃນມື້ນີ້');
    err.status = 400;
    throw err;
  });
  return Array.from(new Set(resolved));
}

// Same, but takes a position id and loads it — for callers that don't
// already have the position doc in hand. positionSwap.js already loads both
// position docs for its own reasons, so it calls resolveRestDayForPosition
// directly instead of re-fetching per employee.
async function resolveRestDay(positionId, daysOfWeek) {
  const days = Array.isArray(daysOfWeek) ? daysOfWeek : daysOfWeek == null ? [] : [daysOfWeek];
  if (!positionId || !days.length) return days;
  const position = await Position.findById(positionId);
  return resolveRestDayForPosition(position, days);
}

// Shifts a YYYY-MM-DD date to the nearest calendar date (forward or
// backward, whichever is closer — always unique since candidate weekdays are
// never more than 3 days apart either way) that falls on `targetDow`. Used
// when a one-off rest-day pick lands on a day the position forbids and gets
// redirected to a fallback weekday: the date itself has to move to match,
// not just the weekday number.
function nearestDateForWeekday(dateKey, targetDow) {
  const d = new Date(`${dateKey}T00:00:00`);
  const currentDow = d.getDay();
  if (currentDow === targetDow) return dateKey;
  const forward = (targetDow - currentDow + 7) % 7;
  const backward = (currentDow - targetDow + 7) % 7;
  const shift = forward <= backward ? forward : -backward;
  d.setDate(d.getDate() + shift);
  return toDateKey(d);
}

module.exports = { resolveRestDay, resolveRestDayForPosition, nearestDateForWeekday };
