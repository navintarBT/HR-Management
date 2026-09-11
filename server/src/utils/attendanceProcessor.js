const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');

const STANDARD_START_HOUR = 9;
const STANDARD_START_MINUTE = 0;
const GRACE_MINUTES = 15;
const STANDARD_WORK_HOURS = 8;

function toDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayRange(dateKey) {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(`${dateKey}T23:59:59.999`);
  return { start, end };
}

// Recomputes the daily aggregate for one employee on one day from raw logs.
async function recomputeDay(employeeId, dateKey) {
  const { start, end } = dayRange(dateKey);
  const logs = await AttendanceLog.find({
    employee: employeeId,
    timestamp: { $gte: start, $lte: end },
  }).sort('timestamp');

  if (!logs.length) return null;

  const firstIn = logs[0].timestamp;
  const lastOut = logs.length > 1 ? logs[logs.length - 1].timestamp : null;

  // Use the employee's scheduled shift start time when one exists (restaurant-style
  // rostering), otherwise fall back to the fixed office-hours default below. The
  // shift's category (if any) also carries the late-arrival policy — how many
  // minutes of grace before "late", and how many before "late" escalates to "absent".
  const shift = await Shift.findOne({ employee: employeeId, date: dateKey, status: 'scheduled' }).populate('category');
  let standardStartHour = STANDARD_START_HOUR;
  let standardStartMinute = STANDARD_START_MINUTE;
  let graceMinutes = GRACE_MINUTES;
  let autoAbsentMinutes = null;
  if (shift) {
    const [h, m] = shift.startTime.split(':').map(Number);
    standardStartHour = h;
    standardStartMinute = m;
    if (shift.category) {
      graceMinutes = shift.category.graceMinutes ?? GRACE_MINUTES;
      autoAbsentMinutes = shift.category.autoAbsentMinutes ?? null;
    }
  }

  const standardStart = new Date(firstIn);
  standardStart.setHours(standardStartHour, standardStartMinute + graceMinutes, 0, 0);
  const lateMinutes = firstIn > standardStart
    ? Math.round((firstIn - standardStart) / 60000)
    : 0;

  const workedHours = lastOut ? Math.round(((lastOut - firstIn) / 3600000) * 100) / 100 : 0;
  const otHours = workedHours > STANDARD_WORK_HOURS
    ? Math.round((workedHours - STANDARD_WORK_HOURS) * 100) / 100
    : 0;

  const status = !lastOut
    ? 'incomplete'
    : autoAbsentMinutes != null && lateMinutes > autoAbsentMinutes
      ? 'absent'
      : lateMinutes > 0
        ? 'late'
        : 'present';

  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    { employee: employeeId, date: dateKey, firstIn, lastOut, workedHours, lateMinutes, otHours, status },
    { upsert: true, new: true }
  );
}

async function markAbsent(employeeId, dateKey) {
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn: null,
      lastOut: null,
      workedHours: 0,
      lateMinutes: 0,
      otHours: 0,
      status: 'absent',
    },
    { upsert: true, new: true }
  );
}

async function markLeave(employeeId, dateKey) {
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn: null,
      lastOut: null,
      workedHours: 0,
      lateMinutes: 0,
      otHours: 0,
      status: 'leave',
    },
    { upsert: true, new: true }
  );
}

// Re-derives daily aggregates from every raw log matching the given filter.
async function reprocessFromLogs({ employeeId, dateKey } = {}) {
  const match = {};
  if (employeeId) match.employee = employeeId;
  if (dateKey) {
    const { start, end } = dayRange(dateKey);
    match.timestamp = { $gte: start, $lte: end };
  }

  const pairs = await AttendanceLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          employee: '$employee',
          date: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
          },
        },
      },
    },
  ]);

  const results = [];
  for (const pair of pairs) {
    if (!pair._id.employee) continue;
    const doc = await recomputeDay(pair._id.employee, pair._id.date);
    if (doc) results.push(doc);
  }
  return results;
}

module.exports = {
  toDateKey,
  dayRange,
  recomputeDay,
  markAbsent,
  markLeave,
  reprocessFromLogs,
  STANDARD_START_HOUR,
  STANDARD_START_MINUTE,
  GRACE_MINUTES,
  STANDARD_WORK_HOURS,
};
