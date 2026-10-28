const express = require('express');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveRestDayForEmployee, nearestDateForWeekday } = require('../utils/restDayRules');
const { followsIrregularRule } = require('../utils/substituteRule');

const router = express.Router();

// employee/coveringFor both reference a full Employee document (salary, phone,
// email included) — scoped to display fields so a shift's own API response
// (readable by any authenticated 'employee', not just admin/manager) never
// exposes a covered-for colleague's pay or contact details.
const SAFE_PERSON_FIELDS = 'firstName lastName employeeCode photoUrl department position';
const SHIFT_POPULATE = [
  { path: 'employee', select: SAFE_PERSON_FIELDS, populate: 'department position' },
  { path: 'coveringFor', select: SAFE_PERSON_FIELDS, populate: 'department position' },
  'position',
  'category',
  'holiday',
];

function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// One person's date is either a rest day or a work day, never both — a second
// row of the other kind (e.g. a cover added on top of their own ພັກ) left every
// page and the absence sweep to pick one of the two their own way. ຕາຕະລາງວັນພັກ
// already makes you ຄືນຄ່າປົກກະຕິ first; this holds the same rule for every
// other way in (ການເຮັດແທນ, ຕາຕະລາງກະ, the API). A company holiday is exempt —
// it overwrites one existing row by design (utils/holidayShifts.ts).
const WORK_ON_REST_CONFLICT = 'ມື້ນີ້ຕັ້ງເປັນວັນພັກ ຫຼື ສະຫຼັບກະໄວ້ແລ້ວ — ກະລຸນາຄືນຄ່າປົກກະຕິມື້ນີ້ກ່ອນ';
const REST_ON_WORK_CONFLICT = 'ມື້ນີ້ມີຕາຕະລາງຕັ້ງໄວ້ແລ້ວ — ກະລຸນາແກ້ໄຂ ຫຼື ຄືນຄ່າປົກກະຕິມື້ນີ້ກ່ອນ';
async function hasKindConflict(employee, date, status, excludeId) {
  const kinds = status === 'rest' ? ['scheduled', 'swapped', 'rest'] : ['rest', 'swapped'];
  const query = { employee, date, status: { $in: kinds } };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Shift.exists(query));
}

// One cover a day for ordinary staff (asked for 2026-10-28): with two working
// rows on one day, attendance judges lateness and absence against only one of
// them. Checked when a cover is added or moved onto another person/day, so it
// blocks a cover for someone who already has one — or any other working row —
// that day. People under the ມາບໍ່ປົກກະຕິ rule (the DJs, anyone with no
// regular shift — utils/substituteRule.js) can still take several.
const SECOND_WORK_CONFLICT = 'ຄົນນີ້ມີວຽກໃນມື້ນີ້ແລ້ວ (ໄປແທນຄົນອື່ນ ຫຼື ມີກະທີ່ຕັ້ງໄວ້) — ມອບວຽກແທນໄດ້ມື້ລະ 1 ວຽກ';
async function hasSecondWorkConflict(employeeId, date, excludeId) {
  const employee = await Employee.findById(employeeId, 'position allowsSubstituteStatus defaultShiftCategory defaultShiftStart defaultShiftEnd').populate(
    'position',
    'allowsSubstituteStatus'
  );
  if (!employee || followsIrregularRule(employee)) return false;
  const query = { employee: employeeId, date, status: 'scheduled' };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Shift.exists(query));
}

const OVERLAP_CONFLICT = 'ພະນັກງານຄົນນີ້ມີກະທີ່ເວລາຊ້ອນກັນໃນມື້ນີ້ແລ້ວ';

// A company-wide holiday closure (see holidays.js's applyRestDayToAll, which
// always tags the rows it creates with `holiday`) rests EVERYONE regardless
// of position — it isn't someone choosing their own day off, so it's exempt
// from a position's restricted-rest-days rule.
// Returns the date this one-off rest day should actually be saved under:
// unchanged unless the employee's position forbids that weekday and has a
// fallback configured, in which case it comes back shifted to the nearest
// date on the fallback weekday instead of being rejected.
async function ensurePersonalRestDayAllowed(employeeId, date, holidayId) {
  if (holidayId) return date;
  // Already on approved leave that day — this isn't a discretionary swap
  // away from a day the position needs staffed, since they're not coming in
  // either way, so the restriction doesn't apply.
  const onLeave = await Leave.exists({
    employee: employeeId,
    status: 'approved',
    startDate: { $lte: new Date(`${date}T23:59:59.999`) },
    endDate: { $gte: new Date(`${date}T00:00:00.000`) },
  });
  if (onLeave) return date;
  // Selected fields include this employee's own restrictedRestDays/
  // restDayFallback override, not just position — resolveRestDayForEmployee
  // checks those first (see utils/restDayRules.js's mergeRestDayRule).
  const employee = await Employee.findById(employeeId, 'position restrictedRestDays restDayFallback');
  if (!employee) return date;
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const resolvedDow = await resolveRestDayForEmployee(employee, employee.position, dayOfWeek);
  return resolvedDow === dayOfWeek ? date : nearestDateForWeekday(date, resolvedDow);
}

