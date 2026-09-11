const crudRouter = require('./crudFactory');
const Department = require('../models/Department');

module.exports = crudRouter(Department, {
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
});
