const Device = require('../models/Device');
const Employee = require('../models/Employee');
const BiometricTemplate = require('../models/BiometricTemplate');
const { queueCommandsForDevice } = require('./deviceCommands');
const { buildUserInfoCommand, buildBiodataCommand, canReceiveTemplate, hashText } = require('./zkProtocol');
const { APPROVED_DEVICE_FILTER } = require('./deviceApproval');
const { allowsScanner } = require('./scannerAccess');

// Keeps every sync-enabled terminal holding the same people: an employee added
// here is pushed to them (so they only need to enroll a face/finger at the
// scanner), and a fingerprint/face enrolled on any terminal is pushed to the
// others. Only terminals with Device.syncEnabled take part, and each person
// only goes to the ones they're allowed on (utils/scannerAccess.js).

// A template that changes again this soon after its last change, coming from
// a different terminal, is almost certainly that terminal echoing back what
// was just pushed to it — stored, but not passed on again, so two terminals
// can never bounce one template between themselves.
const ECHO_WINDOW_MS = 5 * 60 * 1000;

// Scanners only display Latin letters, so they get the English name; the Lao
// name stays the fallback for someone not given one yet.
function deviceNameFor(employee) {
  return employee.nameEn || [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.employeeCode || '';
}

function templateKey(t) {
  return { pin: t.pin, type: t.type, no: t.no ?? 0, index: t.index ?? 0, majorVer: t.majorVer ?? null };
}

function templateKeyString(t) {
  const k = templateKey(t);
  return `${k.pin}|${k.type}|${k.no}|${k.index}|${k.majorVer}`;
}

async function syncTargets(excludeSerial) {
  const devices = await Device.find({ syncEnabled: true, ...APPROVED_DEVICE_FILTER });
  return excludeSerial ? devices.filter((d) => d.serialNumber !== excludeSerial) : devices;
}

// The commands that give one terminal this employee's user record plus every
// template of theirs it can actually use. The user comes first: a terminal
// only accepts a template for a PIN it already has.
function commandsForEmployee(device, employee, templates) {
  const pin = employee.deviceUserId;
  const context = { pin, employeeId: employee._id };
  const entries = [{ command: buildUserInfoCommand({ pin, name: deviceNameFor(employee) }), ...context }];
  for (const template of templates) {
    if (canReceiveTemplate(device.info, template)) entries.push({ command: buildBiodataCommand(template), ...context });
  }
  return entries;
}

async function pushEmployeeToDevices(employee, { devices } = {}) {
  if (!employee?.deviceUserId || employee.status !== 'active') return 0;
  const targets = (devices ?? (await syncTargets())).filter((device) => allowsScanner(employee, device.serialNumber));
  if (!targets.length) return 0;
  const templates = await BiometricTemplate.find({ pin: employee.deviceUserId }).select('+tmp');
  let queued = 0;
  for (const device of targets) {
    // eslint-disable-next-line no-await-in-loop
    queued += (await queueCommandsForDevice(device, commandsForEmployee(device, employee, templates))).length;
  }
  return queued;
}

// Everyone active, onto one terminal — used when a terminal is first switched
// to sync (or replaced) so it starts out holding the same people as the rest.
async function provisionDevice(device) {
  const employees = (await Employee.find({ status: 'active', deviceUserId: { $nin: [null, ''] } })).filter((e) =>
    allowsScanner(e, device.serialNumber)
  );
  const templates = await BiometricTemplate.find({ pin: { $in: employees.map((e) => e.deviceUserId) } }).select('+tmp');
  const templatesByPin = new Map();
  for (const t of templates) {
    if (!templatesByPin.has(t.pin)) templatesByPin.set(t.pin, []);
    templatesByPin.get(t.pin).push(t);
  }
  const entries = employees.flatMap((e) => commandsForEmployee(device, e, templatesByPin.get(e.deviceUserId) ?? []));
  const queued = await queueCommandsForDevice(device, entries);
  return { employees: employees.length, queued: queued.length };
}

// Stores templates a terminal uploaded and passes the new or changed ones on
// to the other sync-enabled terminals running the same algorithm. Done in bulk:
// a terminal's first upload can be its whole database at once. Returns how many
// templates were new or changed.
async function ingestTemplates(serialNumber, templates) {
  if (!templates.length) return 0;
  const pins = [...new Set(templates.map((t) => t.pin))];
  const existing = await BiometricTemplate.find({ pin: { $in: pins } }, 'pin type no index majorVer hash sourceSerial updatedAt');
  const existingByKey = new Map(existing.map((e) => [templateKeyString(e), e]));

  const changed = [];
  const seen = new Set();
  for (const t of templates) {
    const keyString = templateKeyString(t);
    const hash = hashText(t.tmp);
    if (seen.has(keyString) || existingByKey.get(keyString)?.hash === hash) continue;
    seen.add(keyString);
    changed.push({ template: { ...t, ...templateKey(t) }, hash, previous: existingByKey.get(keyString) });
  }
  if (!changed.length) return 0;

  await BiometricTemplate.bulkWrite(
    changed.map(({ template, hash }) => ({
      updateOne: {
        filter: templateKey(template),
        update: { $set: { ...template, hash, sourceSerial: serialNumber } },
        upsert: true,
      },
    }))
  );

  const now = Date.now();
  const toPass = changed.filter(
    ({ previous }) =>
      !(previous && previous.sourceSerial !== serialNumber && now - new Date(previous.updatedAt).getTime() < ECHO_WINDOW_MS)
  );
  const targets = toPass.length ? await syncTargets(serialNumber) : [];
  if (!targets.length) return changed.length;

  const employees = await Employee.find({ deviceUserId: { $in: toPass.map((c) => c.template.pin) }, status: 'active' });
  const employeeByPin = new Map(employees.map((e) => [e.deviceUserId, e]));
  for (const device of targets) {
    const entries = [];
    for (const { template } of toPass) {
      const employee = employeeByPin.get(template.pin);
      if (!employee || !allowsScanner(employee, device.serialNumber) || !canReceiveTemplate(device.info, template)) continue;
      const context = { pin: template.pin, employeeId: employee._id };
      entries.push({ command: buildUserInfoCommand({ pin: template.pin, name: deviceNameFor(employee) }), ...context });
      entries.push({ command: buildBiodataCommand(template), ...context });
    }
    // eslint-disable-next-line no-await-in-loop
    if (entries.length) await queueCommandsForDevice(device, entries);
  }
  return changed.length;
}

// Biometric data doesn't outlive the enrollment it came from — called
// wherever an employee's PIN is removed from the scanners.
async function removeStoredTemplates(pin) {
  if (!pin) return 0;
  const result = await BiometricTemplate.deleteMany({ pin });
  return result.deletedCount ?? 0;
}

// A changed PIN keeps the same person's templates: they move to the new PIN
// rather than being thrown away (one already stored under the new PIN with the
// same key wins).
async function moveStoredTemplates(oldPin, newPin) {
  if (!oldPin || !newPin || oldPin === newPin) return;
  const templates = await BiometricTemplate.find({ pin: oldPin });
  for (const t of templates) {
    // eslint-disable-next-line no-await-in-loop
    const taken = await BiometricTemplate.exists(templateKey({ ...t.toObject(), pin: newPin }));
    // eslint-disable-next-line no-await-in-loop
    if (!taken) await BiometricTemplate.updateOne({ _id: t._id }, { pin: newPin });
  }
  await BiometricTemplate.deleteMany({ pin: oldPin });
}

module.exports = {
  deviceNameFor,
  pushEmployeeToDevices,
  provisionDevice,
  ingestTemplates,
  removeStoredTemplates,
  moveStoredTemplates,
};
