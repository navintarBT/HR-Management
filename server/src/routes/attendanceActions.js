const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const { authenticate, requireRole } = require('../middleware/auth');
const { followsIrregularRule } = require('../utils/substituteRule');
const {
  recomputeDay,
  reprocessFromLogs,
  dayRange,
  resolveShiftDateKey,
  resolveExpectedShift,
  resolveShiftWindow,
  isOvernightShift,
  markSubstituted,
  markAbsent,
  bulkMarkPresentForOutage,
} = require('../utils/attendanceProcessor');

const router = express.Router();

// Decide in/out by alternating against the last log recorded so far on this
// same shift-day — resolved the same way recomputeDay groups scans, so an
// overnight shift's 2am scan-out still alternates against its 10pm scan-in
// from the calendar day before, instead of looking like a lone "in".
async function inferType(employeeId, timestamp) {
  const shiftDateKey = await resolveShiftDateKey(employeeId, timestamp);
  const { start } = dayRange(shiftDateKey);
  const last = await AttendanceLog.findOne({
    employee: employeeId,
    timestamp: { $gte: start, $lt: timestamp },
  }).sort('-timestamp');
  return last && last.type === 'in' ? 'out' : 'in';
}

// Real-world ingestion endpoint for biometric/RFID terminals (or the simulator button).
// Real ZKTeco devices speak the ADMS protocol instead (see routes/adms.js) — this
// endpoint is a convenience bridge for any terminal middleware that can be
// configured to POST plain JSON instead. It can't carry a user JWT (it's not a
// person logging in), so it's gated by a separate shared secret instead —
// fails closed (401 on every request) if DEVICE_PUSH_SECRET is never set,
// since nothing in this app currently calls this route itself.
router.post('/push', (req, res, next) => {
  const expected = process.env.DEVICE_PUSH_SECRET;
  if (!expected || req.get('X-Device-Secret') !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}, async (req, res, next) => {
  try {
    const { deviceId, userId, timestamp } = req.body;
    if (!userId || !timestamp) {
      return res.status(400).json({ message: 'userId and timestamp are required' });
    }

    const employee = await Employee.findOne({ deviceUserId: String(userId) });
    const ts = new Date(timestamp);
    const type = employee ? await inferType(employee._id, ts) : 'auto';

    const log = await AttendanceLog.create({
      employee: employee ? employee._id : undefined,
      deviceUserId: String(userId),
      deviceId: deviceId || 'SIMULATOR',
      timestamp: ts,
      type,
      raw: req.body,
    });

    if (employee) {
      await recomputeDay(employee._id, await resolveShiftDateKey(employee._id, ts));
    }

    res.status(201).json({ ok: true, matched: Boolean(employee), log });
  } catch (err) {
    next(err);
  }
});

// Used by the "Simulate Scan" button in the UI — same effect as /push but addressed
// directly by employee id. It writes a real scan for anyone at any time, so
// admin/manager only (any logged-in account, 'employee' included, could use it).
router.post('/simulate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, timestamp } = req.body;
    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const ts = timestamp ? new Date(timestamp) : new Date();
    const type = await inferType(employee._id, ts);

    const log = await AttendanceLog.create({
      employee: employee._id,
      deviceUserId: employee.deviceUserId,
      deviceId: 'SIMULATOR',
      timestamp: ts,
      type,
      raw: { simulated: true },
    });

    const daily = await recomputeDay(employee._id, await resolveShiftDateKey(employee._id, ts));
    res.status(201).json({ ok: true, log, daily });
  } catch (err) {
    next(err);
  }
});

