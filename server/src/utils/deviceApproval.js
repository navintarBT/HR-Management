// Whether a terminal may feed this system (models/Device.js `approved`): only
// an explicit false holds one back, so terminals registered before approval
// existed keep working untouched.
function isApprovedDevice(device) {
  return !!device && device.approved !== false;
}

const APPROVED_DEVICE_FILTER = { approved: { $ne: false } };

// Set on a terminal's row the first time it's ever seen.
const NEW_DEVICE_DEFAULTS = { attStamp: 0, opStamp: 0, approved: false };

module.exports = { isApprovedDevice, APPROVED_DEVICE_FILTER, NEW_DEVICE_DEFAULTS };
