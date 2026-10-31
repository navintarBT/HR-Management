const Employee = require('../models/Employee');

// employeeCode and deviceUserId are unique but optional (sparse indexes). Someone
// without one must not have the field at all: a stored null still counts as a
// value, so a second null collides ("E11000 ... dup key: { deviceUserId: null }").
const OPTIONAL_UNIQUE_KEYS = ['employeeCode', 'deviceUserId'];

// The nulls left behind by the earlier ລຶບອອກຈາກເຄື່ອງສະແກນ, removed. A no-op once done.
async function unsetNullEmployeeKeys() {
  let changed = 0;
  for (const field of OPTIONAL_UNIQUE_KEYS) {
    // eslint-disable-next-line no-await-in-loop
    const { modifiedCount } = await Employee.updateMany({ [field]: { $type: 'null' } }, { $unset: { [field]: 1 } });
    changed += modifiedCount;
  }
  return changed;
}

module.exports = { OPTIONAL_UNIQUE_KEYS, unsetNullEmployeeKeys };