// Lets HR correct a day whose scan failed (or recorded a wrong time), for any
// employee/day — not just ones already flagged incomplete/absent, since a scan
// can also succeed but log the wrong time. Replaces that day's raw logs outright
// with what HR has verified actually happened, then re-derives the daily record
// through the same recomputeDay used by real scans — so lateness is judged
// against the same shift source (that day's queued Shift, else the employee's
// own default) a real scan would be, not a separate hand-rolled calculation.
router.post('/manual-fix', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, date, checkIn, checkOut, note } = req.body;
    if (!employeeId || !date || !checkIn) {
      return res.status(400).json({ message: 'ກະລຸນາປ້ອນ ພະນັກງານ, ວັນທີ່ ແລະ ເວລາເຂົ້າ' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const checkInTs = new Date(`${date}T${checkIn}:00`);
    let checkOutTs = checkOut ? new Date(`${date}T${checkOut}:00`) : null;
    if (Number.isNaN(checkInTs.getTime()) || (checkOutTs && Number.isNaN(checkOutTs.getTime()))) {
      return res.status(400).json({ message: 'ຮູບແບບເວລາບໍ່ຖືກຕ້ອງ' });
    }
    // `date` is the shift-DAY, not necessarily the calendar day checkOut falls
    // on — for someone on an overnight shift (e.g. 22:00-06:00), a checkOut
    // typed as "06:00" is naively parsed onto the SAME date as checkIn here,
    // landing before it. Roll it onto the next calendar day instead of
    // rejecting it, but only when this employee's shift actually is overnight
    // that day — otherwise a genuinely backwards time (same-day shift) still
    // gets caught below.
    if (checkOutTs && checkOutTs <= checkInTs) {
      const expected = await resolveExpectedShift(employeeId, date);
      if (isOvernightShift(expected)) {
        checkOutTs = new Date(checkOutTs.getTime() + 24 * 3600000);
      }
    }
    if (checkOutTs && checkOutTs <= checkInTs) {
      return res.status(400).json({ message: 'ເວລາອອກຕ້ອງຢູ່ຫຼັງເວລາເຂົ້າ' });
    }

    // Must clear the SAME window recomputeDay will read back from below — for
    // an overnight shift that window extends past plain calendar-day midnight
    // (see resolveShiftWindow). Deleting only this literal calendar day would
    // leave an old scan-out from the small hours of the NEXT day behind: it
    // survives the cleanup, recomputeDay still finds it, and the edit looks
    // like it silently did nothing (e.g. clearing checkOut to downgrade to a
    // single scan never actually takes, because the stale checkout persists).
    const { windowStart, windowEnd } = await resolveShiftWindow(employeeId, date);
    await AttendanceLog.deleteMany({ employee: employeeId, timestamp: { $gte: windowStart, $lte: windowEnd } });

    const raw = { manual: true, note: note || undefined, editedBy: req.user?.email };
    await AttendanceLog.create({
      employee: employeeId,
      deviceUserId: employee.deviceUserId,
      deviceId: 'MANUAL',
      timestamp: checkInTs,
      type: 'in',
      raw,
    });
    if (checkOutTs) {
      await AttendanceLog.create({
        employee: employeeId,
        deviceUserId: employee.deviceUserId,
        deviceId: 'MANUAL',
        timestamp: checkOutTs,
        type: 'out',
        raw,
      });
    }

    // force: HR is replacing this day on purpose, even a ຂາດ/ມາແທນ set by hand.
    const daily = await recomputeDay(employeeId, date, { force: true });
    res.json({ ok: true, daily });
  } catch (err) {
    next(err);
  }
});

// For positions where someone else routinely covers the shift instead of the
// assigned person (Position.allowsSubstituteStatus, e.g. DJ) — marks the day
// as covered rather than a scan that failed, so it isn't judged an absence.
// Gated server-side by the position flag, not just hidden in the UI. Also
// clears any queued Shift for that day in the same action — otherwise HR
// would have to separately remember to go delete it on ຕາຕະລາງວັນພັກ, and a
// leftover queue would keep showing this employee as still scheduled there.
router.post('/mark-substituted', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    if (!employeeId || !date) {
      return res.status(400).json({ message: 'ກະລຸນາລະບຸ ພະນັກງານ ແລະ ວັນທີ່' });
    }

    const employee = await Employee.findById(employeeId).populate('position');
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    // An explicit override on the employee wins over the position's setting
    // either way — allows one person to opt in even outside a flagged
    // position, or opt out despite being in one; someone with no regular
    // shift has it on too (utils/substituteRule.js).
    if (!followsIrregularRule(employee)) {
      return res.status(403).json({ message: 'ພະນັກງານ/ຕຳແໜ່ງນີ້ບໍ່ອະນຸຍາດໃຫ້ໃຊ້ສະຖານະ "ມາແທນ"' });
    }

    // Same overnight-aware window as manual-fix's cleanup — a plain calendar
    // day would leave a genuine scan-out from the small hours of the next day
    // behind, which a later reprocess could still pick up and attribute here.
    const { windowStart, windowEnd } = await resolveShiftWindow(employeeId, date);
    await AttendanceLog.deleteMany({ employee: employeeId, timestamp: { $gte: windowStart, $lte: windowEnd } });
    await Shift.deleteMany({ employee: employeeId, date });

    const daily = await markSubstituted(employeeId, date);
    res.json({ ok: true, daily });
  } catch (err) {
    next(err);
  }
});

