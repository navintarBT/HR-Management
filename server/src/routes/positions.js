const crudRouter = require('./crudFactory');
const Position = require('../models/Position');
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const { checkHeadConflict } = require('../utils/headConflicts');
const { computeSubstituteTransitionUpdate } = require('../utils/substituteRule');

module.exports = crudRouter(Position, {
  populate: 'departments head',
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  beforeDelete: async (id) => {
    const inUse = await Employee.exists({ position: id });
    if (inUse) return 'ຕໍາແໜ່ງນີ້ຖືກນໍາໃຊ້ໂດຍພະນັກງານຢູ່ແລ້ວ ບໍ່ສາມາດລຶບໄດ້';
    return null;
  },
  // One employee can only head one position, and can't also be a department's head.
  beforeCreate: async (body) => {
    if (!body.head) return null;
    return checkHeadConflict({
      ownModel: Position,
      ownLabel: 'ຫົວໜ້າຕໍາແໜ່ງ',
      ownUnitWord: 'ຕໍາແໜ່ງ',
      otherModel: Department,
      otherLabel: 'ຫົວໜ້າພະແນກ',
      headId: body.head,
    });
  },
  beforeUpdate: async (id, body) => {
    if (!body.head) return null;
    return checkHeadConflict({
      ownModel: Position,
      ownLabel: 'ຫົວໜ້າຕໍາແໜ່ງ',
      ownUnitWord: 'ຕໍາແໜ່ງ',
      otherModel: Department,
      otherLabel: 'ຫົວໜ້າພະແນກ',
      headId: body.head,
      excludeId: id,
    });
  },
  // ຫົວໜ້າຕໍາແໜ່ງ is the source of truth for every employee's ຫົວໜ້າຕໍາແໜ່ງ — when
  // it changes here, push it to every employee already holding this position so
  // their stored positionHead never drifts from what's configured on the position.
  afterUpdate: async (position, body) => {
    if ('head' in body) {
      await Employee.updateMany({ position: position._id }, { positionHead: position.head || null });
    }
    // Turning this on means "nobody in this position has a fixed schedule" —
    // backs up and clears it for everyone already here in the same action.
    // Turning it back off restores each person's own backed-up shift time —
    // only for employees actually inheriting the position's setting (no
    // individual override of their own); this toggle is always an explicit
    // flip of the current value, so the old effective value for them was
    // simply the opposite of the new one.
    if ('allowsSubstituteStatus' in body) {
      const wasEnabled = !body.allowsSubstituteStatus;
      const willBeEnabled = body.allowsSubstituteStatus === true;
      const inheritingEmployees = await Employee.find({ position: position._id, allowsSubstituteStatus: null });
      for (const emp of inheritingEmployees) {
        const transition = computeSubstituteTransitionUpdate(emp, wasEnabled, willBeEnabled);
        if (transition) await Employee.updateOne({ _id: emp._id }, transition);
      }
    }
  },
});
