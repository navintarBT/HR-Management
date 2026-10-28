const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');
const {
  QUERY_USERS_COMMAND,
  QUERY_TEMPLATES_COMMAND,
  buildDeleteUserCommand,
  buildQueryAttLogCommand,
  hashText,
} = require('./zkProtocol');
const { APPROVED_DEVICE_FILTER } = require('./deviceApproval');

// Queues command strings for one device, handing out consecutive cmdIds in one
// go (provisioning a terminal can be hundreds of commands). An identical
// command still waiting to be picked up isn't queued twice — pushing the same
// employee twice before the device polls is one command, not two. Entries are
// { command, pin?, employeeId? }. See routes/adms.js for how these get
// delivered (GET /iclock/getrequest) and acknowledged (POST /iclock/devicecmd).
async function queueCommandsForDevice(device, entries) {
  const hashed = entries.map((entry) => ({ ...entry, commandHash: hashText(entry.command) }));
  const waiting = await DeviceCommand.find(
    { serialNumber: device.serialNumber, status: 'pending', commandHash: { $in: hashed.map((e) => e.commandHash) } },
    'commandHash'
  );
  const skip = new Set(waiting.map((c) => c.commandHash));
  const fresh = hashed.filter((entry) => {
    if (skip.has(entry.commandHash)) return false;
    skip.add(entry.commandHash);
    return true;
  });
  if (!fresh.length) return [];
  const updated = await Device.findOneAndUpdate({ _id: device._id }, { $inc: { cmdCounter: fresh.length } }, { new: true });
  const firstId = updated.cmdCounter - fresh.length + 1;
  return DeviceCommand.insertMany(
    fresh.map((entry, i) => ({
      serialNumber: device.serialNumber,
      cmdId: firstId + i,
      command: entry.command,
      commandHash: entry.commandHash,
      deviceUserId: entry.pin,
      employee: entry.employeeId,
    }))
  );
}

async function queueCommandForDevice(device, command, { pin, employeeId } = {}) {
  const [cmd] = await queueCommandsForDevice(device, [{ command, pin, employeeId }]);
  return cmd ?? null;
}

// Broadcasts to every known device when no specific serial is given — we
// don't track which specific terminal(s) a PIN is actually enrolled on
// (Device only records terminals that have ever talked to us, not a
// per-PIN enrollment map), and a ZKTeco terminal harmlessly no-ops a
// command for a PIN it doesn't have, so queuing on all of them is the only
// way to guarantee it reaches wherever that PIN really is.
// Never to a terminal that isn't approved (utils/deviceApproval.js) — it
// couldn't collect them anyway.
async function queueCommandToDevices(command, { pin, employeeId, serialNumbers } = {}) {
  const devices = serialNumbers?.length
    ? await Device.find({ serialNumber: { $in: serialNumbers }, ...APPROVED_DEVICE_FILTER })
    : await Device.find(APPROVED_DEVICE_FILTER);
  const queued = [];
  for (const device of devices) {
    // eslint-disable-next-line no-await-in-loop
    const cmd = await queueCommandForDevice(device, command, { pin, employeeId });
    if (cmd) queued.push(cmd);
  }
  return queued;
}

// Deleting a still-linked Employee's enrollment (ลบພະນັກງານ / ລຶບອອກຈາກ
// ເຄື່ອງສະແກນ flows in employees.js) — keeps the employee reference on the
// queued command for context.
async function queueDeleteUserCommand(employee) {
  if (!employee.deviceUserId) return [];
  return queueCommandToDevices(buildDeleteUserCommand(employee.deviceUserId), {
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
  return queueCommandToDevices(buildDeleteUserCommand(pin), { pin, serialNumbers: [serialNumber] });
}

// Asks devices to re-report who's enrolled and their fingerprint/face
// templates — see routes/adms.js for how the replies are parsed. Confirmed
// against real MB10 hardware: the plain "DATA QUERY USERINFO" (no PIN filter)
// is what the device acks and then uploads BIODATA in response to; the
// explicit template query covers firmware that only sends user lines for it.
async function queueQueryUsersCommand(serialNumbers) {
  const users = await queueCommandToDevices(QUERY_USERS_COMMAND, { serialNumbers });
  const templates = await queueCommandToDevices(QUERY_TEMPLATES_COMMAND, { serialNumbers });
  return [...users, ...templates];
}

// Asks one device to re-send its own attendance records for a period — the
// replies arrive as ordinary ATTLOG uploads, which are deduplicated on
// (device, PIN, time), so anything already stored is simply skipped.
async function queueQueryAttLogCommand(serialNumber, startTime, endTime) {
  return queueCommandToDevices(buildQueryAttLogCommand(startTime, endTime), { serialNumbers: [serialNumber] });
}

module.exports = {
  queueCommandsForDevice,
  queueCommandForDevice,
  queueCommandToDevices,
  queueDeleteUserCommand,
  queueDeletePinCommand,
  queueQueryUsersCommand,
  queueQueryAttLogCommand,
};