// Reverts a day marked "ມາແທນ" back to blank. Unlike manual-fix, there's no
// raw scan to recompute from here, so this just removes the record rather
// than deriving a new one — same status guard as the query above, so this
// can never touch a day that was never marked substituted in the first place.
router.post('/cancel-substituted', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    if (!employeeId || !date) {
      return res.status(400).json({ message: 'ກະລຸນາລະບຸ ພະນັກງານ ແລະ ວັນທີ່' });
    }
    await AttendanceDaily.deleteOne({ employee: employeeId, date, status: 'substituted' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Deliberately forces status='absent' on a day as a disciplinary action — e.g.
// the employee did come in and scan, but broke a rule serious enough that
// management wants it to count (and cost) the same as a no-show. A reason is
// required so it reads back as "why" later, and this clears that day's raw
// scan logs the same way mark-substituted does: otherwise a later /reprocess
// would re-derive from the real logs and silently undo the override.
router.post('/mark-absent', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, date, note } = req.body;
    if (!employeeId || !date || !note) {
      return res.status(400).json({ message: 'ກະລຸນາລະບຸ ພະນັກງານ, ວັນທີ່ ແລະ ເຫດຜົນ' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const { windowStart, windowEnd } = await resolveShiftWindow(employeeId, date);
    await AttendanceLog.deleteMany({ employee: employeeId, timestamp: { $gte: windowStart, $lte: windowEnd } });

    const daily = await markAbsent(employeeId, date);
    daily.disciplinaryNote = note;
    await daily.save();
    res.json({ ok: true, daily });
  } catch (err) {
    next(err);
  }
});

// Reverts a disciplinary absence back to blank — guarded to only ever touch a
// day this same action created (disciplinaryNote set), never a genuine
// no-show the automatic sweep found on its own. Like cancel-substituted,
// there's no raw scan left to recompute from (mark-absent deleted it), so
// this removes the record rather than deriving a new one; the day goes back
// to blank, not to whatever the original scan actually was.
router.post('/cancel-absent-override', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    if (!employeeId || !date) {
      return res.status(400).json({ message: 'ກະລຸນາລະບຸ ພະນັກງານ ແລະ ວັນທີ່' });
    }
    await AttendanceDaily.deleteOne({ employee: employeeId, date, disciplinaryNote: { $ne: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Bulk backfill for a date range when the scanning system itself was down
// (power outage, server down for days, ...) — fills everyone in as if they
// worked their normal shift, so the automatic absence sweep doesn't later
// penalize the whole company for an infrastructure failure. Admin-only (not
// manager) given the blast radius, and capped at a month per call so a
// mis-picked range can't silently rewrite a year of records.
const BULK_PRESENT_MAX_DAYS = 31;
router.post('/bulk-mark-present', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate, note } = req.body;
    if (!startDate || !endDate || !note) {
      return res.status(400).json({ message: 'ກະລຸນາລະບຸ ຊ່ວງວັນທີ່ ແລະ ເຫດຜົນ' });
    }
    // A malformed date turns into the key 'NaN-NaN-NaN', which still sorts
    // before most end dates — the day-by-day loop would never finish.
    const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
    if (!isDateKey(startDate) || !isDateKey(endDate)) {
      return res.status(400).json({ message: 'ວັນທີ່ຕ້ອງເປັນ YYYY-MM-DD' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ message: 'ວັນທີ່ສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນທີ່ເລີ່ມ' });
    }
    const dayCount = Math.round((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000) + 1;
    if (dayCount > BULK_PRESENT_MAX_DAYS) {
      return res.status(400).json({ message: `ເລືອກໄດ້ສູງສຸດ ${BULK_PRESENT_MAX_DAYS} ວັນຕໍ່ຄັ້ງ` });
    }
    const { filled, skipped } = await bulkMarkPresentForOutage(startDate, endDate, note);
    res.json({ ok: true, filledCount: filled.length, skippedCount: skipped.length });
  } catch (err) {
    next(err);
  }
});

router.post('/reprocess', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    const results = await reprocessFromLogs({ employeeId, dateKey: date });
    res.json({ ok: true, count: results.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
