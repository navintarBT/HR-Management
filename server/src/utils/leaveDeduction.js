const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const { toDateKey } = require('./attendanceProcessor');
const { loadRestDaySchedules, restDaysOn } = require('./restDaySchedule');

function getAnniversary(hireDate) {
  if (!hireDate) return null;
  const d = new Date(hireDate);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

// asOf defaults to "now" for any future caller that genuinely wants live
// status (there is none today), but computeDeductionFields always passes the
// leave's own startDate — see the comment there for why "today" is the wrong
// reference point for this check.
function hasCompletedOneYear(hireDate, asOf = new Date()) {
  const anniversary = getAnniversary(hireDate);
  return !!anniversary && asOf >= anniversary;
}

function dateKeysInRange(startDate, endDate) {
  const keys = [];
  for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
    keys.push(toDateKey(d));
  }
  return keys;
}

// ມື້ທີ່ຕ້ອງຕັດເງີນ x1 / ປ are computed ONCE — at creation, or again on an edit
// that changes the dates — and then stored on the Leave document, never
// recomputed on a later read. An employee's tenure status can change after
// the fact, but a leave already filed keeps the numbers it had the day it was
// filed/edited; it does not silently change value just because time passed or
// they crossed their 1-year mark since. The one exception is their rest day
// itself changing over the leave's dates (recomputeLeavesAfterRestChange
// below). A day that lands on the employee's own rest day — the one in force
// on THAT day (utils/restDaySchedule.js) — was never really "taken off work"
// so it doesn't count toward either field. Of what's left (billableDays):
// someone under 1 year of service gets no free days at all (x1 = full
// billableDays, ປ stays 0 since the grace rule doesn't apply to them yet);
// someone who's completed the year gets the first 3 days of THIS request free
// — ປ shows how many of those 3 free days this request actually used (capped
// at 3, never higher), x1 shows only the excess beyond those 3 (monotonic:
// max(0, billableDays − 3), never drops back down as billableDays grows).
async function computeDeductionFields(employee, startDate, endDate, forceCompleted, currentDeductAmount) {
  const dateKeys = dateKeysInRange(startDate, endDate);
  const [overrides, schedules] = await Promise.all([
    Shift.find({ employee: employee._id, date: { $in: dateKeys } }, 'date status holiday').populate('holiday', 'name'),
    loadRestDaySchedules([employee._id], dateKeys[0], dateKeys[dateKeys.length - 1]),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.date, o]));
  const restRows = schedules.get(String(employee._id));

  // Two kinds of rest day a leave request can land on: the employee's own
  // recurring/one-off rest day (ວັນພັກປະຈຳ — a `holiday`-less 'rest' Shift, or
  // no override at all but the date matches the weekly rest day in force
  // then), or a company-wide closure (ວັນພັກຮ້ານ — a 'rest' Shift tagged with a
  // Holiday). Recorded per date so ຫມາຍເຫດ can spell out exactly which days
  // and which kind, rather than just a bare day count.
  const restDayOverlaps = [];
  for (const k of dateKeys) {
    const override = overrideMap.get(k);
    if (override) {
      if (override.status !== 'rest') continue; // a queued shift on what would be a rest day always wins — not a rest day at all
      if (override.holiday) {
        restDayOverlaps.push({ date: k, type: 'holiday', holidayName: override.holiday.name });
      } else {
        restDayOverlaps.push({ date: k, type: 'personal' });
      }
      continue;
    }
    const dow = new Date(`${k}T00:00:00`).getDay();
    if (restDaysOn(restRows, employee.defaultRestDay, k).includes(dow)) restDayOverlaps.push({ date: k, type: 'personal' });
  }
  const billableDays = dateKeys.length - restDayOverlaps.length;

  // The tenure check is always based on the LEAVE'S OWN dates, never on
  // "today" (the moment this happens to be processed) — a future-dated leave
  // filed early should still get the treatment its own days actually earn,
  // not whatever the employee's status happens to be on the day someone
  // clicks submit. forceCompleted lets the split path (see
  // splitIfStraddling) pin each half explicitly since a single startDate
  // can't represent two different tenure statuses at once; every other call
  // site omits it, so this falls back to checking the request's own
  // startDate — safe because splitIfStraddling has already ruled out any
  // straddling range reaching this point, so startDate and endDate are
  // guaranteed to fall on the same side of the anniversary.
  const completed = forceCompleted ?? hasCompletedOneYear(employee.hireDate, new Date(startDate));
  let deductDaysX1;
  let deductDaysX2;
  if (!completed) {
    deductDaysX1 = billableDays;
    deductDaysX2 = 0;
  } else {
    deductDaysX2 = Math.min(billableDays, 3);
    deductDaysX1 = Math.max(0, billableDays - 3);
  }

  const fields = { billableDays, deductDaysX1, deductDaysX2, restDayOverlaps };
  // x1 = 0 means there's nothing to deduct (still within the free days, or
  // not yet tenured long enough to owe anything either way) — the rate tier
  // is forced to X0 in that case, overriding whatever was picked, since any
  // of X1/X2/X3 would be multiplying zero days anyway. Otherwise, X1 (the
  // standard/no-extra-penalty rate) is the default whenever nothing has been
  // chosen yet — an admin who wants a harsher X2/X3 still picks that
  // explicitly. Only set the key when actually forcing/defaulting it —
  // leaving it out (rather than `undefined`) means the Object.assign at the
  // call sites won't clobber a real choice `currentDeductAmount` already
  // reflects.
  if (deductDaysX1 === 0) fields.deductAmount = 'X0';
  else if (!currentDeductAmount) fields.deductAmount = 'X1';
  return fields;
}

