const express = require('express');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');
const DeviceEnrolledUser = require('../models/DeviceEnrolledUser');
const { recomputeDay, dayRange, resolveShiftDateKey } = require('../utils/attendanceProcessor');
const { splitLines, parseRecordLine, userFromRecord, templateFromRecord, parseDeviceOptions } = require('../utils/zkProtocol');
const { ingestTemplates } = require('../utils/deviceSync');
const { isApprovedDevice, NEW_DEVICE_DEFAULTS } = require('../utils/deviceApproval');

// ZKTeco's "push" (ADMS) protocol. Real terminals are configured with this
// server's URL and hit these fixed paths on their own — no Authorization
// header (the device can't be given a JWT), so this router is intentionally
// unauthenticated — instead, a serial number seen for the first time has to be
// approved on ເຄື່ອງສະແກນ before anything it sends is taken (models/Device.js
// `approved`). Bodies are tab-separated plaintext, not JSON.
//   GET  /iclock/cdata?SN=<serial>&options=all   device handshake / config pull
//   POST /iclock/cdata?SN=<serial>&table=ATTLOG  attendance punches (body: one per line)
//   POST /iclock/cdata?SN=<serial>&table=BIODATA users / fingerprint & face templates
//   GET  /iclock/getrequest?SN=<serial>           device polls for pending commands
//   POST /iclock/devicecmd?SN=<serial>            device reports a command's result
//   POST /iclock/querydata?SN=<serial>            newer firmware's reply to a DATA QUERY
//
// Commands we queue (utils/deviceCommands.js, utils/deviceSync.js): delete a
// PIN, report who's enrolled, re-send attendance for a period, and — for
// terminals with sync switched on — add/update a user and push a fingerprint
// or face template so someone enrolled on one terminal works on the others.
// getrequest below delivers whatever's queued and devicecmd records whether
// the terminal actually ran it.
//
// Why this matters for "scans go missing when the network drops": the terminal keeps
// every punch in local flash until this endpoint acknowledges it with a plain-text
// "OK". If the network is down, or this endpoint errors, or it replies with anything
// other than "OK", the device keeps the record queued and retries on its next poll —
// so a device that catches up after an outage re-sends its whole unacknowledged
// backlog in one batch. Ingestion below is upsert-based (keyed on device + PIN +
// timestamp) so a resend — or a firmware retry that never saw our "OK" — never
// creates a duplicate punch.
//
// NOTE: implemented against the documented ADMS wire format but not yet against a
// physical terminal — run one real device against it before relying on this broadly.
// That caveat applies doubly to the command-push pair above (getrequest/devicecmd):
// the exact command syntax and ack body shape are known to vary across ZKTeco
// firmware versions, so confirm "DATA DELETE USERINFO" actually removes the
// enrollment on your specific hardware before trusting it to work unattended.
const router = express.Router();

// How much one getrequest poll hands out (see there).
const MAX_COMMANDS_PER_POLL = 16;
const MAX_POLL_BYTES = 48 * 1024;

// This endpoint is unauthenticated by necessity (see above), so `SN`/`table`
// can't be trusted the way an authenticated route's inputs can be. Express's
// query parser turns bracketed query strings (`?SN[$ne]=null`) into objects,
// which — if ever handed straight to a Mongoose filter — stop meaning "this
// literal value" and start meaning "any document where this field is not
// null", matching/touching a real device's row instead of a nonexistent one
// with a guessed/fake serial. A real ZKTeco SN is always a short alphanumeric
// string, so reject anything else outright rather than cast-and-hope.
function parseSerial(value) {
  const sn = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9_-]{1,40}$/.test(sn) ? sn : null;
}

// A serial number seen for the first time is registered as not approved —
// see models/Device.js `approved`.
async function findOrTouchDevice(serialNumber) {
  const device = await Device.findOneAndUpdate(
    { serialNumber },
    { $setOnInsert: NEW_DEVICE_DEFAULTS, $set: { lastSeenAt: new Date() } },
    { upsert: true, new: true }
  );
  return device;
}

// Punches and templates from a terminal nobody has approved yet are refused,
// not stored. Anything but "OK" makes the terminal keep them and retry, so a
// real new scanner loses nothing: its backlog arrives once it's approved.
async function refuseUnapproved(device, res) {
  await Device.updateOne({ _id: device._id }, { blockedUploadAt: new Date() });
  return res.type('text/plain').send('ERROR');
}

