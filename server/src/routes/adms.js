const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const Device = require('../models/Device');
const { recomputeDay, toDateKey } = require('../utils/attendanceProcessor');

// ZKTeco's "push" (ADMS) protocol. Real terminals are configured with this
// server's URL and hit these fixed paths on their own — no Authorization
// header (the device can't be given a JWT), so this router is intentionally
// unauthenticated. Bodies are tab-separated plaintext, not JSON.
//   GET  /iclock/cdata?SN=<serial>&options=all   device handshake / config pull
//   POST /iclock/cdata?SN=<serial>&table=ATTLOG  attendance punches (body: one per line)
//   GET  /iclock/getrequest?SN=<serial>           device polls for pending commands
const router = express.Router();

async function findOrTouchDevice(serialNumber) {
  const device = await Device.findOneAndUpdate(
    { serialNumber },
    { $setOnInsert: { attStamp: 0, opStamp: 0 }, $set: { lastSeenAt: new Date() } },
    { upsert: true, new: true }
  );
  return device;
}

// Mirrors routes/attendanceActions.js's heuristic so both ingestion paths
// (simulator + real terminal) agree on in/out — device Status codes aren't
// reliable enough across firmware/models to trust directly.
async function inferType(employeeId, timestamp) {
  const dateKey = toDateKey(timestamp);
  const start = new Date(`${dateKey}T00:00:00`);
  const last = await AttendanceLog.findOne({
    employee: employeeId,
    timestamp: { $gte: start, $lt: timestamp },
  }).sort('-timestamp');
  return last && last.type === 'in' ? 'out' : 'in';
}

// Each line: "PIN\tDateTime\tStatus\tVerifyType\tWorkCode\t..." — one punch
// per line. DateTime is "YYYY-MM-DD HH:mm:ss" in the terminal's local time.
function parseAttLog(body) {
  return (body || '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      return { pin: (fields[0] || '').trim(), dateTime: (fields[1] || '').trim(), raw: line };
    })
    .filter((row) => row.pin && row.dateTime);
}

router.get('/iclock/cdata', async (req, res, next) => {
  try {
    const { SN, options } = req.query;
    if (!SN) return res.type('text/plain').send('ERROR');
    const device = await findOrTouchDevice(SN);

    if (options === 'all') {
      const lines = [
        `GET OPTION FROM: ${SN}`,
        `Stamp=${device.attStamp}`,
        `OpStamp=${device.opStamp}`,
        'ErrorDelay=60',
        'Delay=30',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        'TransFlag=TransData AttLog OpLog AttPhoto',
        'Realtime=1',
        'Encrypt=0',
      ];
      return res.type('text/plain').send(lines.join('\n'));
    }

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

router.post('/iclock/cdata', express.text({ type: '*/*' }), async (req, res, next) => {
  try {
    const { SN, table, Stamp } = req.query;
    if (!SN || !table) return res.type('text/plain').send('ERROR');
    const device = await findOrTouchDevice(SN);

    if (table.toUpperCase() === 'ATTLOG') {
      const rows = parseAttLog(req.body);
      const affected = new Map();

      for (const row of rows) {
        const timestamp = new Date(row.dateTime.replace(' ', 'T'));
        if (Number.isNaN(timestamp.getTime())) continue;

        const employee = await Employee.findOne({ deviceUserId: row.pin });
        const type = employee ? await inferType(employee._id, timestamp) : 'auto';

        // Upsert on (device, pin, timestamp) so a re-sent/duplicate punch (the
        // terminal retries if it never saw our "OK") doesn't create a second
        // log row or double-count worked hours.
        await AttendanceLog.findOneAndUpdate(
          { deviceId: SN, deviceUserId: row.pin, timestamp },
          {
            employee: employee ? employee._id : undefined,
            deviceUserId: row.pin,
            deviceId: SN,
            timestamp,
            type,
            raw: { line: row.raw },
          },
          { upsert: true, setDefaultsOnInsert: true }
        );

        if (employee) affected.set(`${employee._id}|${toDateKey(timestamp)}`, true);
      }

      for (const key of affected.keys()) {
        const [employeeId, dateKey] = key.split('|');
        await recomputeDay(employeeId, dateKey);
      }

      if (Stamp) {
        await Device.updateOne({ serialNumber: SN }, { attStamp: Math.max(device.attStamp, Number(Stamp) || 0) });
      }
    }

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

router.get('/iclock/getrequest', (req, res) => {
  // No pending device commands (e.g. "enroll new user") to push right now.
  res.type('text/plain').send('OK');
});

module.exports = router;
