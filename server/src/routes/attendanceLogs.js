const crudRouter = require('./crudFactory');
const AttendanceLog = require('../models/AttendanceLog');

// Read-only from the UI side; writes happen only through /api/attendance/push.
module.exports = crudRouter(AttendanceLog, {
  populate: 'employee',
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
});