// Mirrors routes/attendanceActions.js's heuristic so both ingestion paths
// (simulator + real terminal) agree on in/out — device Status codes aren't
// reliable enough across firmware/models to trust directly. Looks back to the
// resolved shift-day's start (not just today's midnight) so an overnight
// shift's early-morning punch still alternates against last night's punch.
async function inferType(employeeId, timestamp) {
  const shiftDateKey = await resolveShiftDateKey(employeeId, timestamp);
  const { start } = dayRange(shiftDateKey);
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

// A real MB10 answers "DATA QUERY USERINFO" inconsistently — sometimes
// table=BIODATA ("BIODATA Pin=10308\tNo=0\t...\tTmp=<base64>", one biometric
// template per line), sometimes table=OPERLOG ("USER PIN=10179\tName=Mr
// Aek\t...", one enrolled user per line, same request, same device). Case
// differs too (Pin= vs PIN=). Only the PIN matters for this list, so this
// just scans every line for "pin=" case-insensitively rather than trying to
// match either format's exact shape — works for both, and for whatever
// other casing/table name shows up next.
function parsePinsFromUpload(body) {
  return (body || '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/pin=(\S+)/i))
    .filter(Boolean)
    .map((match) => match[1]);
}

// Tables whose lines are user records and fingerprint/face templates.
const RECORD_TABLES = ['BIODATA', 'OPERLOG', 'USERINFO', 'USER', 'FINGERTMP', 'TEMPLATEV10', 'FACE'];

// Users and templates a terminal uploads — its answer to a "DATA QUERY …", or
// (with the TransFlag sent at handshake) whatever was just enrolled on it.
// Every PIN mentioned refreshes "who's enrolled here" (DeviceEnrolledUser);
// templates are stored and passed on to the other sync-enabled terminals
// (utils/deviceSync.js). Both in bulk: a first upload can be the terminal's
// whole user database in one request.
async function ingestRecordUpload(device, body) {
  const names = new Map();
  const templates = [];
  for (const line of splitLines(body)) {
    const record = parseRecordLine(line);
    const user = userFromRecord(record);
    if (user) names.set(user.pin, user.name ?? names.get(user.pin));
    const template = templateFromRecord(record, device.info ?? {});
    if (template) {
      templates.push(template);
      if (!names.has(template.pin)) names.set(template.pin, undefined);
    }
  }
  // Catches a PIN on any line shape not recognized above.
  for (const pin of parsePinsFromUpload(body)) {
    if (!names.has(pin)) names.set(pin, undefined);
  }
  const now = new Date();
  if (names.size) {
    await DeviceEnrolledUser.bulkWrite(
      [...names].map(([pin, name]) => ({
        updateOne: {
          filter: { serialNumber: device.serialNumber, pin },
          update: { $set: name ? { lastSeenAt: now, name } : { lastSeenAt: now } },
          upsert: true,
        },
      }))
    );
  }
  const changedTemplates = await ingestTemplates(device.serialNumber, templates);
  return { pins: names.size, templates: templates.length, changedTemplates };
}

// For keeping an unrecognized upload around to look at later — with any
// template/photo payload blanked out (biometric data stays out of debug
// fields) and capped in size.
function redactUpload(body) {
  return (body || '').replace(/\b(tmp|template|content)=[^\t\r\n]*/gi, '$1=<removed>').slice(0, 4000);
}

router.get('/iclock/cdata', async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    const { options } = req.query;
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
        // EnrollUser…FACE: upload a user or fingerprint/face template as soon
        // as it's enrolled or changed on the terminal, so it can be pushed on
        // to the other terminals (utils/deviceSync.js).
        'TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP FACE',
        // Template types this server accepts: 1 fingerprint, 9 visible-light face.
        'MultiBioDataSupport=0:1:0:0:0:0:0:0:0:1',
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

// Default body-parser limit (100kb) is too small for a real terminal's
// uploads — a BIODATA (biometric template) batch alone was observed at
// ~170kb from a single MB10, well past that default. Every failed parse
// trips PayloadTooLargeError before the handler (and so before
// findOrTouchDevice) ever runs, which is why a device stuck like this never
// even shows up as having contacted the server at all — it just retries the
// same oversized batch forever, silently from this server's point of view.
router.post('/iclock/cdata', express.text({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    const table = typeof req.query.table === 'string' ? req.query.table : '';
    const Stamp = typeof req.query.Stamp === 'string' ? req.query.Stamp : '';
    if (!SN || !table) return res.type('text/plain').send('ERROR');
    const device = await findOrTouchDevice(SN);
    const isDataUpload = table.toUpperCase() === 'ATTLOG' || RECORD_TABLES.includes(table.toUpperCase());
    if (isDataUpload && !isApprovedDevice(device)) {
      console.log(`[adms] SN=${SN} ${table} upload refused — this scanner isn't approved yet`);
      return refuseUnapproved(device, res);
    }

    if (table.toUpperCase() === 'ATTLOG') {
      const rows = parseAttLog(req.body);
      const affected = new Map();
      let stored = 0;
      let unmatched = 0;

      for (const row of rows) {
        const timestamp = new Date(row.dateTime.replace(' ', 'T'));
        if (Number.isNaN(timestamp.getTime())) continue;

        const employee = await Employee.findOne({ deviceUserId: row.pin });
        if (!employee) unmatched += 1;
        const type = employee ? await inferType(employee._id, timestamp) : 'auto';

        // Upsert on (device, pin, timestamp) so a re-sent/duplicate punch (the
        // terminal retries if it never saw our "OK") doesn't create a second
        // log row or double-count worked hours. Checked for existence first
        // (rather than inspecting the upsert's result metadata, whose shape
        // isn't stable across mongoose/driver versions) purely so the log
        // line below can distinguish a genuinely new punch from a resend.
        const existed = await AttendanceLog.exists({ deviceId: SN, deviceUserId: row.pin, timestamp });
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
        if (!existed) stored += 1;

        if (employee) affected.set(`${employee._id}|${await resolveShiftDateKey(employee._id, timestamp)}`, true);
      }

      for (const key of affected.keys()) {
        const [employeeId, dateKey] = key.split('|');
        await recomputeDay(employeeId, dateKey);
      }

      if (Stamp) {
        await Device.updateOne({ serialNumber: SN }, { attStamp: Math.max(device.attStamp, Number(Stamp) || 0) });
      }

      console.log(`[adms] SN=${SN} ATTLOG batch: ${rows.length} lines, ${stored} new punches stored, ${unmatched} with no matching employee`);
    } else if (RECORD_TABLES.includes(table.toUpperCase())) {
      // Users and templates — the reply to a queued "DATA QUERY USERINFO" /
      // "DATA QUERY BIODATA" (a real MB10 answers as either BIODATA or
      // OPERLOG depending on the moment), or a fresh enrollment uploaded on
      // its own. Upserted per (device, pin) rather than appended, so this
      // stays "who's enrolled right now" instead of growing forever.
      const result = await ingestRecordUpload(device, req.body);
      if (Stamp) {
        await Device.updateOne({ serialNumber: SN }, { opStamp: Math.max(device.opStamp, Number(Stamp) || 0) });
      }
      console.log(
        `[adms] SN=${SN} ${table} batch: ${result.pins} PIN(s), ${result.templates} template(s) (${result.changedTemplates} new/changed)`
      );
    } else if (table.toLowerCase() === 'options') {
      // What the terminal reports about itself — model, firmware, algorithm
      // versions, capacity — which decides which templates it can be sent.
      await Device.updateOne(
        { serialNumber: SN },
        {
          info: parseDeviceOptions(req.body),
          infoUpdatedAt: new Date(),
          lastNonAttlogUpload: { table, body: redactUpload(req.body), receivedAt: new Date() },
        }
      );
      console.log(`[adms] SN=${SN} options upload — device info updated`);
    } else {
      // Captured for later inspection (see Device.lastNonAttlogUpload) rather
      // than just logged — the exact table name/format a device uses for
      // anything else isn't documented consistently enough to assume without
      // seeing a real one.
      console.log(`[adms] SN=${SN} non-ATTLOG upload table=${table} (${(req.body || '').length} bytes) — saved to Device.lastNonAttlogUpload`);
      await Device.updateOne({ serialNumber: SN }, { lastNonAttlogUpload: { table, body: redactUpload(req.body), receivedAt: new Date() } });
    }

    res.type('text/plain').send('OK');
  } catch (err) {
    // Not responding "OK" here is deliberate — that's what makes the device keep this
    // batch queued and retry it later, which is exactly what we want if something went
    // wrong on our end (e.g. a transient DB hiccup) rather than the data being bad.
    next(err);
  }
});

// A lightweight keepalive some terminals send between full /iclock/cdata
// handshakes — observed hitting this path and getting a plain 404 since
// nothing handled it. Not documented anywhere I could find, so this just
// acknowledges it rather than guessing at a richer response.
router.get('/iclock/ping', (req, res) => {
  res.type('text/plain').send('OK');
});

router.get('/iclock/getrequest', async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    if (!SN) return res.type('text/plain').send('OK');
    const device = await Device.findOneAndUpdate(
      { serialNumber: SN },
      { $setOnInsert: NEW_DEVICE_DEFAULTS, $set: { lastGetRequestAt: new Date() } },
      { upsert: true, new: true }
    );
    // Nothing is queued for an unapproved terminal anyway — this just makes
    // sure one never receives a command (user records, templates).
    if (!isApprovedDevice(device)) return res.type('text/plain').send('OK');

    const pending = await DeviceCommand.find({ serialNumber: SN, status: 'pending' }).sort('cmdId').limit(MAX_COMMANDS_PER_POLL);
    if (!pending.length) return res.type('text/plain').send('OK');

    // ADMS format: one "C:<cmdId>:<command>" per line. Marked 'sent' (not
    // 'acked') here — POST /iclock/devicecmd below is what actually confirms
    // the terminal executed it; a command that's sent but never acked (lost
    // reply, device rebooted mid-command) stays 'sent' rather than silently
    // looking done, so it's visible to whoever's checking the queue later.
    // Handed out a few at a time: a terminal being provisioned can have
    // hundreds of multi-kilobyte template pushes waiting, more than it takes
    // in one reply — the rest go out on its next polls.
    const batch = [];
    let bytes = 0;
    for (const cmd of pending) {
      const line = `C:${cmd.cmdId}:${cmd.command}`;
      if (batch.length && bytes + line.length > MAX_POLL_BYTES) break;
      batch.push({ cmd, line });
      bytes += line.length + 1;
    }
    await DeviceCommand.updateMany({ _id: { $in: batch.map((b) => b.cmd._id) } }, { status: 'sent', sentAt: new Date() });
    res.type('text/plain').send(batch.map((b) => b.line).join('\n'));
  } catch (err) {
    next(err);
  }
});

// The terminal's result for a command it ran, sent some time after it polled
// getrequest above. Documented ADMS format is query-string-shaped fields in
// the body ("ID=<cmdId>&Return=<code>&CMD=<echoed command>"); some firmware
// sends one of these per line when multiple commands were run. Parsed
// leniently — this hasn't been run against a real terminal, so treat the
// exact shape as a best guess (see routes/adms.js's top-of-file note) and
// surface anything unparseable in the server log rather than silently
// dropping it.
router.post('/iclock/devicecmd', express.text({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    if (!SN) return res.type('text/plain').send('OK');

    const lines = (req.body || '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const params = new URLSearchParams(line);
      const id = params.get('ID');
      const returnCode = params.get('Return');
      if (!id) {
        console.log(`[adms] devicecmd from SN=${SN}: couldn't find an ID in "${line}"`);
        continue;
      }
      const cmdId = Number(id);
      // eslint-disable-next-line no-await-in-loop
      const updated = await DeviceCommand.findOneAndUpdate(
        { serialNumber: SN, cmdId },
        { status: returnCode === '0' ? 'acked' : 'failed', returnCode: returnCode ?? undefined, ackedAt: new Date() },
        { new: true }
      );
      if (!updated) console.log(`[adms] devicecmd from SN=${SN}: no queued command matches cmdId=${cmdId}`);
    }

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

// Newer firmware answers a "DATA QUERY …" here instead of with a
// /iclock/cdata upload (POST /iclock/querydata?SN=…&tablename=user&…). The
// lines are the same kind of user/template records, so they go through the
// same parsing.
router.post('/iclock/querydata', express.text({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    if (!SN) return res.type('text/plain').send('OK');
    const device = await findOrTouchDevice(SN);
    // Only ever the reply to a query this server sent, which an unapproved
    // terminal never gets — dropped rather than stored.
    if (!isApprovedDevice(device)) return res.type('text/plain').send('OK');
    const tablename = typeof req.query.tablename === 'string' ? req.query.tablename : '';
    const result = await ingestRecordUpload(device, req.body);
    if (!result.pins) {
      await Device.updateOne(
        { serialNumber: SN },
        { lastNonAttlogUpload: { table: `querydata:${tablename}`, body: redactUpload(req.body), receivedAt: new Date() } }
      );
    }
    console.log(`[adms] SN=${SN} querydata ${tablename}: ${result.pins} PIN(s), ${result.templates} template(s)`);
    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

// Anything else a terminal sends under /iclock/ — most likely one still in
// access-control push mode, which registers through paths this
// attendance-push router doesn't speak (/iclock/registry, /iclock/push …).
// Recorded on the device so the scanner page can show it.
router.all('/iclock/*', express.text({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const SN = parseSerial(req.query.SN);
    if (SN) {
      await Device.updateOne(
        { serialNumber: SN },
        {
          $setOnInsert: NEW_DEVICE_DEFAULTS,
          $set: {
            lastSeenAt: new Date(),
            lastUnknownRequest: {
              method: req.method,
              path: req.path,
              body: redactUpload(typeof req.body === 'string' ? req.body : ''),
              receivedAt: new Date(),
            },
          },
        },
        { upsert: true }
      );
    }
    console.log(`[adms] unrecognized ${req.method} ${req.path} from SN=${SN || '?'}`);
    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

// Must be registered after every route above — Express only routes an error to
// handlers declared later in the same chain. A JSON error body (the app-level
// default) isn't something the device's plaintext parser expects; replying in
// its own protocol keeps its retry behavior sane.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[adms] ingestion error, device will retry this batch:', err);
  res.status(500).type('text/plain').send('ERROR');
});

module.exports = router;
