const crudRouter = require('./crudFactory');
const ShiftCategory = require('../models/ShiftCategory');

// If autoAbsentMinutes/severeLateMinutes were ever allowed to sit at or below
// graceMinutes, the "ຊ້າ" (plain) tier would never actually be reachable — an
// employee would already be judged "ຂາດວຽກ" (or jump straight to the most
// severe label) before their lateness ever crossed the grace boundary that's
// supposed to come first. Catches that footgun on save rather than letting an
// admin configure a policy whose middle tier can never show.
function validateLatePolicy(graceMinutes, autoAbsentMinutes, severeLateMinutes) {
  if (graceMinutes != null && autoAbsentMinutes != null && autoAbsentMinutes <= graceMinutes) {
    return 'ຄ່າ "ສາຍເກີນເທົ່າໃດນັບເປັນຂາດວຽກ" ຕ້ອງຫຼາຍກວ່າ "ຊ້າລະດັບທຳມະດາບໍ່ເກີນ" — ບໍ່ດັ່ງນັ້ນຈະບໍ່ມີໂອກາດເຫັນປ້າຍ "ຊ້າ" ທຳມະດາເລີຍ';
  }
  if (graceMinutes != null && severeLateMinutes != null && severeLateMinutes <= graceMinutes) {
    return 'ຄ່າ "ຊ້າຮ້າຍແຮງເກີນ" ຕ້ອງຫຼາຍກວ່າ "ຊ້າລະດັບທຳມະດາບໍ່ເກີນ"';
  }
  return null;
}

module.exports = crudRouter(ShiftCategory, {
  writeRoles: ['admin', 'manager'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  // Two categories with the exact same time range are almost certainly a
  // duplicate created by accident (e.g. via the quick-add picker on the
  // employee form) rather than an intentional second preset for the same hours.
  beforeCreate: async (body) => {
    if (body.startTime && body.endTime) {
      const conflict = await ShiftCategory.findOne({ startTime: body.startTime, endTime: body.endTime });
      if (conflict) return `ມີໝວດໝູ່ກະ "${conflict.name}" ທີ່ໃຊ້ເວລາດຽວກັນ (${body.startTime}-${body.endTime}) ຢູ່ແລ້ວ`;
    }
    return validateLatePolicy(body.graceMinutes, body.autoAbsentMinutes, body.severeLateMinutes);
  },
  beforeUpdate: async (id, body) => {
    if (body.startTime && body.endTime) {
      const conflict = await ShiftCategory.findOne({ startTime: body.startTime, endTime: body.endTime, _id: { $ne: id } });
      if (conflict) return `ມີໝວດໝູ່ກະ "${conflict.name}" ທີ່ໃຊ້ເວລາດຽວກັນ (${body.startTime}-${body.endTime}) ຢູ່ແລ້ວ`;
    }
    // Merge with the current record so a partial update (e.g. the "apply to
    // every category" bulk tool, which only sends the late-policy fields)
    // still gets validated against whatever the other value already is.
    const current = await ShiftCategory.findById(id);
    if (!current) return null;
    const graceMinutes = 'graceMinutes' in body ? body.graceMinutes : current.graceMinutes;
    const autoAbsentMinutes = 'autoAbsentMinutes' in body ? body.autoAbsentMinutes : current.autoAbsentMinutes;
    const severeLateMinutes = 'severeLateMinutes' in body ? body.severeLateMinutes : current.severeLateMinutes;
    return validateLatePolicy(graceMinutes, autoAbsentMinutes, severeLateMinutes);
  },
});
