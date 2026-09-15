const express = require('express');
const Employee = require('../models/Employee');
const AttendanceDaily = require('../models/AttendanceDaily');
const Leave = require('../models/Leave');
const Shift = require('../models/Shift');
const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const { authenticate } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 14, 30);
    const today = toDateKey(new Date());
    const selfEmployeeId = req.user.role === 'employee' && req.user.employeeId ? req.user.employeeId._id : null;

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - (days - 1));
    const fromKey = toDateKey(fromDate);

    if (req.user.role === 'employee' && !selfEmployeeId) {
      return res.json({
        totalEmployees: 0,
        presentToday: 0,
        lateToday: 0,
        onLeaveToday: 0,
        absentToday: 0,
        pendingLeaves: 0,
        trend: [],
        todayShifts: [],
        pendingApprovals: [],
      });
    }

    const employeeFilter = selfEmployeeId ? { employee: selfEmployeeId } : {};
    const employeeCountFilter = selfEmployeeId ? { _id: selfEmployeeId, status: 'active' } : { status: 'active' };
    const leaveFilter = selfEmployeeId ? { employee: selfEmployeeId } : {};
    const shiftFilter = selfEmployeeId ? { employee: selfEmployeeId } : {};
    const swapFilter = selfEmployeeId ? { $or: [{ requestedBy: selfEmployeeId }, { toEmployee: selfEmployeeId }] } : {};

    const [totalEmployees, todayRows, trendRows, pendingLeaves, todayShiftsRaw, pendingLeaveRows, pendingSwapRows] =
      await Promise.all([
        Employee.countDocuments(employeeCountFilter),
        AttendanceDaily.find({ date: today, ...employeeFilter }),
        AttendanceDaily.find({ date: { $gte: fromKey, $lte: today }, ...employeeFilter }),
        Leave.countDocuments({ status: 'pending', ...leaveFilter }),
        Shift.find({ date: today, status: 'scheduled', ...shiftFilter })
          .populate('employee', 'firstName lastName employeeCode')
          .populate('position', 'name')
          .sort({ startTime: 1 }),
        Leave.find({ status: 'pending', ...leaveFilter })
          .populate('employee', 'firstName lastName')
          .sort({ createdAt: -1 })
          .limit(6),
        ShiftSwapRequest.find({ status: 'pending', ...swapFilter })
          .populate('requestedBy', 'firstName lastName')
          .populate('toEmployee', 'firstName lastName')
          .populate({ path: 'fromShift', select: 'date startTime endTime' })
          .sort({ createdAt: -1 })
          .limit(6),
      ]);

    const presentToday = todayRows.filter((r) => r.status === 'present' || r.status === 'late').length;
    const lateToday = todayRows.filter((r) => r.status === 'late').length;
    const onLeaveToday = todayRows.filter((r) => r.status === 'leave').length;
    const absentToday = todayRows.filter((r) => r.status === 'absent').length;

    const byDate = new Map();
    for (let i = 0; i < days; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = toDateKey(d);
      byDate.set(key, { date: key, present: 0, late: 0, absent: 0, leave: 0 });
    }
    for (const row of trendRows) {
      const bucket = byDate.get(row.date);
      if (!bucket) continue;
      if (row.status === 'present') bucket.present += 1;
      else if (row.status === 'late') {
        bucket.late += 1;
        bucket.present += 1;
      } else if (row.status === 'absent') bucket.absent += 1;
      else if (row.status === 'leave') bucket.leave += 1;
    }

    const attendanceByEmployee = new Map(todayRows.map((r) => [String(r.employee), r.status]));

    const todayShifts = todayShiftsRaw
      .filter((s) => s.employee && s.position)
      .map((s) => ({
        _id: String(s._id),
        startTime: s.startTime,
        endTime: s.endTime,
        employeeName: `${s.employee.firstName} ${s.employee.lastName}`,
        employeeCode: s.employee.employeeCode,
        positionName: s.position.name,
        attendanceStatus: attendanceByEmployee.get(String(s.employee._id)) || null,
      }));

    const pendingApprovals = [
      ...pendingLeaveRows
        .filter((l) => l.employee)
        .map((l) => ({
          _id: String(l._id),
          kind: 'leave',
          employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
          createdAt: l.createdAt,
          leaveType: l.type,
          startDate: toDateKey(l.startDate),
          endDate: toDateKey(l.endDate),
        })),
      ...pendingSwapRows
        .filter((s) => s.requestedBy && s.fromShift)
        .map((s) => ({
          _id: String(s._id),
          kind: 'swap',
          employeeName: `${s.requestedBy.firstName} ${s.requestedBy.lastName}`,
          createdAt: s.createdAt,
          shiftDate: s.fromShift.date,
          shiftStart: s.fromShift.startTime,
          shiftEnd: s.fromShift.endTime,
          toEmployeeName: s.toEmployee ? `${s.toEmployee.firstName} ${s.toEmployee.lastName}` : null,
        })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);

    res.json({
      totalEmployees,
      presentToday,
      lateToday,
      onLeaveToday,
      absentToday,
      pendingLeaves,
      trend: Array.from(byDate.values()),
      todayShifts,
      pendingApprovals,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
