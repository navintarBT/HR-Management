const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const { authenticate, requireRole } = require('../middleware/auth');
const { recomputeDay, reprocessFromLogs, toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

// Decide in/out by alternating against the last log recorded today for this employee.
async function inferType(employeeId, timestamp) {
  const dateKey = toDateKey(timestamp);
  const start = new Date(`${dateKey}T00:00:00`);
  const last = await AttendanceLog.findOne({
    employee: employeeId,
    timestamp: { $gte: start, $lt: timestamp },
  }).sort('-timestamp');
  return last && last.type === 'in' ? 'out' : 'in';
}

// Real-world ingestion endpoint for biometric/RFID terminals (or the simulator button).
// TODO: real ZKTeco devices speak the ADMS protocol (see routes/admsStub.js), not this
// JSON shape. This endpoint is a convenience bridge for the in-app simulator and any
// terminal middleware that can be configured to POST plain JSON instead.
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
      await recomputeDay(employee._id, toDateKey(ts));
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

    const daily = await recomputeDay(employee._id, toDateKey(ts));
    res.status(201).json({ ok: true, log, daily });
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
