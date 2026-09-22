const crudRouter = require('./crudFactory');
const Holiday = require('../models/Holiday');
const Shift = require('../models/Shift');

module.exports = crudRouter(Holiday, {
  writeRoles: ['admin', 'manager'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  // Two holidays landing on the same calendar day is almost certainly a mistake.
  beforeCreate: async (body) => {
    if (!body.date) return null;
    const conflict = await Holiday.findOne({ date: body.date });
    if (conflict) return `ມີວັນພັກຮ້ານ "${conflict.name}" ຢູ່ວັນທີ່ນີ້ແລ້ວ`;
    return null;
  },
  // The client tags every Shift it creates/overwrites to 'rest' for this
  // holiday with `holiday: <this id>` — clean those up before the holiday
  // itself is gone, rather than leaving orphaned "rest" rows behind.
  beforeDelete: async (id) => {
    await Shift.deleteMany({ holiday: id });
    return null;
  },
});
