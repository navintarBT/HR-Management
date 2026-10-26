const express = require('express');
const crudRouter = require('./crudFactory');
const AttendanceDaily = require('../models/AttendanceDaily');
const Employee = require('../models/Employee');
const Position = require('../models/Position');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

// Days someone actually scanned before their recorded start date (a start date
// already reached — a future one is ignored as a data error everywhere). The
// payroll summary otherwise blanks every day before the start date; a real
// scan means the start date is wrong, so those days still count as worked.
router.get('/scanned-before-hire', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!valid(from) || !valid(to)) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const todayKey = toDateKey(new Date());
    const employees = await Employee.find({ hireDate: { $ne: null } }, '_id hireDate').lean();
    const hireById = new Map();
    for (const e of employees) {
      const hire = toDateKey(e.hireDate);
      if (hire > from && hire <= todayKey) hireById.set(String(e._id), hire);
    }
    if (!hireById.size) return res.json([]);
    const rows = await AttendanceDaily.find(
      {
        employee: { $in: [...hireById.keys()] },
        date: { $gte: from, $lte: to },
        $or: [{ firstIn: { $ne: null } }, { lastOut: { $ne: null } }],
      },
      'employee date'
    ).lean();
    res.json(rows.filter((r) => r.date < hireById.get(String(r.employee))).map((r) => ({ employee: r.employee, date: r.date })));
  } catch (err) {
    next(err);
  }
});

// Days staff in a ມາແທນ position (Position.allowsSubstituteStatus — the DJs)
// actually scanned or were marked ມາແທນ. They have no fixed shift, so a day
// with neither can't be judged worked or absent — the payroll summary leaves
// it blank instead of presuming ມ.
router.get('/substitute-position-days', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!valid(from) || !valid(to)) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const positions = await Position.find({ allowsSubstituteStatus: true }, '_id').lean();
    if (!positions.length) return res.json([]);
    const employees = await Employee.find({ position: { $in: positions.map((p) => p._id) } }, '_id').lean();
    const rows = await AttendanceDaily.find(
      {
        employee: { $in: employees.map((e) => e._id) },
        date: { $gte: from, $lte: to },
        $or: [{ firstIn: { $ne: null } }, { lastOut: { $ne: null } }, { status: 'substituted' }],
      },
      'employee date'
    ).lean();
    res.json(rows.map((r) => ({ employee: r.employee, date: r.date })));
  } catch (err) {
    next(err);
  }
});

// Read-only processed report; writes happen via the reprocess job.
router.use(
  '/',
  crudRouter(AttendanceDaily, {
    populate: 'employee',
    writeRoles: ['admin'],
    readRoles: ['admin', 'manager', 'employee'],
    scopeQuery: (req, query) => {
      if (req.user.role === 'employee') {
        query.employee = req.user.employeeId ? req.user.employeeId._id : null;
      }
    },
  })
);

module.exports = router;
