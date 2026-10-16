const Employee = require('../models/Employee');
const ShiftCategory = require('../models/ShiftCategory');
const Shift = require('../models/Shift');
const ScheduledShiftChange = require('../models/ScheduledShiftChange');
const { toDateKey } = require('./attendanceProcessor');

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
async function pinNewScheduleForEffectiveDate(employee, category, effectiveDate) {
  const existing = await Shift.findOne({ employee: employee._id, date: effectiveDate });
  if (existing) {
    const err = new Error('ມື້ນີ້ມີຕາຕະລາງຕັ້ງຄ່າໄວ້ແລ້ວ — ກະລຸນາລຶບ ຫຼື ຄືນຄ່າປົກກະຕິມື້ນີ້ກ່ອນ');
    err.status = 409;
    throw err;
  }
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
// read this live (effectiveDate itself is already covered by the pin above).
async function applyScheduledShiftChange(change) {
  await Employee.updateOne(
    { _id: change.employee },
    { defaultShiftCategory: change.newShiftCategory, defaultShiftStart: null, defaultShiftEnd: null }
  );
}

// Same catch-up-on-restart + periodic-recheck shape as runDueScheduledSwaps.
async function runDueScheduledShiftChanges() {
  const todayKey = toDateKey(new Date());
  const due = await ScheduledShiftChange.find({ status: 'pending', effectiveDate: { $lte: todayKey } });
  for (const change of due) {
    // eslint-disable-next-line no-await-in-loop
    await applyScheduledShiftChange(change);
    change.status = 'applied';
    change.appliedAt = new Date();
    // eslint-disable-next-line no-await-in-loop
    await change.save();
  }
  return due.length;
}

module.exports = {
  SHIFT_CHANGE_PIN_NOTE,
  pinNewScheduleForEffectiveDate,
  unpinScheduleForEffectiveDate,
  applyScheduledShiftChange,
  runDueScheduledShiftChanges,
};
