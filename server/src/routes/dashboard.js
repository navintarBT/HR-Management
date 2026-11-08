const express = require('express');
const Employee = require('../models/Employee');
const AttendanceDaily = require('../models/AttendanceDaily');
const Leave = require('../models/Leave');
const Shift = require('../models/Shift');
const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const Department = require('../models/Department');
const Holiday = require('../models/Holiday');
const ScheduledPositionSwap = require('../models/ScheduledPositionSwap');
const ShiftChangeLog = require('../models/ShiftChangeLog');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey, pickDayOverride } = require('../utils/attendanceProcessor');
const { loadRestDaySchedules, restDaysOn } = require('../utils/restDaySchedule');
const { shiftOnDate } = require('../utils/shiftHistory');
const { followsIrregularRule } = require('../utils/substituteRule');

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

    // 'incomplete' is everyone still on shift (scanned in, not out yet) —
    // they came in, and a late scan-in already carries its lateMinutes.
    // Counting only present/late left the day's numbers at 0 until people
    // started scanning out.
    const cameIn = (r) => r.status === 'present' || r.status === 'late' || r.status === 'incomplete';
    const cameLate = (r) => r.status === 'late' || (r.status === 'incomplete' && r.lateMinutes > 0);
    const presentToday = todayRows.filter(cameIn).length;
    const lateToday = todayRows.filter(cameLate).length;
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
      if (cameIn(row)) {
        bucket.present += 1;
        if (cameLate(row)) bucket.late += 1;
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

// ລາຍງານແຕ່ລະພະແນກ: for one day (today unless asked), every department's
// people sorted into ມາ / ຂາດ / ພັກ / ລາ / ຍັງບໍ່ມາ / ບໍ່ມີຂໍ້ມູນ, with names,
// plus the ສະຫຼັບກະ still waiting that touch the department. Same order of
// precedence as ສະຫຼຸບເງິນເດືອນ (an approved leave first, then the day's own
// shift row, then the recurring rest day as it stood that day), except that
// someone who scanned in on a rest day shows as ມາ (marked so) — this is about
// who is actually here.
const groupBy = (rows, key = (r) => String(r.employee)) => {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
};
const DAY_BUCKETS = ['came', 'absent', 'rest', 'leave', 'pending', 'other'];
const CAME_STATUSES = ['present', 'late', 'incomplete', 'substituted'];

router.get('/department-day', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const now = new Date();
    const today = toDateKey(now);
    const yesterday = toDateKey(new Date(now.getTime() - 864e5));
    const asked = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : today;
    const date = asked > today ? today : asked;
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);
    const dow = dayStart.getDay();

    // On staff that day: working now (and started by then), or left after it.
    const employees = await Employee.find(
      {
        $and: [
          { $or: [{ status: 'active' }, { status: 'resigned', terminationDate: { $gte: dayStart } }] },
          { $or: [{ hireDate: null }, { hireDate: { $lte: dayEnd } }] },
        ],
      },
      'employeeCode firstName lastName department position status deviceUserId defaultRestDay defaultShiftCategory defaultShiftStart defaultShiftEnd allowsSubstituteStatus'
    )
      .populate('position', 'name allowsSubstituteStatus')
      .populate('defaultShiftCategory', 'startTime endTime')
      .lean();
    const ids = employees.map((e) => e._id);

    const [departments, dailies, shifts, leaves, holiday, restSchedules, laterShiftChanges, pendingSwaps, activeByPosition] = await Promise.all([
      Department.find({}, 'name').lean(),
      AttendanceDaily.find({ date, employee: { $in: ids } }, 'employee status firstIn lastOut lateMinutes').lean(),
      Shift.find({ date, employee: { $in: ids } }, 'employee status startTime endTime coveringFor').lean(),
      Leave.find(
        { status: 'approved', employee: { $in: ids }, startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } },
        'employee type restDayOverlaps'
      ).lean(),
      Holiday.findOne({ date }, 'name').lean(),
      loadRestDaySchedules(ids, date, date),
      // Only changes after the day matter: the first one's "before" is the
      // regular shift that day (utils/shiftHistory.js shiftOnDate).
      ShiftChangeLog.find({ employee: { $in: ids }, effectiveDate: { $gt: date } }, 'employee effectiveDate previous next').lean(),
      ScheduledPositionSwap.find({ status: 'pending', effectiveDate: { $gte: today } })
        .populate('positionA positionB', 'name departments')
        .sort({ effectiveDate: 1 })
        .lean(),
      // How many a swap would move: everyone working in the position now, the
      // same people applyPositionSwap takes (utils/positionSwap.js).
      Employee.aggregate([{ $match: { status: 'active', position: { $ne: null } } }, { $group: { _id: '$position', n: { $sum: 1 } } }]),
    ]);
    const peopleInPosition = new Map(activeByPosition.map((r) => [String(r._id), r.n]));
    const dailyOf = new Map(dailies.map((d) => [String(d.employee), d]));
    const shiftsOf = groupBy(shifts);
    const leaveOf = new Map(leaves.map((l) => [String(l.employee), l]));
    const shiftChangesOf = groupBy(laterShiftChanges);

    const regularShift = (emp) => {
      const then = shiftOnDate(shiftChangesOf.get(String(emp._id)), date);
      if (then) return then.startTime && then.endTime ? { startTime: then.startTime, endTime: then.endTime } : null;
      if (emp.defaultShiftCategory?.startTime) return { startTime: emp.defaultShiftCategory.startTime, endTime: emp.defaultShiftCategory.endTime };
      if (emp.defaultShiftStart && emp.defaultShiftEnd) return { startTime: emp.defaultShiftStart, endTime: emp.defaultShiftEnd };
      return null;
    };

    const classify = (emp) => {
      const id = String(emp._id);
      const daily = dailyOf.get(id);
      const leave = leaveOf.get(id);
      const override = pickDayOverride(shiftsOf.get(id));
      const scanned = !!daily && (!!daily.firstIn || !!daily.lastOut);
      const restOverlap = leave && (leave.restDayOverlaps ?? []).find((o) => o.date === date);

      if (leave && !restOverlap) return { bucket: 'leave', leaveType: leave.type, note: scanned ? 'ມີການສະແກນ' : undefined };

      const restReason = restOverlap
        ? restOverlap.type === 'holiday'
          ? `ຮ້ານປິດ${restOverlap.holidayName ? ` (${restOverlap.holidayName})` : ''}`
          : 'ວັນພັກ'
        : override?.status === 'rest'
          ? 'ພັກ (ຕັ້ງໄວ້ມື້ນີ້)'
          : override?.status === 'swapped'
            ? 'ບໍ່ມີກະ (ມື້ສະຫຼັບກະ)'
            : override?.status !== 'scheduled' && holiday
              ? `ຮ້ານປິດ (${holiday.name})`
              : override?.status !== 'scheduled' && restDaysOn(restSchedules.get(id), emp.defaultRestDay, date).includes(dow)
                ? 'ວັນພັກປະຈຳ'
                : null;

      if (daily && CAME_STATUSES.includes(daily.status)) {
        const notes = [];
        if (daily.status === 'substituted') notes.push('ມາແທນ');
        if (daily.lateMinutes > 0) notes.push(`ຊ້າ ${daily.lateMinutes} ນາທີ`);
        if (daily.status === 'incomplete') notes.push(daily.firstIn && date >= yesterday ? 'ຍັງບໍ່ສະແກນອອກ' : 'ສະແກນຄັ້ງດຽວ');
        if (override?.coveringFor) notes.push('ເຮັດແທນ');
        if (restReason) {
          notes.push(restReason.startsWith('ຮ້ານປິດ') ? 'ມາມື້ຮ້ານປິດ' : restReason.startsWith('ບໍ່ມີກະ') ? 'ມາມື້ບໍ່ມີກະ' : 'ມາມື້ພັກ');
        }
        return { bucket: 'came', firstIn: daily.firstIn, late: daily.lateMinutes > 0, note: notes.join(' · ') || undefined };
      }
      if (restReason) return { bucket: 'rest', note: restReason };
      if (daily?.status === 'absent') return { bucket: 'absent' };

      // A work day with nothing recorded yet.
      if (!emp.deviceUserId) return { bucket: 'other', note: 'ບໍ່ມີລະຫັດສະແກນ' };
      const expected =
        override?.status === 'scheduled' ? { startTime: override.startTime, endTime: override.endTime } : followsIrregularRule(emp) ? null : regularShift(emp);
      if (!expected) return { bucket: 'other', note: 'ບໍ່ມີກະປະຈຳ' };
      if (date >= yesterday) {
        const start = new Date(`${date}T${expected.startTime}:00`);
        return { bucket: 'pending', shift: `${expected.startTime}-${expected.endTime}`, overdue: now > start };
      }
      return { bucket: 'other', note: 'ບໍ່ມີຂໍ້ມູນສະແກນ' };
    };

    const NO_DEPARTMENT = 'none';
    const nameOf = new Map(departments.map((d) => [String(d._id), d.name]));
    const groups = new Map();
    const groupFor = (id) => {
      const key = id && nameOf.has(String(id)) ? String(id) : NO_DEPARTMENT;
      if (!groups.has(key)) {
        groups.set(key, {
          _id: key,
          name: key === NO_DEPARTMENT ? 'ບໍ່ມີພະແນກ' : nameOf.get(key),
          total: 0,
          counts: Object.fromEntries(DAY_BUCKETS.map((b) => [b, 0])),
          late: 0,
          people: Object.fromEntries(DAY_BUCKETS.map((b) => [b, []])),
          swaps: [],
        });
      }
      return groups.get(key);
    };
    const totals = { total: 0, late: 0, ...Object.fromEntries(DAY_BUCKETS.map((b) => [b, 0])) };
    for (const emp of employees) {
      const result = classify(emp);
      const group = groupFor(emp.department);
      group.total += 1;
      group.counts[result.bucket] += 1;
      totals.total += 1;
      totals[result.bucket] += 1;
      if (result.late) {
        group.late += 1;
        totals.late += 1;
      }
      group.people[result.bucket].push({
        _id: String(emp._id),
        employeeCode: emp.employeeCode ?? '',
        name: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
        position: emp.position?.name ?? null,
        ...result,
        bucket: undefined,
      });
    }
    for (const group of groups.values()) {
      for (const list of Object.values(group.people)) list.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
    }

    // Each waiting swap under every department either of its positions is in.
    const swaps = pendingSwaps.map((s) => {
      const a = s.positionA;
      const b = s.positionB;
      const departmentIds = [...new Set([...(a?.departments ?? []), ...(b?.departments ?? [])].map(String).filter((id) => nameOf.has(id)))];
      return {
        _id: String(s._id),
        effectiveDate: s.effectiveDate,
        positionA: a?.name ?? 'ຕຳແໜ່ງນີ້ຖືກລຶບໄປແລ້ວ',
        positionB: b?.name ?? 'ຕຳແໜ່ງນີ້ຖືກລຶບໄປແລ້ວ',
        peopleA: a ? peopleInPosition.get(String(a._id)) ?? 0 : 0,
        peopleB: b ? peopleInPosition.get(String(b._id)) ?? 0 : 0,
        departments: departmentIds.map((id) => ({ _id: id, name: nameOf.get(id) })),
      };
    });
    for (const swap of swaps) {
      const keys = swap.departments.length ? swap.departments.map((d) => d._id) : [NO_DEPARTMENT];
      for (const key of keys) groupFor(key === NO_DEPARTMENT ? null : key).swaps.push(swap);
    }

    const list = [...groups.values()].sort((x, y) =>
      x._id === NO_DEPARTMENT ? 1 : y._id === NO_DEPARTMENT ? -1 : x.name.localeCompare(y.name)
    );
    res.json({ date, today, holiday: holiday ? holiday.name : null, totals, departments: list, swaps });
  } catch (err) {
    next(err);
  }
});

