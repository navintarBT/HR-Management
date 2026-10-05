require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');

const Department = require('./models/Department');
const Position = require('./models/Position');
const EmploymentType = require('./models/EmploymentType');
const Employee = require('./models/Employee');
const User = require('./models/User');
const AttendanceLog = require('./models/AttendanceLog');
const AttendanceDaily = require('./models/AttendanceDaily');
const Leave = require('./models/Leave');
const Shift = require('./models/Shift');
const ShiftSwapRequest = require('./models/ShiftSwapRequest');
const ShiftCategory = require('./models/ShiftCategory');

const { toDateKey, markAbsent, markLeave, reprocessFromLogs } = require('./utils/attendanceProcessor');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// A restaurant/bar roster runs two shift slots a day, every day of the week.
const SHIFT_SLOTS = [
  {
    key: 'lunch',
    categoryName: 'ກະທ່ຽງ',
    color: '#B45309',
    startTime: '10:30',
    endTime: '15:00',
    graceMinutes: 15,
    autoAbsentMinutes: 60,
    roster: [
      { position: 'lead', count: 1 },
      { position: 'server', count: 2 },
      { position: 'bartender', count: 1 },
      { position: 'cook', count: 1 },
      { position: 'cashier', count: 1 },
    ],
  },
  {
    key: 'dinner',
    categoryName: 'ກະແລງ',
    color: '#4338CA',
    startTime: '16:30',
    endTime: '22:00',
    graceMinutes: 10,
    autoAbsentMinutes: 45,
    roster: [
      { position: 'lead', count: 1 },
      { position: 'server', count: 3 },
      { position: 'bartender', count: 2 },
      { position: 'cook', count: 2 },
      { position: 'cashier', count: 1 },
    ],
  },
];

const SHIFT_WINDOW_PAST_DAYS = 14;
const SHIFT_WINDOW_FUTURE_DAYS = 7;

