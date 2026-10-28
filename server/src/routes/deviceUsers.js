const express = require('express');
const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');
const DeviceEnrolledUser = require('../models/DeviceEnrolledUser');
const BiometricTemplate = require('../models/BiometricTemplate');
const Employee = require('../models/Employee');
const { authenticate, requireRole } = require('../middleware/auth');
const { queueQueryUsersCommand, queueDeletePinCommand, queueQueryAttLogCommand } = require('../utils/deviceCommands');
const { provisionDevice, pushEmployeeToDevices } = require('../utils/deviceSync');
const { BIO_TYPE } = require('../utils/zkProtocol');
const { isApprovedDevice } = require('../utils/deviceApproval');

const router = express.Router();

// Longest period one "re-send attendance" request may cover — a terminal
// answers with every record in it, in one upload.
const MAX_ATTLOG_PULL_DAYS = 62;

async function findDevice(serial) {
  if (typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(serial)) return null;
  return Device.findOne({ serialNumber: serial });
}

// Every terminal that has talked to us, with what it reports about itself,
// whether it's actually picking up commands, and how its queue is doing —
// the ເຄື່ອງສະແກນ page.
router.get('/devices', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const [devices, commandCounts, templateCounts, enrolledCounts] = await Promise.all([
      Device.find().sort({ serialNumber: 1 }),
      DeviceCommand.aggregate([{ $group: { _id: { sn: '$serialNumber', status: '$status' }, n: { $sum: 1 } } }]),
      BiometricTemplate.aggregate([{ $group: { _id: { sn: '$sourceSerial', type: '$type' }, n: { $sum: 1 } } }]),
      DeviceEnrolledUser.aggregate([{ $group: { _id: '$serialNumber', n: { $sum: 1 } } }]),
    ]);
    const count = (rows, sn, key, value) => rows.find((r) => r._id.sn === sn && r._id[key] === value)?.n ?? 0;
    res.json(
      devices.map((d) => ({
        serialNumber: d.serialNumber,
        approved: isApprovedDevice(d),
        blockedUploadAt: d.blockedUploadAt,
        info: d.info ?? {},
        infoUpdatedAt: d.infoUpdatedAt,
        syncEnabled: !!d.syncEnabled,
        lastSeenAt: d.lastSeenAt,
        lastGetRequestAt: d.lastGetRequestAt,
        lastUnknownRequest: d.lastUnknownRequest?.path
          ? { method: d.lastUnknownRequest.method, path: d.lastUnknownRequest.path, receivedAt: d.lastUnknownRequest.receivedAt }
          : null,
        commands: {
          pending: count(commandCounts, d.serialNumber, 'status', 'pending'),
          sent: count(commandCounts, d.serialNumber, 'status', 'sent'),
          acked: count(commandCounts, d.serialNumber, 'status', 'acked'),
          failed: count(commandCounts, d.serialNumber, 'status', 'failed'),
        },
        storedTemplates: {
          fingerprint: count(templateCounts, d.serialNumber, 'type', BIO_TYPE.FINGERPRINT),
          face: count(templateCounts, d.serialNumber, 'type', BIO_TYPE.FACE_VISIBLE),
        },
        enrolledPins: enrolledCounts.find((r) => r._id === d.serialNumber)?.n ?? 0,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Approving a terminal (models/Device.js `approved`) lets what it sends in;
// blocking one again also switches its sync off. Switching sync on can
// provision the terminal in the same step (everyone active, plus every
// template it can use) — the page asks for that when the switch is turned on.
router.patch('/devices/:serial', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const device = await findDevice(req.params.serial);
    if (!device) return res.status(404).json({ message: 'Not found' });
    const { approved, syncEnabled } = req.body;
    if (approved === undefined && syncEnabled === undefined) return res.status(400).json({ message: 'ບໍ່ມີຫຍັງໃຫ້ປ່ຽນ' });
    if (approved !== undefined && typeof approved !== 'boolean') return res.status(400).json({ message: 'approved ຕ້ອງເປັນ true/false' });
    if (syncEnabled !== undefined && typeof syncEnabled !== 'boolean') return res.status(400).json({ message: 'syncEnabled ຕ້ອງເປັນ true/false' });
    if (approved !== undefined) {
      device.approved = approved;
      if (!approved) device.syncEnabled = false;
    }
    if (syncEnabled !== undefined) {
      if (syncEnabled && !isApprovedDevice(device)) return res.status(400).json({ message: 'ອະນຸມັດເຄື່ອງນີ້ກ່ອນ' });
      device.syncEnabled = syncEnabled;
    }
    await device.save();
    const provisioned = device.syncEnabled && syncEnabled && req.body.provision ? await provisionDevice(device) : null;
    res.json({ serialNumber: device.serialNumber, approved: isApprovedDevice(device), syncEnabled: device.syncEnabled, provisioned });
  } catch (err) {
    next(err);
  }
});

router.post('/devices/:serial/provision', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const device = await findDevice(req.params.serial);
    if (!device) return res.status(404).json({ message: 'Not found' });
    if (!isApprovedDevice(device)) return res.status(400).json({ message: 'ອະນຸມັດເຄື່ອງນີ້ກ່ອນ' });
    if (!device.syncEnabled) return res.status(400).json({ message: 'ເປີດ "ຊິງຂໍ້ມູນ" ຂອງເຄື່ອງນີ້ກ່ອນ' });
    res.json(await provisionDevice(device));
  } catch (err) {
    next(err);
  }
});

// Asks one terminal to re-send its attendance records for a period — for
// scans that never arrived (e.g. the relay PC was off longer than the
// terminal kept retrying). Duplicates of what's already stored are skipped.
router.post('/devices/:serial/pull-attlog', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const device = await findDevice(req.params.serial);
    if (!device) return res.status(404).json({ message: 'Not found' });
    if (!isApprovedDevice(device)) return res.status(400).json({ message: 'ອະນຸມັດເຄື່ອງນີ້ກ່ອນ' });
    const { start, end } = req.body;
    const valid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
    if (!valid(start) || !valid(end) || start > end) {
      return res.status(400).json({ message: 'ກະລຸນາເລືອກຊ່ວງວັນທີໃຫ້ຖືກຕ້ອງ' });
    }
    const days = Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 864e5) + 1;
    if (days > MAX_ATTLOG_PULL_DAYS) {
      return res.status(400).json({ message: `ເລືອກໄດ້ສູງສຸດ ${MAX_ATTLOG_PULL_DAYS} ວັນຕໍ່ຄັ້ງ` });
    }
    const queued = await queueQueryAttLogCommand(device.serialNumber, `${start} 00:00:00`, `${end} 23:59:59`);
    res.json({ queued: queued.length });
  } catch (err) {
    next(err);
  }
});

