const BulkEditRound = require('../models/BulkEditRound');
const Employee = require('../models/Employee');
const { shiftFieldsDiffer } = require('./shiftHistory');

// A round is only good for the moves it was opened for, right after it was
// opened — not a key that unlocks the fields later.
const ROUND_TTL_MS = 60 * 60 * 1000;

function idOf(value) {
  if (!value) return null;
  return typeof value === 'object' && value._id ? value._id : value;
}

function shiftLabel(employee) {
  const category = employee?.defaultShiftCategory;
  if (category && typeof category === 'object' && category.startTime) return `${category.startTime}-${category.endTime}`;
  if (employee?.defaultShiftStart && employee?.defaultShiftEnd) return `${employee.defaultShiftStart}-${employee.defaultShiftEnd}`;
  return null;
}

const POPULATE = [
  { path: 'department', select: 'name' },
  { path: 'position', select: 'name' },
  { path: 'defaultShiftCategory', select: 'startTime endTime' },
];

// Department, position and regular shift as one person has them now.
function sideOf(employee) {
  return {
    department: employee?.department?.name ?? null,
    position: employee?.position?.name ?? null,
    shift: shiftLabel(employee),
  };
}

async function sidesOf(employeeIds) {
  const employees = await Employee.find({ _id: { $in: employeeIds } }).populate(POPULATE).lean();
  return new Map(employees.map((e) => [String(e._id), { employee: e, side: sideOf(e) }]));
}

// Which of department / position / regular shift a save would change — on the
// fields it actually sends, before anything else adjusts them.
function lockedChanges(current, payload) {
  const changed = [];
  const differs = (a, b) => String(idOf(a) ?? '') !== String(idOf(b) ?? '');
  if ('department' in payload && differs(current.department, payload.department)) changed.push('department');
  if ('position' in payload && differs(current.position, payload.position)) changed.push('position');
  const shiftKeys = ['defaultShiftCategory', 'defaultShiftStart', 'defaultShiftEnd'].filter((k) => k in payload);
  if (shiftKeys.length) {
    const next = { defaultShiftCategory: current.defaultShiftCategory, defaultShiftStart: current.defaultShiftStart, defaultShiftEnd: current.defaultShiftEnd };
    for (const k of shiftKeys) next[k] = payload[k];
    if (shiftFieldsDiffer(current, next)) changed.push('shift');
  }
  return changed;
}

// The open round of this kind that lists this person, opened within the hour.
async function openRoundFor(roundId, employeeId, action) {
  if (!roundId || typeof roundId !== 'string' || !/^[0-9a-f]{24}$/i.test(roundId)) return null;
  const round = await BulkEditRound.findOne({
    _id: roundId,
    action,
    finishedAt: null,
    createdAt: { $gte: new Date(Date.now() - ROUND_TTL_MS) },
    items: { $elemMatch: { employee: employeeId, status: 'pending' } },
  });
  return round;
}

// One person's move went through: their department/position/shift now.
async function markDone(roundId, employeeId, extra = {}) {
  const found = (await sidesOf([employeeId])).get(String(employeeId));
  await BulkEditRound.updateOne(
    { _id: roundId, 'items.employee': employeeId },
    { $set: { 'items.$.status': 'ok', 'items.$.after': { ...(found?.side ?? {}), ...extra }, 'items.$.message': null } }
  );
}

// A ຍ້າຍກະ made outside ແກ້ໄຂກະແບບກຸ່ມ (the employee page, ຕັ້ງຄ່າແຜນວຽກ) is
// a round of one, recorded once it went through. `before` is read before the
// move (a start date of today switches the shift straight away).
async function recordSingleShiftMove({ employee, before, category, effectiveDate, user, source }) {
  const found = (await sidesOf([employee._id])).get(String(employee._id));
  const label = `${category.startTime}-${category.endTime}`;
  return BulkEditRound.create({
    action: 'shift',
    source: ['employee', 'planner'].includes(source) ? source : 'planner',
    target: { id: category._id, label, effectiveDate },
    byEmail: user?.email,
    by: user?.employeeId ? user.employeeId._id : null,
    items: [
      {
        employee: employee._id,
        employeeCode: employee.employeeCode ?? null,
        name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || null,
        before: before ?? {},
        after: { ...(found?.side ?? {}), shift: label },
        status: 'ok',
      },
    ],
    finishedAt: new Date(),
  });
}

// A ຍ້າຍກະ called off before its date: its line in the history says so.
async function markShiftMoveCancelled(change) {
  await BulkEditRound.updateMany(
    {
      action: 'shift',
      'target.id': change.newShiftCategory,
      'target.effectiveDate': change.effectiveDate,
      items: { $elemMatch: { employee: change.employee, status: 'ok' } },
    },
    { $set: { 'items.$[i].status': 'cancelled', 'items.$[i].message': 'ຍົກເລີກກ່ອນເຖິງວັນທີ່ມີຜົນ' } },
    { arrayFilters: [{ 'i.employee': change.employee, 'i.status': 'ok' }] }
  );
}

module.exports = {
  sideOf,
  sidesOf,
  lockedChanges,
  openRoundFor,
  markDone,
  recordSingleShiftMove,
  markShiftMoveCancelled,
  shiftLabel,
  POPULATE,
  ROUND_TTL_MS,
};
