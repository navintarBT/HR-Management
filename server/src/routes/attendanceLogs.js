const express = require('express');
const mongoose = require('mongoose');
const crudRouter = require('./crudFactory');
const AttendanceLog = require('../models/AttendanceLog');
const Device = require('../models/Device');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveShiftWindow } = require('../utils/attendanceProcessor');

const router = express.Router();

// How far either side of a day's scan window punches are listed too — the
// night before / the morning after, so HR sees a punch that landed on the
// neighbouring day instead of wondering where it went.
const AROUND_MS = 6 * 3600 * 1000;

// One person's punches around one shift-day, for ສະຫຼຸບເງິນເດືອນ's day detail:
// which fall inside that day's scan window (the ones it's worked out from),
// which came from a terminal and which HR typed (MANUAL), and the terminal's
// own punches HR's fix replaced (voided) — the plain list below hides those.
// Registered before the generic routes so /day isn't read as an id.
router.get('/day', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, date } = req.query;
    if (!mongoose.isValidObjectId(employee) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'ຕ້ອງມີ employee ແລະ date (YYYY-MM-DD)' });
    }
    const { windowStart, windowEnd } = await resolveShiftWindow(employee, date);
    const logs = await AttendanceLog.find({
      employee,
      timestamp: { $gte: new Date(windowStart.getTime() - AROUND_MS), $lte: new Date(windowEnd.getTime() + AROUND_MS) },
    })
      .sort({ timestamp: 1 })
      .lean();
    const serials = [...new Set(logs.map((l) => l.deviceId).filter((d) => d && d !== 'MANUAL' && d !== 'SIMULATOR'))];
    const devices = serials.length ? await Device.find({ serialNumber: { $in: serials } }, 'serialNumber info.deviceName').lean() : [];
    const names = new Map(devices.map((d) => [d.serialNumber, d.info?.deviceName || null]));
    res.json({
      windowStart,
      windowEnd,
      scans: logs.map((l) => ({
        _id: l._id,
        timestamp: l.timestamp,
        deviceId: l.deviceId ?? null,
        deviceName: names.get(l.deviceId) ?? null,
        manual: l.deviceId === 'MANUAL',
        voided: !!l.voided,
        note: l.raw?.note ?? null,
        editedBy: l.raw?.editedBy ?? null,
        inWindow: l.timestamp >= windowStart && l.timestamp <= windowEnd,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Read-only from the UI side; writes happen only through /api/attendance/push.
router.use(
  crudRouter(AttendanceLog, {
    populate: 'employee',
    writeRoles: ['admin'],
    readRoles: ['admin', 'manager', 'employee'],
    scopeQuery: (req, query) => {
      // A punch HR replaced (AttendanceLog.voided) isn't part of the day any more.
      query.voided = { $ne: true };
      if (req.user.role === 'employee') {
        query.employee = req.user.employeeId ? req.user.employeeId._id : null;
      }
    },
  })
);

module.exports = router;
