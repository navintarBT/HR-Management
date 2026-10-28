const express = require('express');
const crudRouter = require('./crudFactory');
const AttendanceDaily = require('../models/AttendanceDaily');
const Employee = require('../models/Employee');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');
const { reapplyAbsenceSeverity } = require('../utils/absenceSeverity');
const { followsIrregularRule } = require('../utils/substituteRule');

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

// Every record in a date range, for the day grid (ປະຫວັດການສະແກນ) and the
// per-employee report (ລາຍງານການສະແກນ). The generic list route below caps
// each request at whatever page size the client asks for — 250+ staff × a
// month is already past the 5000 those pages used to ask for, and the
// missing rows (the newest ones) simply vanished from the grid. This returns
// all of them, bounded by the range itself instead of a row count, and only
// the fields those pages read (no populated employee on every row).
const RANGE_MAX_DAYS = 93;
const RANGE_FIELDS =
  'employee date firstIn lastOut workedHours expectedHours lateMinutes graceMinutes severeLateMinutes earlyLeaveMinutes otHours status disciplinaryNote autoFilledReason absenceSeverity absenceSeveritySetAt';

router.get('/range', authenticate, requireRole('admin', 'manager', 'employee'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!valid(from) || !valid(to) || to < from) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
    if (days > RANGE_MAX_DAYS) return res.status(400).json({ message: `ເລືອກໄດ້ສູງສຸດ ${RANGE_MAX_DAYS} ວັນ` });
    const query = { date: { $gte: from, $lte: to } };
    if (req.user.role === 'employee') query.employee = req.user.employeeId ? req.user.employeeId._id : null;
    res.json(await AttendanceDaily.find(query, RANGE_FIELDS).lean());
  } catch (err) {
    next(err);
  }
});

// An absence's ວັນຫ້າມຂາດ / ມື້ທຳມະດາ tier is locked when it's recorded
// (models/AttendanceDaily.js). This is the deliberate way to change locked
// ones: lists the absences in [from, to] — of `employees`, or of everyone now
// in `positions`, or of everyone — whose tier differs under today's rules,
// and with `apply: true` rewrites them. Asked after a rule change or a move to
// another position, and from ຄິດລະດັບໃໝ່. Admin only, like the rules.
const SEVERITY_MAX_DAYS = 366;
router.post('/absence-severity', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { from, to, employees, positions, apply } = req.body;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!valid(from) || !valid(to) || to < from) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
    if (days > SEVERITY_MAX_DAYS) return res.status(400).json({ message: `ເລືອກໄດ້ສູງສຸດ ${SEVERITY_MAX_DAYS} ວັນ` });
    const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    const changes = await reapplyAbsenceSeverity({
      from,
      to,
      employeeIds: ids(employees),
      positionIds: ids(positions),
      apply: apply === true,
      byEmail: req.user.email,
    });
    res.json({ applied: apply === true, changes });
  } catch (err) {
    next(err);
  }
});

// Days staff under the ມາບໍ່ປົກກະຕິ rule (utils/substituteRule.js — the DJs,
// and anyone with no regular shift) actually scanned or were marked ມາແທນ.
// They have no fixed shift, so a day with neither can't be judged worked or
// absent — the payroll summary leaves it blank instead of presuming ມ.
router.get('/substitute-position-days', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!valid(from) || !valid(to)) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const candidates = await Employee.find({}, 'position allowsSubstituteStatus defaultShiftCategory defaultShiftStart defaultShiftEnd')
      .populate('position', 'allowsSubstituteStatus')
      .lean();
    const employees = candidates.filter(followsIrregularRule);
    if (!employees.length) return res.json([]);
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
