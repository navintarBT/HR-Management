const Position = require('../models/Position');
const { toDateKey } = require('./attendanceProcessor');

// Given an already-loaded position doc and a requested rest-day weekday
// (0=Sun..6=Sat), returns the weekday that should actually be used:
// unchanged if the position has no objection, its configured fallback if it
// does and one is set, or throws if it does and none is set. Sick leave and
// company-wide holiday closures go through entirely separate code paths and
// never call this at all — only a deliberately *chosen* rest day is ever
// redirected or rejected.
function resolveRestDayForPosition(position, dayOfWeek) {
  if (!position || dayOfWeek == null || !position.restrictedRestDays?.length) return dayOfWeek;
  if (!position.restrictedRestDays.includes(dayOfWeek)) return dayOfWeek;
  if (position.restDayFallback != null) return position.restDayFallback;
  const err = new Error('ຕຳແໜ່ງນີ້ບໍ່ອະນຸຍາດໃຫ້ຕັ້ງວັນພັກໃນວັນນີ້');
  err.status = 400;
  throw err;
}

// Same, but takes a position id and loads it — for callers that don't
// already have the position doc in hand. positionSwap.js already loads both
// position docs for its own reasons, so it calls resolveRestDayForPosition
// directly instead of re-fetching per employee.
async function resolveRestDay(positionId, dayOfWeek) {
  if (!positionId || dayOfWeek == null) return dayOfWeek;
  const position = await Position.findById(positionId);
  return resolveRestDayForPosition(position, dayOfWeek);
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
