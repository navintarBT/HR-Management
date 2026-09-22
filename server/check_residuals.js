require('dotenv').config();
const connectDB = require('./src/config/db');
require('./src/models/Department');
require('./src/models/Position');
require('./src/models/EmploymentType');
require('./src/models/ShiftCategory');
const Employee = require('./src/models/Employee');
const Shift = require('./src/models/Shift');
const AttendanceDaily = require('./src/models/AttendanceDaily');

async function isRestDay(employeeId, dateKey, employee) {
  const override = await Shift.findOne({ employee: employeeId, date: dateKey });
  if (override) return override.status === 'rest';
  const dow = new Date(`${dateKey}T00:00:00`).getDay();
  return employee.defaultRestDay === dow;
}

async function main() {
  await connectDB();
  const rows = await AttendanceDaily.find({
    date: { $gte: '2026-09-01', $lte: '2026-09-22' },
    status: { $in: ['late', 'absent', 'incomplete'] },
  }).populate('employee');

  console.log(`Found ${rows.length} non-present residual records. Checking if they fall on rest days...`);
  let onRestDay = 0;
  let notRestDay = 0;
  for (const r of rows) {
    if (!r.employee) continue;
    // eslint-disable-next-line no-await-in-loop
    const rest = await isRestDay(r.employee._id, r.date, r.employee);
    if (rest) onRestDay += 1;
    else {
      notRestDay += 1;
      console.log('NOT a rest day:', r.date, r.employee.employeeCode, r.status);
    }
  }
  console.log(`\nOn rest day: ${onRestDay}, NOT rest day: ${notRestDay}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