const sameOverlaps = (a, b) =>
  JSON.stringify((a ?? []).map((o) => [o.date, o.type])) === JSON.stringify((b ?? []).map((o) => [o.date, o.type]));

// An employee's rest day changed from `fromKey` on — their pending/approved
// leaves reaching that day are worked out again against it (which days are
// rest days, so billable, x1 and ປ), keeping each half's tenure branch as it
// was and the rate tier HR picked. One that had been forced to X0 (nothing to
// deduct) gets X1 back if it now has days to deduct, instead of staying at a
// zero rate. Each changed leave notes what moved, for ໃບລາ to show.
async function recomputeLeavesAfterRestChange(employeeId, fromKey, now = new Date()) {
  const leaves = await Leave.find({
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    endDate: { $gte: new Date(`${fromKey}T00:00:00`) },
  });
  if (!leaves.length) return 0;
  const employee = await Employee.findById(employeeId);
  if (!employee) return 0;
  let changed = 0;
  for (const leave of leaves) {
    const forceCompleted = leave.splitPart === 'before' ? false : leave.splitPart === 'after' ? true : undefined;
    // eslint-disable-next-line no-await-in-loop
    const fields = await computeDeductionFields(
      employee,
      leave.startDate,
      leave.endDate,
      forceCompleted,
      leave.deductAmount === 'X0' ? undefined : leave.deductAmount
    );
    const before = { billable: leave.billableDays, x1: leave.deductDaysX1, x2: leave.deductDaysX2 };
    const same =
      before.billable === fields.billableDays &&
      before.x1 === fields.deductDaysX1 &&
      before.x2 === fields.deductDaysX2 &&
      sameOverlaps(leave.restDayOverlaps, fields.restDayOverlaps);
    if (same) continue;
    Object.assign(leave, fields);
    leave.recalcNote = `ຄິດໃໝ່ ${toDateKey(now)} ເພາະວັນພັກປ່ຽນ: ມື້ທີ່ນັບ ${before.billable ?? '-'}→${fields.billableDays}, x1 ${before.x1 ?? '-'}→${fields.deductDaysX1}, ປ ${before.x2 ?? '-'}→${fields.deductDaysX2}`;
    // eslint-disable-next-line no-await-in-loop
    await leave.save();
    changed += 1;
  }
  return changed;
}

module.exports = { getAnniversary, hasCompletedOneYear, computeDeductionFields, recomputeLeavesAfterRestChange };