async function run() {
  await connectDB();

  console.log('[seed] clearing existing collections...');
  await Promise.all([
    Department.deleteMany({}),
    Position.deleteMany({}),
    EmploymentType.deleteMany({}),
    Employee.deleteMany({}),
    User.deleteMany({}),
    AttendanceLog.deleteMany({}),
    AttendanceDaily.deleteMany({}),
    Leave.deleteMany({}),
    Shift.deleteMany({}),
    ShiftSwapRequest.deleteMany({}),
    ShiftCategory.deleteMany({}),
  ]);

  console.log('[seed] creating departments & positions...');
  const [deptKitchen, deptBar, deptFront] = await Department.insertMany([
    { name: 'ຄົວ' },
    { name: 'ບາ' },
    { name: 'ໜ້າຮ້ານ' },
  ]);

  const [posServer, posBartender, posCook, posCashier, posLead] = await Position.insertMany([
    { name: 'ພະນັກງານເສີບ' },
    { name: 'ບາເທັນເດີ' },
    { name: 'ກຸ໊ກ' },
    { name: 'ແຄສເຊຍ' },
    { name: 'ຫົວໜ້າກະ' },
  ]);

  const [empTypeFullTime] = await EmploymentType.insertMany([
    { name: 'ເຕັມເວລາ' },
    { name: 'ບາງເວລາ' },
    { name: 'ທົດລອງງານ' },
    { name: 'ສັນຍາຈ້າງ' },
  ]);

  const positionByKey = {
    server: posServer,
    bartender: posBartender,
    cook: posCook,
    cashier: posCashier,
    lead: posLead,
  };

  console.log('[seed] creating shift categories...');
  const categoryDocs = await ShiftCategory.insertMany(
    SHIFT_SLOTS.map((slot) => ({
      name: slot.categoryName,
      startTime: slot.startTime,
      endTime: slot.endTime,
      color: slot.color,
      graceMinutes: slot.graceMinutes,
      autoAbsentMinutes: slot.autoAbsentMinutes,
    }))
  );
  const categoryByKey = Object.fromEntries(SHIFT_SLOTS.map((slot, i) => [slot.key, categoryDocs[i]]));

  console.log('[seed] creating employees...');
  // [firstName, lastName, department, position]
  const employeeSeeds = [
    ['ບຸນມີ', 'ວົງສະຫວັນ', deptFront, posLead],
    ['ດາລາ', 'ພົມມະວົງ', deptFront, posServer],
    ['ວິໄລ', 'ສີສຸລາດ', deptBar, posBartender],
    ['ອຸໄລວັນ', 'ແສງອາລຸນ', deptFront, posServer],
    ['ທອງສະຫວັນ', 'ໄຊຍະວົງ', deptKitchen, posCook],
    ['ວັນນະລີ', 'ບຸນຍະສານ', deptBar, posLead],
    ['ປະຈັກ', 'ວິໄລວົງ', deptFront, posServer],
    ['ບົວຄໍາ', 'ພັນທະວົງ', deptBar, posBartender],
    ['ໄຊຍະ', 'ແກ້ວມະນີວົງ', deptKitchen, posCook],
    ['ຈັນທະລີ', 'ສຸລິຍະວົງ', deptKitchen, posLead],
    ['ສຸກສະຫວັນ', 'ທອງດີ', deptFront, posCashier],
    ['ນາງແກ້ວ', 'ຮຸ່ງເຮືອງ', deptFront, posServer],
    ['ອະນຸໄຊ', 'ສັກສິດ', deptKitchen, posCook],
    ['ວະລາພອນ', 'ຈະເລີນສຸກ', deptBar, posBartender],
    ['ທີຣະຍຸດ', 'ໝັ້ນຄົງ', deptFront, posServer],
    ['ກະມົນຊະນົກ', 'ສຸກສັນ', deptFront, posCashier],
    ['ນັດຖະພົນ', 'ໄພສານ', deptKitchen, posCook],
    ['ຣັດຕະນາພອນ', 'ທັບທິມ', deptBar, posBartender],
  ];

  const employees = [];
  for (let i = 0; i < employeeSeeds.length; i += 1) {
    const [firstName, lastName, department, position] = employeeSeeds[i];
    const code = `EMP${String(i + 1).padStart(3, '0')}`;
    const hireDate = new Date(2021, randomInt(0, 11), randomInt(1, 28) + randomInt(0, 3) * 90);
    const status = i >= 16 ? 'inactive' : 'active';
    // eslint-disable-next-line no-await-in-loop
    const employee = await Employee.create({
      employeeCode: code,
      firstName,
      lastName,
      department: department._id,
      position: position._id,
      employmentType: empTypeFullTime._id,
      hireDate,
      status,
      deviceUserId: String(i + 1),
      email: `${code.toLowerCase()}@hr-demo.local`,
      phone: `08${randomInt(1, 9)}-${randomInt(100, 999)}-${randomInt(1000, 9999)}`,
    });
    employees.push(employee);
  }

  console.log('[seed] creating login accounts...');
  const [adminPass, managerPass, employeePass] = await Promise.all([
    bcrypt.hash('Admin@123', 10),
    bcrypt.hash('Manager@123', 10),
    bcrypt.hash('Employee@123', 10),
  ]);

  await User.insertMany([
    { email: 'admin@hr-demo.local', passwordHash: adminPass, role: 'admin' },
    { email: 'manager@hr-demo.local', passwordHash: managerPass, role: 'manager', employeeId: employees[0]._id },
    { email: 'employee@hr-demo.local', passwordHash: employeePass, role: 'employee', employeeId: employees[1]._id },
  ]);

  const activeEmployees = employees.filter((e) => e.status === 'active');
  const today = new Date();

  console.log('[seed] building shift roster (2 slots/day, 3 weeks)...');
  // Picks `count` employees for one (position, slot) requirement — mostly from
  // that position's own staff, but sometimes rotates in someone else entirely
  // (demonstrating that a shift's position is independent of an employee's
  // home position, which is the whole point of this feature).
  function pickForSlot(positionId, count, usedIds) {
    const picks = [];
    for (let i = 0; i < count; i += 1) {
      const candidates = activeEmployees.filter((e) => !usedIds.has(e._id.toString()));
      if (!candidates.length) break;
      const homeMatches = candidates.filter((e) => e.position.toString() === positionId.toString());
      const useHome = homeMatches.length && Math.random() < 0.75;
      const pool = useHome ? homeMatches : candidates;
      const emp = pool[randomInt(0, pool.length - 1)];
      usedIds.add(emp._id.toString());
      picks.push(emp);
    }
    return picks;
  }

  const allShifts = []; // { doc, employee, date, startTime, endTime, dayOffset }

  for (let dayOffset = -SHIFT_WINDOW_PAST_DAYS; dayOffset <= SHIFT_WINDOW_FUTURE_DAYS; dayOffset += 1) {
    const day = new Date(today);
    day.setDate(day.getDate() + dayOffset);
    const dateKey = toDateKey(day);

    for (const slot of SHIFT_SLOTS) {
      const usedIds = new Set();
      for (const req of slot.roster) {
        const position = positionByKey[req.position];
        const picks = pickForSlot(position._id, req.count, usedIds);
        for (const emp of picks) {
          // eslint-disable-next-line no-await-in-loop
          const doc = await Shift.create({
            employee: emp._id,
            position: position._id,
            category: categoryByKey[slot.key]._id,
            date: dateKey,
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
          allShifts.push({ doc, employee: emp._id, date: dateKey, startTime: slot.startTime, endTime: slot.endTime, dayOffset });
        }
      }
    }
  }

  console.log(`[seed] created ${allShifts.length} shifts`);

  console.log('[seed] generating attendance logs from past shifts...');
  const shiftsByEmpDate = {};
  for (const s of allShifts) {
    if (s.dayOffset > 0) continue; // only past/today shifts produce attendance
    const empKey = s.employee.toString();
    shiftsByEmpDate[empKey] = shiftsByEmpDate[empKey] || {};
    shiftsByEmpDate[empKey][s.date] = shiftsByEmpDate[empKey][s.date] || [];
    shiftsByEmpDate[empKey][s.date].push(s);
  }

  const absentDays = [];

  for (const employee of activeEmployees) {
    const byDate = shiftsByEmpDate[employee._id.toString()] || {};
    for (const [dateKey, shiftsForDay] of Object.entries(byDate)) {
      const day = new Date(`${dateKey}T00:00:00`);
      const earliestStart = shiftsForDay.reduce((min, s) => (s.startTime < min ? s.startTime : min), shiftsForDay[0].startTime);
      const latestEnd = shiftsForDay.reduce((max, s) => (s.endTime > max ? s.endTime : max), shiftsForDay[0].endTime);

      const roll = Math.random();
      if (roll < 0.06) {
        absentDays.push({ employeeId: employee._id, dateKey });
        continue;
      }

      // A small slice show up very late (well past any category's autoAbsentMinutes) but
      // still scan out, so the seeded data demonstrates the late-counts-as-absent policy
      // rather than being swallowed by the "forgot to scan out" (incomplete) bucket below.
      const veryLate = roll >= 0.14 && roll < 0.17;
      const [startHour, startMinute] = earliestStart.split(':').map(Number);
      const checkIn = new Date(day);
      checkIn.setHours(startHour, startMinute + (veryLate ? randomInt(50, 90) : randomInt(-15, 20)), randomInt(0, 59), 0);

      // eslint-disable-next-line no-await-in-loop
      await AttendanceLog.create({
        employee: employee._id,
        deviceUserId: employee.deviceUserId,
        deviceId: 'SIM-POS-1',
        timestamp: checkIn,
        type: 'in',
        raw: { seeded: true },
      });

      if (roll < 0.14) continue; // incomplete day: forgot to scan out

      const [endHour, endMinute] = latestEnd.split(':').map(Number);
      const checkOut = new Date(day);
      checkOut.setHours(endHour, endMinute + randomInt(-10, 45), randomInt(0, 59), 0);

      // eslint-disable-next-line no-await-in-loop
      await AttendanceLog.create({
        employee: employee._id,
        deviceUserId: employee.deviceUserId,
        deviceId: 'SIM-POS-1',
        timestamp: checkOut,
        type: 'out',
        raw: { seeded: true },
      });
    }
  }

  console.log('[seed] processing daily aggregates...');
  await reprocessFromLogs({});
  for (const { employeeId, dateKey } of absentDays) {
    // eslint-disable-next-line no-await-in-loop
    await markAbsent(employeeId, dateKey);
  }

  console.log('[seed] creating leave requests...');
  const leaveSeeds = [
    { employee: employees[2], type: 'vacation', offsetStart: 5, span: 3, status: 'pending', reason: 'ໄປທ່ຽວພັກຜ່ອນກັບຄອບຄົວ' },
    { employee: employees[3], type: 'sick', offsetStart: -2, span: 1, status: 'approved', reason: 'ບໍ່ສະບາຍ ເປັນໄຂ້ຫວັດ' },
    { employee: employees[4], type: 'personal', offsetStart: -10, span: 2, status: 'rejected', reason: 'ທຸລະສ່ວນຕົວ' },
    { employee: employees[6], type: 'vacation', offsetStart: -5, span: 4, status: 'approved', reason: 'ລາພັກຜ່ອນປະຈໍາປີ' },
    { employee: employees[8], type: 'sick', offsetStart: 1, span: 1, status: 'pending', reason: 'ນັດໝໍ' },
  ];

  const managerEmployee = employees[0];
  for (const seedItem of leaveSeeds) {
    const start = new Date(today);
    start.setDate(start.getDate() + seedItem.offsetStart);
    const end = new Date(start);
    end.setDate(end.getDate() + seedItem.span - 1);

    // eslint-disable-next-line no-await-in-loop
    const leave = await Leave.create({
      employee: seedItem.employee._id,
      type: seedItem.type,
      startDate: start,
      endDate: end,
      reason: seedItem.reason,
      status: seedItem.status,
      approver: seedItem.status === 'pending' ? undefined : managerEmployee._id,
      decidedAt: seedItem.status === 'pending' ? undefined : new Date(),
    });

    if (leave.status === 'approved') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (isWeekend(d)) continue;
        // eslint-disable-next-line no-await-in-loop
        await markLeave(leave.employee, toDateKey(d));
      }
    }
  }

  console.log('[seed] creating shift swap requests...');
  function findUpcomingShift(employeeId, { excludeShiftId } = {}) {
    return allShifts.find(
      (s) =>
        s.dayOffset > 0 &&
        s.employee.toString() === employeeId.toString() &&
        (!excludeShiftId || s.doc._id.toString() !== excludeShiftId.toString())
    );
  }

  const giveAwayFrom = findUpcomingShift(employees[3]._id);
  if (giveAwayFrom) {
    await ShiftSwapRequest.create({
      requestedBy: employees[3]._id,
      fromShift: giveAwayFrom.doc._id,
      toEmployee: employees[11]._id,
      reason: 'ມີທຸລະຄອບຄົວ ຂໍໃຫ້ເພື່ອນຮ່ວມງານຊ່ວຍຮັບແທນ',
      status: 'pending',
    });
  }

  const tradeA = findUpcomingShift(employees[2]._id);
  const tradeB = tradeA ? findUpcomingShift(employees[7]._id, { excludeShiftId: tradeA.doc._id }) : null;
  if (tradeA && tradeB) {
    await ShiftSwapRequest.create({
      requestedBy: employees[2]._id,
      fromShift: tradeA.doc._id,
      toEmployee: employees[7]._id,
      toShift: tradeB.doc._id,
      reason: 'ຂໍແລກກະກັນ ເນື່ອງຈາກມີນັດໝໍ',
      status: 'pending',
    });
  }

  const approvedA = findUpcomingShift(employees[4]._id);
  const approvedB = approvedA ? findUpcomingShift(employees[8]._id, { excludeShiftId: approvedA.doc._id }) : null;
  if (approvedA && approvedB) {
    const shiftA = await Shift.findById(approvedA.doc._id);
    const shiftB = await Shift.findById(approvedB.doc._id);
    const temp = shiftA.employee;
    shiftA.employee = shiftB.employee;
    shiftB.employee = temp;
    await shiftA.save();
    await shiftB.save();
    await ShiftSwapRequest.create({
      requestedBy: employees[4]._id,
      fromShift: shiftA._id,
      toEmployee: employees[8]._id,
      toShift: shiftB._id,
      reason: 'ແລກກະລ່ວງໜ້າ',
      status: 'approved',
      approver: managerEmployee._id,
      decidedAt: new Date(),
    });
  }

  const rejectedFrom = findUpcomingShift(employees[0]._id);
  if (rejectedFrom) {
    await ShiftSwapRequest.create({
      requestedBy: employees[0]._id,
      fromShift: rejectedFrom.doc._id,
      toEmployee: employees[5]._id,
      reason: 'ຂໍສະຫຼັບກະ',
      status: 'rejected',
      approver: managerEmployee._id,
      decidedAt: new Date(),
    });
  }

  console.log('\n[seed] done! Demo accounts:');
  console.log('  admin    admin@hr-demo.local    / Admin@123');
  console.log('  manager  manager@hr-demo.local  / Manager@123');
  console.log('  employee employee@hr-demo.local / Employee@123');

  process.exit(0);
}

run().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