// One employee's place on the scanners: which terminals report the PIN as
// enrolled, which fingerprint/face templates are stored (never the template
// data itself), and how many commands for them are still waiting.
router.get('/employee/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id, 'deviceUserId status');
    if (!employee) return res.status(404).json({ message: 'Not found' });
    const pin = employee.deviceUserId;
    if (!pin) return res.json({ pin: null, devices: [], templates: [], pendingCommands: 0 });
    const [devices, enrolled, templates, pendingCommands] = await Promise.all([
      Device.find({}, 'serialNumber info.deviceName syncEnabled lastSeenAt').sort({ serialNumber: 1 }),
      DeviceEnrolledUser.find({ pin }),
      BiometricTemplate.find({ pin }, 'type no majorVer sourceSerial updatedAt').sort({ type: 1, no: 1 }),
      DeviceCommand.countDocuments({ deviceUserId: pin, status: 'pending' }),
    ]);
    res.json({
      pin,
      devices: devices.map((d) => {
        const row = enrolled.find((e) => e.serialNumber === d.serialNumber);
        return {
          serialNumber: d.serialNumber,
          deviceName: d.info?.deviceName,
          syncEnabled: !!d.syncEnabled,
          enrolled: !!row,
          nameOnDevice: row?.name,
          reportedAt: row?.lastSeenAt,
        };
      }),
      templates: templates.map((t) => ({
        type: t.type,
        no: t.no,
        majorVer: t.majorVer,
        sourceSerial: t.sourceSerial,
        updatedAt: t.updatedAt,
      })),
      pendingCommands,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/employee/:id/push', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Not found' });
    if (!employee.deviceUserId) return res.status(400).json({ message: 'ພະນັກງານຄົນນີ້ຍັງບໍ່ມີລະຫັດເຄື່ອງສະແກນ' });
    if (employee.status !== 'active') return res.status(400).json({ message: 'ສົ່ງໄດ້ສະເພາະພະນັກງານທີ່ສະຖານະ "ໃຊ້ງານ"' });
    res.json({ queued: await pushEmployeeToDevices(employee) });
  } catch (err) {
    next(err);
  }
});

// PINs a scanner reports as enrolled that match no Employee at all (status
// doesn't matter — even a resigned/inactive employee still "exists" here;
// this is only for PINs with nothing behind them at all: someone long
// deleted from the system, a prior test enrollment, etc.) — grouped by
// serial so ຕາຕະລາງວັນພັກ's "ລາຍການ ID" page can label each by device.
router.get('/orphaned', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const [enrolled, employees] = await Promise.all([
      DeviceEnrolledUser.find().sort({ serialNumber: 1, pin: 1 }),
      Employee.find({}, 'deviceUserId'),
    ]);
    const knownPins = new Set(employees.map((e) => e.deviceUserId).filter(Boolean));
    const orphaned = enrolled.filter((e) => !knownPins.has(e.pin));
    res.json(
      orphaned.map((e) => ({
        id: e._id,
        serialNumber: e.serialNumber,
        pin: e.pin,
        name: e.name,
        lastSeenAt: e.lastSeenAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Asks every known device to re-report its enrolled users and their
// fingerprint/face templates (see utils/deviceCommands.js / routes/adms.js)
// — the "ດຶງ" button. Delivery/response isn't synchronous with this request:
// the device answers whenever it next polls GET /iclock/getrequest, so this
// just confirms the request was queued, not that fresh data has arrived yet.
router.post('/pull', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const queued = await queueQueryUsersCommand();
    res.json({ queued: new Set(queued.map((c) => c.serialNumber)).size });
  } catch (err) {
    next(err);
  }
});

// Deletes one orphaned PIN from the one device it was reported on — the
// "ລຶບ" button per row. Removed from our own registry right away (optimistic
// — if the device-side delete somehow fails, the next successful "ດຶງ" would
// just report it again).
router.post('/:id/delete', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const record = await DeviceEnrolledUser.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Not found' });
    await queueDeletePinCommand(record.pin, record.serialNumber);
    await DeviceEnrolledUser.deleteOne({ _id: record._id });
    res.json({ id: record._id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
