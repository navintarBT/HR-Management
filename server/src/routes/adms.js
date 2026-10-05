const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const { recomputeDay, toDateKey, inferType } = require('../utils/attendanceProcessor');

// Real ZKTeco "ADMS" push protocol (the mode most current terminals — uFace, SpeedFace,
// iFace, MB-series — support out of the box). The device is configured with this
// server's URL and does the polling itself; nothing here is invoked by our own UI.
//
// Why this matters for "scans go missing when the network drops": these terminals keep
// every punch in local flash until THIS endpoint acknowledges it with a plain-text "OK".
// If the network is down, or this endpoint errors, or it replies with anything other
// than "OK", the device keeps the record queued and retries on its next poll — so the
// device already does its part. What was missing is that this endpoint never actually
// stored anything (it only logged to the console and always replied "OK"), so every
// punch was acknowledged and discarded whether or not the network had dropped.
//
// A device catching up after an outage re-sends its whole unacknowledged backlog in one
// batch, and firmware bugs/retries can occasionally resend a record we already have —
// ingestion below is upsert-based (keyed on device + device-user + timestamp) so that
// never creates a duplicate punch.
//
// NOTE: this has been implemented against the widely-documented ADMS wire format but not
// yet against a physical terminal. Before relying on it in production, run one real
// device against it (point its server URL here) and confirm its punches show up.

const router = express.Router();

function respondOk(res) {
  res.type('text/plain').send('OK');
}

// Device handshake / periodic check-in. Real firmware expects a config block back, not
// just "OK" — these are conservative defaults (poll every minute, upload attendance
// logs, no encryption) that make the device proceed to POST its data rather than stall.
router.get('/iclock/cdata', (req, res) => {
  const { SN } = req.query;
  console.log(`[adms] handshake from SN=${SN ?? 'unknown'}`);
  res.type('text/plain').send(
    ['GET OPTION FROM: ' + (SN ?? ''), 'Stamp=9999', 'OpStamp=9999', 'ErrorDelay=30', 'Delay=30', 'TransFlag=1111000000', 'Realtime=1', 'Encrypt=0'].join(
      '\r\n'
    )
  );
});

// Parses one ATTLOG line. Column order per the ADMS spec: PIN, timestamp, status,
// verify-method, work-code, then reserved/firmware-specific fields we don't need.
function parseAttLogLine(line) {
  const cols = line.split('\t').map((c) => c.trim());
  const [pin, dateTime] = cols;
  if (!pin || !dateTime) return null;
  const timestamp = new Date(dateTime.replace(' ', 'T'));
  if (Number.isNaN(timestamp.getTime())) return null;
  return { pin, timestamp, raw: cols };
}

router.post('/iclock/cdata', express.text({ type: '*/*', limit: '2mb' }), async (req, res, next) => {
  const { SN, table } = req.query;
  const deviceId = SN ? String(SN) : 'UNKNOWN-DEVICE';

  // Terminals also push OPERLOG/USERINFO/BIOPHOTO/etc during a full sync — we only
  // process attendance punches for now, but must still ack everything else with "OK"
  // or the device will treat it as failed and keep retrying it forever.
  if (table !== 'ATTLOG') {
    console.log(`[adms] ignoring table=${table ?? '(none)'} from SN=${deviceId} (${(req.body || '').length} bytes)`);
    return respondOk(res);
  }

  try {
    const lines = (req.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const affected = new Set(); // `${employeeId}|${dateKey}` — recompute each once, not per line
    let stored = 0;
    let unmatched = 0;

    for (const line of lines) {
      const parsed = parseAttLogLine(line);
      if (!parsed) {
        console.warn(`[adms] unparsable ATTLOG line from SN=${deviceId}:`, line);
        continue;
      }
      const { pin, timestamp, raw } = parsed;

      // eslint-disable-next-line no-await-in-loop
      const employee = await Employee.findOne({ deviceUserId: pin });
      if (!employee) unmatched += 1;

      // eslint-disable-next-line no-await-in-loop
      const type = employee ? await inferType(employee._id, timestamp) : 'auto';

      try {
        // Upsert on the natural device key so a re-sent backlog (post-outage, or a
        // firmware retry that never saw our "OK") never creates a duplicate punch.
        // eslint-disable-next-line no-await-in-loop
        const result = await AttendanceLog.updateOne(
          { deviceId, deviceUserId: pin, timestamp },
          { $setOnInsert: { employee: employee?._id, deviceId, deviceUserId: pin, timestamp, type, raw } },
          { upsert: true }
        );
        if (result.upsertedCount) stored += 1;
      } catch (err) {
        if (err.code !== 11000) throw err; // 11000 = duplicate key, i.e. we already had this exact punch
      }

      if (employee) affected.add(`${employee._id}|${toDateKey(timestamp)}`);
    }

    for (const key of affected) {
      const [employeeId, dateKey] = key.split('|');
      // eslint-disable-next-line no-await-in-loop
      await recomputeDay(employeeId, dateKey);
    }

    console.log(
      `[adms] SN=${deviceId} ATTLOG batch: ${lines.length} lines, ${stored} new punches stored, ${unmatched} with no matching employee`
    );
    respondOk(res);
  } catch (err) {
    // Not responding "OK" here is deliberate — that's what makes the device keep this
    // batch queued and retry it later, which is exactly what we want if something went
    // wrong on our end (e.g. a transient DB hiccup) rather than the data being bad.
    next(err);
  }
});

// Device polls for pending remote commands (reboot, resync users, etc.) — we don't
// issue any, so always "OK" (empty command queue).
router.get('/iclock/getrequest', (req, res) => {
  respondOk(res);
});

// Must be registered after every route above — Express only routes an error to
// handlers declared later in the same chain.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[adms] ingestion error, device will retry this batch:', err);
  res.status(500).type('text/plain').send('ERROR');
});

module.exports = router;
