const crudRouter = require('./crudFactory');
const ShiftCategory = require('../models/ShiftCategory');

module.exports = crudRouter(ShiftCategory, {
  writeRoles: ['admin', 'manager'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  // Two categories with the exact same time range are almost certainly a
  // duplicate created by accident (e.g. via the quick-add picker on the
  // employee form) rather than an intentional second preset for the same hours.
  beforeCreate: async (body) => {
    if (!body.startTime || !body.endTime) return null;
    const conflict = await ShiftCategory.findOne({ startTime: body.startTime, endTime: body.endTime });
    if (conflict) return `ມີໝວດໝູ່ກະ "${conflict.name}" ທີ່ໃຊ້ເວລາດຽວກັນ (${body.startTime}-${body.endTime}) ຢູ່ແລ້ວ`;
    return null;
  },
  beforeUpdate: async (id, body) => {
    if (!body.startTime || !body.endTime) return null;
    const conflict = await ShiftCategory.findOne({ startTime: body.startTime, endTime: body.endTime, _id: { $ne: id } });
    if (conflict) return `ມີໝວດໝູ່ກະ "${conflict.name}" ທີ່ໃຊ້ເວລາດຽວກັນ (${body.startTime}-${body.endTime}) ຢູ່ແລ້ວ`;
    return null;
  },
});