// Shared by the single PATCH and the bulk PATCH below: applies `changes` to
// one shift after checking it won't overlap another scheduled shift for the
// same employee/day. Throws { status, message } on conflict/not-found so both
// callers can turn that into the right HTTP response.
async function applyShiftUpdate(id, changes) {
  const current = await Shift.findById(id);
  if (!current) throw { status: 404, message: 'Not found' };

  const employee = changes.employee ?? current.employee;
  const date = changes.date ?? current.date;
  const startTime = changes.startTime ?? current.startTime;
  const endTime = changes.endTime ?? current.endTime;
  const status = changes.status ?? current.status;

  let effectiveChanges = changes;
  const holidayId = changes.holiday ?? current.holiday;
  if (status !== 'rest') {
    if (!holidayId && (await hasKindConflict(employee, date, status, current._id))) {
      throw { status: 409, message: WORK_ON_REST_CONFLICT };
    }
    // Only when this edit makes it a cover on a new person/day — editing the
    // time of a cover already in place never trips it.
    const coveringFor = changes.coveringFor !== undefined ? changes.coveringFor : current.coveringFor;
    const newCoverDay =
      String(employee) !== String(current.employee) ||
      date !== current.date ||
      current.status !== 'scheduled' ||
      String(coveringFor ?? '') !== String(current.coveringFor ?? '');
    if (status === 'scheduled' && coveringFor && newCoverDay && (await hasSecondWorkConflict(employee, date, current._id))) {
      throw { status: 409, message: SECOND_WORK_CONFLICT };
    }
    const existing = await Shift.find({ employee, date, status: 'scheduled', _id: { $ne: current._id } });
    const conflict = existing.some((s) => timesOverlap(startTime, endTime, s.startTime, s.endTime));
    if (conflict) throw { status: 409, message: OVERLAP_CONFLICT };
  } else {
    const effectiveDate = await ensurePersonalRestDayAllowed(employee, date, holidayId);
    if (!holidayId && (await hasKindConflict(employee, effectiveDate, 'rest', current._id))) {
      throw { status: 409, message: REST_ON_WORK_CONFLICT };
    }
    if (effectiveDate !== date) effectiveChanges = { ...changes, date: effectiveDate };
  }

  Object.assign(current, effectiveChanges);
  await current.save();
  return current;
}

function buildQuery(query) {
  const { _start = 0, _end = 10, _sort = 'date', _order = 'asc', ...filters } = query;
  const mongoQuery = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (key.endsWith('_gte') || key.endsWith('_lte')) {
      const field = key.replace(/_(gte|lte)$/, '');
      const op = key.endsWith('_gte') ? '$gte' : '$lte';
      mongoQuery[field] = { ...mongoQuery[field], [op]: value };
    } else {
      mongoQuery[key] = value;
    }
  }
  return { mongoQuery, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { mongoQuery, _start, _end, _sort, _order } = buildQuery(req.query);
    if (req.user.role === 'employee') {
      mongoQuery.employee = req.user.employeeId ? req.user.employeeId._id : null;
    }
    const [items, total] = await Promise.all([
      Shift.find(mongoQuery)
        .populate(SHIFT_POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Shift.countDocuments(mongoQuery),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role === 'employee') {
      query.employee = req.user.employeeId ? req.user.employeeId._id : null;
    }
    const item = await Shift.findOne(query).populate(SHIFT_POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, date, startTime, endTime, status, holiday, coveringFor } = req.body;
    if (coveringFor && String(coveringFor) === String(employee)) {
      return res.status(400).json({ message: 'ພະນັກງານທີ່ເຮັດແທນ ແລະ ຜູ້ຖືກແທນຕ້ອງເປັນຄົນລະຄົນກັນ' });
    }
    let effectiveDate = date;
    if (status !== 'rest') {
      if (!holiday && (await hasKindConflict(employee, date, status))) {
        return res.status(409).json({ message: WORK_ON_REST_CONFLICT });
      }
      if (coveringFor && (await hasSecondWorkConflict(employee, date))) {
        return res.status(409).json({ message: SECOND_WORK_CONFLICT });
      }
      const existing = await Shift.find({ employee, date, status: 'scheduled' });
      const conflict = existing.some((s) => timesOverlap(startTime, endTime, s.startTime, s.endTime));
      if (conflict) {
        return res.status(409).json({ message: OVERLAP_CONFLICT });
      }
    } else {
      effectiveDate = await ensurePersonalRestDayAllowed(employee, date, holiday);
      if (!holiday && (await hasKindConflict(employee, effectiveDate, 'rest'))) {
        return res.status(409).json({ message: REST_ON_WORK_CONFLICT });
      }
    }
    const item = await Shift.create({ ...req.body, date: effectiveDate });
    const populated = await item.populate(SHIFT_POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

// Registered ahead of PATCH /:id so "bulk" isn't swallowed by the :id param.
router.patch('/bulk', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const results = [];
    for (const { id, ...changes } of updates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const updated = await applyShiftUpdate(id, changes);
        results.push({ id, success: true, shift: updated });
      } catch (err) {
        results.push({ id, success: false, message: err.message || 'Update failed' });
      }
    }
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const updated = await applyShiftUpdate(req.params.id, req.body);
    const populated = await updated.populate('employee position category holiday');
    res.json(populated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Shift.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
