// Enforces "one head, one role": an employee can head at most one department,
// at most one position, and never a department AND a position at the same time.
async function checkHeadConflict({ ownModel, ownLabel, ownUnitWord, otherModel, otherLabel, headId, excludeId }) {
  const ownQuery = excludeId ? { head: headId, _id: { $ne: excludeId } } : { head: headId };
  const [ownConflict, otherConflict] = await Promise.all([ownModel.findOne(ownQuery), otherModel.findOne({ head: headId })]);

  if (ownConflict) {
    return `ພະນັກງານຄົນນີ້ເປັນ${ownLabel} "${ownConflict.name}" ຢູ່ແລ້ວ ບໍ່ສາມາດເປັນຫົວໜ້າໄດ້ຫຼາຍກວ່າ 1 ${ownUnitWord}`;
  }
  if (otherConflict) {
    return `ພະນັກງານຄົນນີ້ເປັນ${otherLabel} "${otherConflict.name}" ຢູ່ແລ້ວ ${otherLabel}ບໍ່ສາມາດເປັນ${ownLabel}ໄດ້`;
  }
  return null;
}

module.exports = { checkHeadConflict };
