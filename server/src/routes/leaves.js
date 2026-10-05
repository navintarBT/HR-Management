const mongoose = require('mongoose');
const express = require('express');
const Leave = require('../models/Leave');
const AttendanceDaily = require('../models/AttendanceDaily');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const { authenticate, requireRole } = require('../middleware/auth');
const { markLeave, recomputeDay, toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

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
// recomputed on a later read. An employee's tenure status (and their
// rest-day setup) can change after the fact, but a leave already filed keeps
// exactly the numbers it had the day it was filed/edited; it does not
// silently change value just because time passed or they crossed their
// 1-year mark since. A day that lands on the employee's own rest day was
// never really "taken off work" so it doesn't count toward either field. Of
// what's left (billableDays): someone under 1 year of service gets no free
// days at all (x1 = full billableDays, ປ stays 0 since the grace rule
// doesn't apply to them yet); someone who's completed the year gets the
// first 3 days of THIS request free — ປ shows how many of those 3 free days
// this request actually used (capped at 3, never higher), x1 shows only the
// excess beyond those 3 (monotonic: max(0, billableDays − 3), never drops
// back down as billableDays grows).
async function computeDeductionFields(employee, startDate, endDate, forceCompleted, currentDeductAmount) {
  const dateKeys = dateKeysInRange(startDate, endDate);
  const overrides = await Shift.find({ employee: employee._id, date: { $in: dateKeys } }, 'date status holiday').populate('holiday', 'name');
  const overrideMap = new Map(overrides.map((o) => [o.date, o]));

  // Two kinds of rest day a leave request can land on: the employee's own
  // recurring/one-off rest day (ວັນພັກປະຈຳ — a `holiday`-less 'rest' Shift, or
  // no override at all but the date matches their weekly defaultRestDay), or
  // a company-wide closure (ວັນພັກຮ້ານ — a 'rest' Shift tagged with a Holiday).
  // Recorded per date so ຫມາຍເຫດ can spell out exactly which days and which
  // kind, rather than just a bare day count.
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
    if (employee.defaultRestDay === dow) restDayOverlaps.push({ date: k, type: 'personal' });
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

// A leave whose range crosses the employee's own 1-year-tenure anniversary
// gets split into two linked documents (Leave.splitGroupId/splitPart) — one
// covering the days before the anniversary, one covering the anniversary day
// onward — so each side is judged by the tenure status that actually applied
// to ITS OWN days, instead of one all-or-nothing check for the whole range.
// This only matters once per employee: after their first anniversary,
// hasCompletedOneYear is true for every day from then on, so no later
// request can ever straddle anything again. Returns null when the range
// doesn't straddle (the normal, single-record path applies).
function splitIfStraddling(employee, startDate, endDate) {
  const anniversary = getAnniversary(employee.hireDate);
  if (!anniversary) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start >= anniversary || end < anniversary) return null;

  const beforeEnd = new Date(anniversary);
  beforeEnd.setDate(beforeEnd.getDate() - 1);
  return {
    before: { startDate: toDateKey(start), endDate: toDateKey(beforeEnd) },
    after: { startDate: toDateKey(anniversary), endDate: toDateKey(end) },
  };
}

const DEDUCT_MULTIPLIER = { X0: 0, X1: 1, X2: 2, X3: 3 };

// The actual money figure is NOT frozen like billableDays/x1/ป — it's a
// straightforward multiplication of the frozen x1 day-count by whichever
// tier (X0/X1/X2/X3) is currently selected, times the employee's CURRENT
// daily rate (monthly salary ÷ 30). Recomputed fresh on every read so it
// always reflects the tier actually chosen right now and the employee's
// current pay — there's nothing here that should silently drift with the
// passage of time the way tenure status does, so there's no freezing
// concern to begin with. X0 is always exactly 0, salary or not.
function attachDeductionAmount(leaveDoc) {
  const leave = typeof leaveDoc.toObject === 'function' ? leaveDoc.toObject() : leaveDoc;
  const employee = leave.employee;
  const multiplier = DEDUCT_MULTIPLIER[leave.deductAmount];
  const salary = employee && typeof employee === 'object' ? employee.salary : null;
  if (multiplier === 0) {
    leave.deductAmountTotal = 0;
  } else if (multiplier != null && salary != null && leave.deductDaysX1 != null) {
    leave.deductAmountTotal = Math.round((salary / 30) * leave.deductDaysX1 * multiplier);
  } else {
    leave.deductAmountTotal = null;
  }
  return leave;
}

function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', ...filters } = req.query;
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    query[key] = value;
  }
  if (req.user.role === 'employee') {
    query.employee = req.user.employeeId ? req.user.employeeId._id : null;
  }
  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

function validateLeavePayload(payload) {
  if (!payload.employee || !payload.startDate || !payload.endDate) {
    const err = new Error('employee, startDate, and endDate are required');
    err.status = 400;
    throw err;
  }

  if (new Date(payload.endDate) < new Date(payload.startDate)) {
    const err = new Error('End date cannot be before start date');
    err.status = 400;
    throw err;
  }
}

