const express = require('express');
const DeviceEnrolledUser = require('../models/DeviceEnrolledUser');
const Employee = require('../models/Employee');
const { authenticate, requireRole } = require('../middleware/auth');
const { queueQueryUsersCommand, queueDeletePinCommand } = require('../utils/deviceCommands');

const router = express.Router();

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
        lastSeenAt: e.lastSeenAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Asks every known device to re-report its enrolled-user list (see
// utils/deviceCommands.js / routes/adms.js's BIODATA handling) — the "ດຶງ"
// button. Delivery/response isn't synchronous with this request: the device
// answers whenever it next polls GET /iclock/getrequest, so this just
// confirms the request was queued, not that fresh data has arrived yet.
router.post('/pull', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const queued = await queueQueryUsersCommand();
    res.json({ queued: queued.length });
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
