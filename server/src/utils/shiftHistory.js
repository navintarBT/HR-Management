const ShiftChangeLog = require('../models/ShiftChangeLog');
const ShiftCategory = require('../models/ShiftCategory');

// Remembers when an employee's regular shift changed, so a day is always
// judged by the shift they actually had that day (see models/ShiftChangeLog.js
// for why that matters).

function idOf(value) {
  if (!value) return null;
  return typeof value === 'object' && value._id ? value._id : value;
}

// The regular-shift fields that decide it — what's compared to tell whether a
// save actually changed someone's shift.
function shiftFieldsDiffer(a, b) {
  return (
    String(idOf(a?.defaultShiftCategory) ?? '') !== String(idOf(b?.defaultShiftCategory) ?? '') ||
    (a?.defaultShiftStart || null) !== (b?.defaultShiftStart || null) ||
    (a?.defaultShiftEnd || null) !== (b?.defaultShiftEnd || null)
  );
}

// An employee's regular shift as {category, startTime, endTime}, with the
// times read off the category when there is one — so a later edit to the
// category's hours doesn't rewrite what a past day was.
async function snapshotShift({ defaultShiftCategory, defaultShiftStart, defaultShiftEnd } = {}) {
  const categoryId = idOf(defaultShiftCategory);
  if (categoryId) {
    const category = defaultShiftCategory?.startTime ? defaultShiftCategory : await ShiftCategory.findById(categoryId);
    if (category) return { category: categoryId, startTime: category.startTime, endTime: category.endTime };
  }
  if (defaultShiftStart && defaultShiftEnd) return { category: null, startTime: defaultShiftStart, endTime: defaultShiftEnd };
  return { category: null, startTime: null, endTime: null };
}

function sameShift(a, b) {
  return (
    String(a?.category ?? '') === String(b?.category ?? '') &&
    (a?.startTime ?? null) === (b?.startTime ?? null) &&
    (a?.endTime ?? null) === (b?.endTime ?? null)
  );
}

// Records that an employee's regular shift went from `before` to `after`
// (each { defaultShiftCategory, defaultShiftStart, defaultShiftEnd }) as of
// `effectiveDate`. Two changes on the same date collapse into one row that
// keeps the first one's "previous"; a change that ends up back where that day
// started leaves no row at all.
async function recordShiftChange(employeeId, before, after, effectiveDate, source) {
  const [previous, next] = await Promise.all([snapshotShift(before), snapshotShift(after)]);
  const existing = await ShiftChangeLog.findOne({ employee: employeeId, effectiveDate });
  if (existing) {
    if (sameShift(existing.previous, next)) {
      await existing.deleteOne();
      return null;
    }
    existing.next = next;
    existing.source = source;
    await existing.save();
    return existing;
  }
  if (sameShift(previous, next)) return null;
  return ShiftChangeLog.create({ employee: employeeId, effectiveDate, previous, next, source });
}

// From an employee's change rows (any order): the regular shift in force on
// dateKey — or null when nothing has changed since that date, meaning the
// live setting on the Employee applies.
function shiftOnDate(logs, dateKey) {
  if (!logs?.length) return null;
  const sorted = [...logs].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (dateKey >= sorted.at(-1).effectiveDate) return null;
  let inForce = sorted[0].previous;
  for (const log of sorted) {
    if (log.effectiveDate > dateKey) break;
    inForce = log.next;
  }
  return inForce ?? { category: null, startTime: null, endTime: null };
}

async function shiftLogsFor(employeeId) {
  return ShiftChangeLog.find({ employee: employeeId }, 'effectiveDate previous next').lean();
}

module.exports = { shiftFieldsDiffer, snapshotShift, recordShiftChange, shiftOnDate, shiftLogsFor };
