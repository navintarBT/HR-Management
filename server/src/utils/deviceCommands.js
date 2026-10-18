const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');

// Hands out the next cmdId for this device and queues one command string.
// Broadcasts to every known device when no specific serial is given — we
// don't track which specific terminal(s) a PIN is actually enrolled on
// (Device only records terminals that have ever talked to us, not a
// per-PIN enrollment map), and a ZKTeco terminal harmlessly no-ops a
// command for a PIN it doesn't have, so queuing on all of them is the only
// way to guarantee it reaches wherever that PIN really is. See
// routes/adms.js for how this gets delivered (GET /iclock/getrequest) and
// acknowledged (POST /iclock/devicecmd).
async function queueCommandToDevices(command, { pin, employeeId, serialNumbers } = {}) {
  const devices = serialNumbers?.length
    ? await Device.find({ serialNumber: { $in: serialNumbers } })
    : await Device.find();
  const queued = [];
  for (const device of devices) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await Device.findOneAndUpdate({ _id: device._id }, { $inc: { cmdCounter: 1 } }, { new: true });
    // eslint-disable-next-line no-await-in-loop
    const cmd = await DeviceCommand.create({
      serialNumber: device.serialNumber,
      cmdId: updated.cmdCounter,
      command,
      deviceUserId: pin,
      employee: employeeId,
    });
    queued.push(cmd);
  }
  return queued;
}

// Deleting a still-linked Employee's enrollment (ลบພະນັກງານ / ລຶບອອກຈາກ
// ເຄື່ອງສະແກນ flows in employees.js) — keeps the employee reference on the
// queued command for context.
async function queueDeleteUserCommand(employee) {
  if (!employee.deviceUserId) return [];
  return queueCommandToDevices(`DATA DELETE USERINFO PIN=${employee.deviceUserId}`, {
    pin: employee.deviceUserId,
    employeeId: employee._id,
  });
}

// Deleting a bare PIN that's enrolled on a device but matches no Employee at
// all (a stale enrollment, a prior test, someone removed outside this
// system) — the "ລຶບ" button on the orphaned-IDs page. No employee to
// reference, so just the PIN. Scoped to the one device it was reported
// enrolled on (the orphaned list is already per-device), unlike the
// employee-delete flow above which broadcasts everywhere since it doesn't
// know which device(s) to target.
async function queueDeletePinCommand(pin, serialNumber) {
  if (!pin || !serialNumber) return [];
  return queueCommandToDevices(`DATA DELETE USERINFO PIN=${pin}`, { pin, serialNumbers: [serialNumber] });
}

// Asks every known device to re-report its full enrolled-user list — see
// routes/adms.js's BIODATA handling for how the reply gets parsed and
// recorded into DeviceEnrolledUser. Confirmed against real MB10 hardware:
// the plain "DATA QUERY USERINFO" (no PIN filter) is what the device acks
// and then uploads BIODATA in response to.
async function queueQueryUsersCommand() {
  return queueCommandToDevices('DATA QUERY USERINFO');
}

module.exports = { queueDeleteUserCommand, queueDeletePinCommand, queueQueryUsersCommand };
