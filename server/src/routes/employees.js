const crudRouter = require('./crudFactory');
const Employee = require('../models/Employee');

module.exports = crudRouter(Employee, {
  populate: 'department position',
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['firstName', 'lastName', 'employeeCode', 'email'],
});
