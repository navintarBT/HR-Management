const Employee = require('../models/Employee');
const ShiftCategory = require('../models/ShiftCategory');
const Shift = require('../models/Shift');
const ScheduledShiftChange = require('../models/ScheduledShiftChange');
const Leave = require('../models/Leave');
const AttendanceDaily = require('../models/AttendanceDaily');
const { toDateKey } = require('./attendanceProcessor');
const { recordShiftChange } = require('./shiftHistory');
const { restDaysOnFor } = require('./restDaySchedule');

// Tags the Shift row this creates so a later cancel can find and remove
// exactly that row (and nothing an admin set by hand), same idea as
// positionSwap.js's AUTO_SWAP_PIN_NOTE_PREFIX.
const SHIFT_CHANGE_PIN_NOTE = 'ສ້າງອັດຕະໂນມັດ — ມື້ເລີ່ມຕົ້ນກະໃໝ່ (ຍ້າຍກະລ່ວງໜ້າ)';

// Pins the NEW category's time as an explicit same-date Shift override for
// effectiveDate itself, created right away however far in the future that
// date is — not left for the sweep to create later. resolveExpectedShift
// checks for a same-date Shift override before ever falling back to the
// employee's live default, so this one row makes the effective date itself
// immediately correct with no race against exactly when the field flip below
// lands — that flip only has to be right by effectiveDate+1, which always has
// a wide safety margin (at worst, catches up at the next server restart).
// The start date can't be a day they're on approved leave or someone else
// works for them: ຕັ້ງຄ່າແຜນວຽກ never offers those, and a group move from
// ແກ້ໄຂກະແບບກຸ່ມ is refused for that person the same way.
async function pinNewScheduleForEffectiveDate(employee, category, effectiveDate) {
  const refuse = (message) => {
    const err = new Error(message);
    err.status = 409;
    return err;
  };
  // The start-date shift is a working shift, which needs their position.
  if (!employee.position) throw refuse('ຍັງບໍ່ມີຕຳແໜ່ງ — ຕັ້ງຕຳແໜ່ງໃຫ້ກ່ອນ ຈຶ່ງຍ້າຍກະລ່ວງໜ້າໄດ້');
  const [substituted, onLeave] = await Promise.all([
    AttendanceDaily.exists({ employee: employee._id, date: effectiveDate, status: 'substituted' }),
    Leave.exists({
      employee: employee._id,
      status: 'approved',
      startDate: { $lte: new Date(`${effectiveDate}T23:59:59.999`) },
      endDate: { $gte: new Date(`${effectiveDate}T00:00:00.000`) },
    }),
  ]);
  if (substituted) throw refuse('ມື້ນີ້ມີຄົນມາແທນ ບໍ່ສາມາດຕັ້ງຈຸດເລີ່ມຕົ້ນກະໃໝ່ທີ່ມື້ນີ້ໄດ້');
  if (onLeave) throw refuse('ມື້ນີ້ລາ ບໍ່ສາມາດຕັ້ງຈຸດເລີ່ມຕົ້ນກະໃໝ່ທີ່ມື້ນີ້ໄດ້');
  const existing = await Shift.findOne({ employee: employee._id, date: effectiveDate });
  // A start date that is their day off stays one: no working shift is put on
  // it (that made a rest day a work day, and a no-show there a ຂາດ — seen
  // 11/11/2026). The new shift is still theirs from this date on (the change
  // itself is recorded as of it); they simply start on their next working day.
  if (existing?.status === 'rest') return;
  if (existing) {
    const err = new Error('ມື້ນີ້ມີຕາຕະລາງຕັ້ງຄ່າໄວ້ແລ້ວ — ກະລຸນາລຶບ ຫຼື ຄືນຄ່າປົກກະຕິມື້ນີ້ກ່ອນ');
    err.status = 409;
    throw err;
  }
  const restDays = await restDaysOnFor(employee._id, effectiveDate);
  if (restDays.includes(new Date(`${effectiveDate}T00:00:00`).getDay())) return;
  await Shift.create({
    employee: employee._id,
    position: employee.position,
    category: category._id,
    date: effectiveDate,
    status: 'scheduled',
    startTime: category.startTime,
    endTime: category.endTime,
    note: SHIFT_CHANGE_PIN_NOTE,
  });
}

async function unpinScheduleForEffectiveDate(employeeId, effectiveDate) {
  await Shift.deleteOne({ employee: employeeId, date: effectiveDate, note: SHIFT_CHANGE_PIN_NOTE });
}

// Flips the employee's own standing default — only days AFTER effectiveDate
// read this live (effectiveDate itself is already covered by the pin above),
// and the change is recorded so days BEFORE it keep being judged by the old
// shift (the last night's morning scan-out stays on that night).
async function applyScheduledShiftChange(change) {
  const before = await Employee.findById(change.employee, 'defaultShiftCategory defaultShiftStart defaultShiftEnd');
  await Employee.updateOne(
    { _id: change.employee },
    { defaultShiftCategory: change.newShiftCategory, defaultShiftStart: null, defaultShiftEnd: null }
  );
  if (before) {
    await recordShiftChange(change.employee, before, { defaultShiftCategory: change.newShiftCategory }, change.effectiveDate, 'scheduled-change');
  }
}

// Same catch-up-on-restart + periodic-recheck shape as runDueScheduledSwaps,
// and the same atomic claim so two overlapping checks never both apply one.
async function runDueScheduledShiftChanges() {
  const todayKey = toDateKey(new Date());
  const due = await ScheduledShiftChange.find({ status: 'pending', effectiveDate: { $lte: todayKey } }, '_id');
  let applied = 0;
  for (const { _id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const change = await ScheduledShiftChange.findOneAndUpdate(
      { _id, status: 'pending' },
      { status: 'applied', appliedAt: new Date() },
      { new: true }
    );
    if (!change) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await applyScheduledShiftChange(change);
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await ScheduledShiftChange.updateOne({ _id }, { status: 'pending', $unset: { appliedAt: 1 } });
      throw err;
    }
    applied += 1;
  }
  return applied;
}

module.exports = {
  SHIFT_CHANGE_PIN_NOTE,
  pinNewScheduleForEffectiveDate,
  unpinScheduleForEffectiveDate,
  applyScheduledShiftChange,
  runDueScheduledShiftChanges,
};
