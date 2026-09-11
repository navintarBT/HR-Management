const express = require('express');

// TODO: This is a stub for ZKTeco's real push protocol ("ADMS"). Real devices are
// configured with a server URL and periodically hit these endpoints with
// tab-separated plaintext (not JSON), e.g.:
//   GET  /iclock/cdata?SN=<serial>&options=all              (device handshake / config pull)
//   POST /iclock/cdata?SN=<serial>&table=ATTLOG              (body: "userId\ttimestamp\tstatus\t...\n" per line)
//   GET  /iclock/getrequest?SN=<serial>                      (device polls for pending commands)
// A production integration needs to: parse the SN to resolve which device sent data,
// parse ATTLOG lines into individual punches, upsert them as AttendanceLog documents
// (mapping the device's userId to Employee.deviceUserId), call recomputeDay for each
// affected employee/date, and reply "OK" in plaintext so the terminal doesn't retry.
// For this MVP we only log what arrives so the wiring point is visible in one place.
const router = express.Router();

router.get('/iclock/cdata', (req, res) => {
  console.log('[adms-stub] device handshake', req.query);
  res.type('text/plain').send('OK');
});

router.post('/iclock/cdata', express.text({ type: '*/*' }), (req, res) => {
  console.log('[adms-stub] device push', req.query, req.body);
  res.type('text/plain').send('OK');
});

router.get('/iclock/getrequest', (req, res) => {
  res.type('text/plain').send('OK');
});

module.exports = router;
