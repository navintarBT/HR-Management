const crudRouter = require('./crudFactory');
const ShiftCategory = require('../models/ShiftCategory');

module.exports = crudRouter(ShiftCategory, {
  writeRoles: ['admin', 'manager'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
});