// Department headcount + overall status breakdown, for the org-composition
// chart. Admin/manager only — an "employee" role has no use for headcount
// numbers and this skips building the self-scoped variant that /summary needs.
router.get('/org-composition', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const [byDepartment, byStatus] = await Promise.all([
      Employee.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
        { $project: { _id: 0, name: { $ifNull: [{ $arrayElemAt: ['$dept.name', 0] }, 'ບໍ່ມີພະແນກ'] }, count: 1 } },
        { $sort: { count: -1 } },
      ]),
      Employee.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
      ]),
    ]);
    res.json({ byDepartment, byStatus });
  } catch (err) {
    next(err);
  }
});

// Counts-only data-completeness gaps — deliberately never returns names or
// any other identifying detail (salary/leave-balance in particular ride on
// the same Employee document as pay info, so this stays a single combined
// count, same precedent as every other salary-adjacent surface in this app).
// Mongo's `{field: null}` matches both a missing field and one explicitly
// set to null, so no schema change was needed to compute any of this.
router.get('/data-quality', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const active = { status: 'active' };
    const [
      missingPosition,
      missingDepartment,
      missingHireDate,
      missingEmploymentType,
      missingEmail,
      missingReportingLine,
      missingRestDay,
      missingDeviceCode,
      stuckDrafts,
      resignedNoTerminationDate,
      missingPayInfo,
    ] = await Promise.all([
      Employee.countDocuments({ ...active, position: null }),
      Employee.countDocuments({ ...active, department: null }),
      Employee.countDocuments({ ...active, hireDate: null }),
      Employee.countDocuments({ ...active, employmentType: null }),
      Employee.countDocuments({ ...active, $or: [{ email: null }, { email: '' }] }),
      Employee.countDocuments({ ...active, supervisor: null, positionHead: null }),
      Employee.countDocuments({ ...active, $or: [{ defaultRestDay: null }, { defaultRestDay: [] }] }),
      Employee.countDocuments({ ...active, deviceUserId: null }),
      Employee.countDocuments({ status: 'draft' }),
      Employee.countDocuments({ status: 'resigned', terminationDate: null }),
      Employee.countDocuments({ ...active, $or: [{ salary: null }, { annualLeaveDays: null }] }),
    ]);
    res.json({
      missingPosition,
      missingDepartment,
      missingHireDate,
      missingEmploymentType,
      missingEmail,
      missingReportingLine,
      missingRestDay,
      missingDeviceCode,
      stuckDrafts,
      resignedNoTerminationDate,
      missingPayInfo,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
