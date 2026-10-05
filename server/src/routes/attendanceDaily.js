const crudRouter = require('./crudFactory');
const AttendanceDaily = require('../models/AttendanceDaily');

// Read-only processed report; writes happen via the reprocess job.
module.exports = crudRouter(AttendanceDaily, {
  populate: 'employee',
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  scopeQuery: (req, query) => {
    if (req.user.role === 'employee') {
      query.employee = req.user.employeeId ? req.user.employeeId._id : null;
    }
  },
});