async function ensureNoOverlappingLeave(payload, excludeIds) {
  const query = {
    employee: payload.employee,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: new Date(payload.endDate) },
    endDate: { $gte: new Date(payload.startDate) },
  };
  // A split pair's own two halves are contiguous (no gap) and belong to the
  // same logical request, so both of their ids must be excluded together —
  // not just the one currently being edited — or a request would spuriously
  // conflict with its own other half.
  const ids = excludeIds == null ? [] : Array.isArray(excludeIds) ? excludeIds : [excludeIds];
  if (ids.length) query._id = { $nin: ids };

  const existing = await Leave.findOne(query);
  if (!existing) return;

  const err = new Error('Employee already has a pending or approved leave in this date range');
  err.status = 409;
  throw err;
}

async function markApprovedLeaveDays(leave) {
  for (let d = new Date(leave.startDate); d <= leave.endDate; d.setDate(d.getDate() + 1)) {
    // eslint-disable-next-line no-await-in-loop
    await markLeave(leave.employee, toDateKey(d));
  }
}

// Undoes markApprovedLeaveDays for one date — re-derives the day from real scan
// logs if there are any (rare: the employee actually scanned despite being on
// leave that day), otherwise the "leave" marking was the only thing there, so
// it's deleted outright rather than left behind as a stale AttendanceDaily row.
async function revertLeaveMarking(employeeId, dateKey) {
  const recomputed = await recomputeDay(employeeId, dateKey);
  if (!recomputed) {
    await AttendanceDaily.deleteOne({ employee: employeeId, date: dateKey, status: 'leave' });
  }
}

async function revertApprovedLeaveDays(leave) {
  for (let d = new Date(leave.startDate); d <= leave.endDate; d.setDate(d.getDate() + 1)) {
    // eslint-disable-next-line no-await-in-loop
    await revertLeaveMarking(leave.employee, toDateKey(d));
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      Leave.find(query)
        .populate({ path: 'employee', populate: 'department position' })
        .populate('approver')
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Leave.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items.map(attachDeductionAmount));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id).populate({ path: 'employee', populate: 'department position' }).populate('approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(attachDeductionAmount(item));
  } catch (err) {
    next(err);
  }
});

// By the time a leave is entered here it's already been agreed in real life
// (a verbal/paper sign-off happened first, same reasoning as OT) — so it's
// created pre-approved instead of sitting in a "pending" state waiting for a
// redundant second approval. `approver` is whoever's logged in when it's an
// admin/manager filing it; a plain employee self-filing their own leave has
// no one to attribute the approval to, so it's left unset.
router.post('/', authenticate, async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.user.role === 'employee') {
      if (!req.user.employeeId) return res.status(400).json({ message: 'No employee profile linked to this account' });
      payload.employee = req.user.employeeId._id;
    }
    payload.status = 'approved';
    payload.approver = ['admin', 'manager'].includes(req.user.role) && req.user.employeeId ? req.user.employeeId._id : undefined;
    payload.decidedAt = new Date();
    validateLeavePayload(payload);
    await ensureNoOverlappingLeave(payload);

    const employee = await Employee.findById(payload.employee);
    const split = splitIfStraddling(employee, payload.startDate, payload.endDate);

    if (split) {
      const groupId = new mongoose.Types.ObjectId();
      const beforePayload = { ...payload, ...split.before, splitGroupId: groupId, splitPart: 'before' };
      const afterPayload = { ...payload, ...split.after, splitGroupId: groupId, splitPart: 'after' };
      Object.assign(beforePayload, await computeDeductionFields(employee, beforePayload.startDate, beforePayload.endDate, false, beforePayload.deductAmount));
      Object.assign(afterPayload, await computeDeductionFields(employee, afterPayload.startDate, afterPayload.endDate, true, afterPayload.deductAmount));

      const [beforeItem, afterItem] = await Leave.create([beforePayload, afterPayload]);
      await markApprovedLeaveDays(beforeItem);
      await markApprovedLeaveDays(afterItem);
      const populated = await beforeItem.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
      return res.status(201).json(attachDeductionAmount(populated));
    }

    Object.assign(payload, await computeDeductionFields(employee, payload.startDate, payload.endDate, undefined, payload.deductAmount));

    const item = await Leave.create(payload);
    await markApprovedLeaveDays(item);
    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.status(201).json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

