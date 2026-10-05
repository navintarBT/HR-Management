const crudRouter = require('./crudFactory');
const Department = require('../models/Department');
const Position = require('../models/Position');
const Employee = require('../models/Employee');
const { checkHeadConflict } = require('../utils/headConflicts');

module.exports = crudRouter(Department, {
  populate: 'head',
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  beforeDelete: async (id) => {
    const inUse = await Employee.exists({ department: id });
    if (inUse) return 'ພະແນກນີ້ຖືກນໍາໃຊ້ໂດຍພະນັກງານຢູ່ແລ້ວ ບໍ່ສາມາດລຶບໄດ້';
    return null;
  },
  // One employee can only head one department, and can't also be a position's head.
  beforeCreate: async (body) => {
    if (!body.head) return null;
    return checkHeadConflict({
      ownModel: Department,
      ownLabel: 'ຫົວໜ້າພະແນກ',
      ownUnitWord: 'ພະແນກ',
      otherModel: Position,
      otherLabel: 'ຫົວໜ້າຕໍາແໜ່ງ',
      headId: body.head,
    });
  },
  beforeUpdate: async (id, body) => {
    if (!body.head) return null;
    return checkHeadConflict({
      ownModel: Department,
      ownLabel: 'ຫົວໜ້າພະແນກ',
      ownUnitWord: 'ພະແນກ',
      otherModel: Position,
      otherLabel: 'ຫົວໜ້າຕໍາແໜ່ງ',
      headId: body.head,
      excludeId: id,
    });
  },
  // ຫົວໜ້າພະແນກ is the source of truth for every employee's ຫົວໜ້າງານ — when it
  // changes here, push it to every employee already in this department so their
  // stored supervisor never drifts from what's configured on the department.
  afterUpdate: async (department, body) => {
    if (!('head' in body)) return;
    await Employee.updateMany({ department: department._id }, { supervisor: department.head || null });
  },
});
