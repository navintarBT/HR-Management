const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');

// Broadcasts to every known device — we don't track which specific
// terminal(s) an employee is actually enrolled on (Device only records the
// terminals that have ever talked to us, not a per-employee enrollment map),
// and a ZKTeco terminal harmlessly no-ops a delete for a PIN it doesn't have,
// so queuing on all of them is the only way to guarantee removal wherever
// they're really enrolled. See routes/adms.js for how this gets delivered.
async function queueDeleteUserCommand(employee) {
  if (!employee.deviceUserId) return [];
  const devices = await Device.find();
  const queued = [];
  for (const device of devices) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await Device.findOneAndUpdate({ _id: device._id }, { $inc: { cmdCounter: 1 } }, { new: true });
    // eslint-disable-next-line no-await-in-loop
    const cmd = await DeviceCommand.create({
      serialNumber: device.serialNumber,
      cmdId: updated.cmdCounter,
      command: `DATA DELETE USERINFO PIN=${employee.deviceUserId}`,
      deviceUserId: employee.deviceUserId,
      employee: employee._id,
    });
    queued.push(cmd);
  }
  return queued;
}

module.exports = { queueDeleteUserCommand };
