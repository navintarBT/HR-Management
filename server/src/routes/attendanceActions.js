const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const { authenticate, requireRole } = require('../middleware/auth');
const { recomputeDay, reprocessFromLogs, dayRange, resolveShiftDateKey, markSubstituted } = require('../utils/attendanceProcessor');

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
// endpoint is a convenience bridge for the in-app simulator and any terminal
// middleware that can be configured to POST plain JSON instead.
router.post('/push', async (req, res, next) => {
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
// directly by employee id and requires a logged-in user.
router.post('/simulate', authenticate, async (req, res, next) => {
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
    const checkOutTs = checkOut ? new Date(`${date}T${checkOut}:00`) : null;
    if (Number.isNaN(checkInTs.getTime()) || (checkOutTs && Number.isNaN(checkOutTs.getTime()))) {
      return res.status(400).json({ message: 'ຮູບແບບເວລາບໍ່ຖືກຕ້ອງ' });
    }
    if (checkOutTs && checkOutTs <= checkInTs) {
      return res.status(400).json({ message: 'ເວລາອອກຕ້ອງຢູ່ຫຼັງເວລາເຂົ້າ' });
    }

    const { start, end } = dayRange(date);
    await AttendanceLog.deleteMany({ employee: employeeId, timestamp: { $gte: start, $lte: end } });

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

    const daily = await recomputeDay(employeeId, date);
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
    // position, or opt out despite being in one.
    const allowed = employee.allowsSubstituteStatus ?? employee.position?.allowsSubstituteStatus;
    if (!allowed) {
      return res.status(403).json({ message: 'ພະນັກງານ/ຕຳແໜ່ງນີ້ບໍ່ອະນຸຍາດໃຫ້ໃຊ້ສະຖານະ "ມາແທນ"' });
    }

    const { start, end } = dayRange(date);
    await AttendanceLog.deleteMany({ employee: employeeId, timestamp: { $gte: start, $lte: end } });
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