// Handles a date-changing edit on `item`, covering every combination of
// split-pair membership before/after the edit:
//  - a plain leave edited to now straddle the anniversary gets split into a
//    new linked pair (`item` becomes the 'before' half, a new sibling
//    document is created for the 'after' half);
//  - a split half whose newly-submitted range still straddles gets
//    re-split fresh (the old sibling is dropped and recreated — nothing
//    else references a Leave by id, so there's no identity to preserve);
//  - a split half whose newly-submitted range no longer straddles collapses
//    back into one plain leave (the sibling is deleted).
// The submitted startDate/endDate on `item` are treated as the new COMBINED
// range for the whole pair, not just item's own half — the edit form warns
// the admin of this when editing a split half.
async function applyDateChange(item, sibling, nextPayload, employee) {
  if (sibling) {
    if (sibling.status === 'approved') await revertApprovedLeaveDays(sibling);
    await Leave.deleteOne({ _id: sibling._id });
    nextPayload.splitGroupId = null;
    nextPayload.splitPart = null;
  }

  const split = splitIfStraddling(employee, nextPayload.startDate, nextPayload.endDate);
  if (!split) {
    Object.assign(nextPayload, await computeDeductionFields(employee, nextPayload.startDate, nextPayload.endDate, undefined, nextPayload.deductAmount));
    return;
  }

  const groupId = new mongoose.Types.ObjectId();
  nextPayload.splitGroupId = groupId;
  nextPayload.splitPart = 'before';
  Object.assign(
    nextPayload,
    split.before,
    await computeDeductionFields(employee, split.before.startDate, split.before.endDate, false, nextPayload.deductAmount)
  );

  const afterPayload = {
    employee: item.employee,
    type: nextPayload.type,
    reason: nextPayload.reason,
    status: item.status,
    approver: item.approver,
    decidedAt: item.decidedAt,
    splitGroupId: groupId,
    splitPart: 'after',
    ...split.after,
  };
  Object.assign(afterPayload, await computeDeductionFields(employee, split.after.startDate, split.after.endDate, true, nextPayload.deductAmount));
  const afterItem = await Leave.create(afterPayload);
  if (afterItem.status === 'approved') await markApprovedLeaveDays(afterItem);
}

router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });

    const isOwner = req.user.employeeId && item.employee.toString() === req.user.employeeId._id.toString();
    const isApprover = ['admin', 'manager'].includes(req.user.role);
    if (!isOwner && !isApprover) return res.status(403).json({ message: 'Forbidden' });
    if (isOwner && item.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be edited' });
    }

    const sibling = item.splitGroupId ? await Leave.findOne({ splitGroupId: item.splitGroupId, _id: { $ne: item._id } }) : null;

    const wasApproved = item.status === 'approved';
    const oldStartDate = item.startDate;
    const oldEndDate = item.endDate;

    const { type, startDate, endDate, reason } = req.body;
    // deductAmount/deductNote are still hand-entered, so "present in the
    // body" (even as an explicit null) means "use this," not "??" — which
    // would wrongly keep the old value instead of letting the field clear
    // back to unset.
    const deductFields = {};
    for (const field of ['deductAmount', 'deductNote']) {
      deductFields[field] = field in req.body ? req.body[field] : item[field];
    }
    const nextPayload = {
      employee: item.employee,
      type: type ?? item.type,
      startDate: startDate ?? item.startDate,
      endDate: endDate ?? item.endDate,
      reason,
      ...deductFields,
    };
    validateLeavePayload(nextPayload);
    await ensureNoOverlappingLeave(nextPayload, sibling ? [item._id, sibling._id] : item._id);

    const datesChanged = toDateKey(nextPayload.startDate) !== toDateKey(oldStartDate) || toDateKey(nextPayload.endDate) !== toDateKey(oldEndDate);
    if (datesChanged) {
      // Dates actually moved, so the day-count-dependent fields need
      // recomputing — using tenure status as of THIS edit (freezing again
      // from this point forward), not whatever it was at original creation.
      const employee = await Employee.findById(item.employee);
      await applyDateChange(item, sibling, nextPayload, employee);
    } else if (sibling && (sibling.reason !== nextPayload.reason || sibling.type !== nextPayload.type)) {
      // No date change, but a split pair's reason/type stay mirrored — it's
      // one real-life request split only for calculation purposes.
      sibling.reason = nextPayload.reason;
      sibling.type = nextPayload.type;
      await sibling.save();
    }

    Object.assign(item, nextPayload);
    await item.save();

    // An already-approved leave had its dates marked into AttendanceDaily —
    // if the dates just changed, that marking is now on the wrong days and
    // needs moving, the same way /approve marks them the first time.
    if (wasApproved && datesChanged) {
      await revertApprovedLeaveDays({ employee: item.employee, startDate: oldStartDate, endDate: oldEndDate });
      await markApprovedLeaveDays(item);
    }

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' });

    item.status = 'approved';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();
    await markApprovedLeaveDays(item);

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be rejected' });

    item.status = 'rejected';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    // Deleting an approved leave shouldn't leave its days stuck showing "leave".
    if (item.status === 'approved') await revertApprovedLeaveDays(item);
    // A split pair is one logical request — deleting one half without the
    // other would leave a dangling, incomplete record behind.
    if (item.splitGroupId) {
      const sibling = await Leave.findOneAndDelete({ splitGroupId: item.splitGroupId, _id: { $ne: item._id } });
      if (sibling && sibling.status === 'approved') await revertApprovedLeaveDays(sibling);
    }
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
