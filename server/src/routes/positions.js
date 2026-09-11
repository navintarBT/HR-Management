const crudRouter = require('./crudFactory');
const Position = require('../models/Position');

module.exports = crudRouter(Position, {
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
});
