const crudRouter = require('./crudFactory');
const Position = require('../models/Position');
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const { checkHeadConflict } = require('../utils/headConflicts');
const { computeSubstituteTransitionUpdate } = require('../utils/substituteRule');

// A position with forbidden rest days but no fallback is exactly the gap
// this whole feature exists to close (a chosen/carried-over rest day would
// just get rejected with nobody around to pick again — see positionSwap.js),
// so a fallback is required the moment there's anything to fall back from. A
// fallback that's itself in the forbidden list would just recreate the same
// problem, so that's rejected too.
function validateRestDayFallback(restrictedRestDays, restDayFallback) {
  const restricted = restrictedRestDays ?? [];
  if (!restricted.length) return null;
  if (restDayFallback == null) {
    return 'ຖ້າມີວັນທີ່ຫ້າມພັກ ຕ້ອງຕັ້ງວັນພັກສຳຮອງນຳທຸກຄັ້ງ';
  }
  if (restricted.includes(restDayFallback)) {
    return 'ວັນພັກສຳຮອງຕ້ອງບໍ່ແມ່ນວັນທີ່ຢູ່ໃນລາຍການຫ້າມພັກ';
  }
  return null;
}

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
    const fallbackError = validateRestDayFallback(body.restrictedRestDays, body.restDayFallback);
    if (fallbackError) return fallbackError;
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
    if ('restrictedRestDays' in body || 'restDayFallback' in body) {
      const current = await Position.findById(id, 'restrictedRestDays restDayFallback');
      const effectiveRestricted = 'restrictedRestDays' in body ? body.restrictedRestDays : current?.restrictedRestDays;
      const effectiveFallback = 'restDayFallback' in body ? body.restDayFallback : current?.restDayFallback;
      const fallbackError = validateRestDayFallback(effectiveRestricted, effectiveFallback);
      if (fallbackError) return fallbackError;
    }
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
