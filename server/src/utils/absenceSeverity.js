const Employee = require('../models/Employee');
const AttendanceDaily = require('../models/AttendanceDaily');

// The deduction tier an absence costs — ວັນຫ້າມຂາດ for its weekday, else
// ມື້ທຳມະດາ; X2/X3, or null when neither is configured. The employee's own
// override replaces the position's entirely (same precedence as
// restDayRules.js's mergeRestDayRule). This used to be worked out live in the
// browser on every page load, from the CURRENT rules and position — so a rule
// change or a move to another position quietly rewrote what every past
// absence had cost, months already paid included. It's now locked onto the
// absence when it's recorded (models/AttendanceDaily.js) and only changed on
// purpose (reapplyAbsenceSeverity below).
function severityUnderRules(employee, dateKey) {
  const position = employee.position && typeof employee.position === 'object' ? employee.position : null;
  const dow = new Date(`${dateKey}T00:00:00`).getDay();
  const noAbsenceDays = employee.noAbsenceDays?.length ? employee.noAbsenceDays : position?.noAbsenceDays ?? [];
  const noAbsenceSeverity = employee.noAbsenceSeverity ?? position?.noAbsenceSeverity;
  if (noAbsenceDays.includes(dow) && noAbsenceSeverity) return noAbsenceSeverity;
  return employee.ordinaryAbsenceSeverity ?? position?.ordinaryAbsenceSeverity ?? null;
}

const RULE_FIELDS = 'position noAbsenceDays noAbsenceSeverity ordinaryAbsenceSeverity';
const POSITION_RULE_FIELDS = 'noAbsenceDays noAbsenceSeverity ordinaryAbsenceSeverity';

const CLEARED_SEVERITY = { absenceSeverity: null, absenceSeveritySetAt: null, absenceSeverityByEmail: null };

// The severity fields for an absence being written on (employeeId, dateKey):
// kept as they are if that day is already a locked absence (a re-mark, a
// manual time fix that still leaves it absent), otherwise locked now from
// today's rules.
async function severityFieldsForAbsence(employeeId, dateKey) {
  const existing = await AttendanceDaily.findOne(
    { employee: employeeId, date: dateKey },
    'status absenceSeverity absenceSeveritySetAt absenceSeverityByEmail'
  ).lean();
  if (existing?.status === 'absent' && existing.absenceSeveritySetAt) {
    return {
      absenceSeverity: existing.absenceSeverity ?? null,
      absenceSeveritySetAt: existing.absenceSeveritySetAt,
      absenceSeverityByEmail: existing.absenceSeverityByEmail ?? null,
    };
  }
  const employee = await Employee.findById(employeeId, RULE_FIELDS).populate('position', POSITION_RULE_FIELDS).lean();
  return { absenceSeverity: employee ? severityUnderRules(employee, dateKey) : null, absenceSeveritySetAt: new Date(), absenceSeverityByEmail: null };
}

async function loadEmployeesById(query, extraFields = '') {
  const employees = await Employee.find(query, `${RULE_FIELDS} ${extraFields}`).populate('position', POSITION_RULE_FIELDS).lean();
  return new Map(employees.map((e) => [String(e._id), e]));
}

// Absences recorded before tiers were stored get locked at the tier the
// pages were showing for them (today's rules), so the day this ships no
// number moves. Run once at startup; a no-op once everything is locked.
async function lockUnlockedAbsences() {
  const rows = await AttendanceDaily.find({ status: 'absent', absenceSeveritySetAt: null }, 'employee date').lean();
  if (!rows.length) return 0;
  const byId = await loadEmployeesById({ _id: { $in: [...new Set(rows.map((r) => String(r.employee)))] } });
  const now = new Date();
  await AttendanceDaily.bulkWrite(
    rows.map((r) => {
      const employee = byId.get(String(r.employee));
      return {
        updateOne: {
          filter: { _id: r._id },
          update: { $set: { absenceSeverity: employee ? severityUnderRules(employee, r.date) : null, absenceSeveritySetAt: now } },
        },
      };
    })
  );
  return rows.length;
}

// The absences in [from, to] — of the given employees, or of everyone
// currently in the given positions, or of everyone — whose locked tier differs
// from what today's rules give them; with `apply`, rewritten to it. This is
// the one deliberate way a recorded absence's tier changes: the question
// asked after a rule change or position move, and ຄິດລະດັບໃໝ່.
async function reapplyAbsenceSeverity({ from, to, employeeIds, positionIds, apply, byEmail }) {
  const employeeQuery = {};
  if (employeeIds?.length) employeeQuery._id = { $in: employeeIds };
  if (positionIds?.length) employeeQuery.position = { $in: positionIds };
  const byId = await loadEmployeesById(employeeQuery, 'employeeCode firstName lastName');
  if (!byId.size) return [];
  const rows = await AttendanceDaily.find(
    { status: 'absent', date: { $gte: from, $lte: to }, employee: { $in: [...byId.keys()] } },
    'employee date absenceSeverity'
  ).lean();

  const changes = [];
  for (const r of rows) {
    const employee = byId.get(String(r.employee));
    const next = severityUnderRules(employee, r.date);
    const current = r.absenceSeverity ?? null;
    if (next === current) continue;
    changes.push({
      _id: String(r._id),
      employee: String(r.employee),
      employeeCode: employee.employeeCode ?? '',
      employeeName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      date: r.date,
      from: current,
      to: next,
    });
  }
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.employeeCode.localeCompare(b.employeeCode));

  if (apply && changes.length) {
    const now = new Date();
    await AttendanceDaily.bulkWrite(
      changes.map((c) => ({
        updateOne: {
          filter: { _id: c._id, status: 'absent' },
          update: { $set: { absenceSeverity: c.to, absenceSeveritySetAt: now, absenceSeverityByEmail: byEmail ?? null } },
        },
      }))
    );
  }
  return changes;
}

module.exports = { severityUnderRules, severityFieldsForAbsence, lockUnlockedAbsences, reapplyAbsenceSeverity, CLEARED_SEVERITY };
