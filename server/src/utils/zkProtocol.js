const crypto = require('crypto');

// Pure helpers for ZKTeco's attendance push (ADMS) wire format: parsing what a
// terminal uploads and building the command strings queued for it. No
// database access here, so the formats can be checked in isolation.

// Template types as the protocol numbers them (BIODATA Type=).
const BIO_TYPE = { FINGERPRINT: 1, FACE_IR: 2, FACE_VISIBLE: 9 };
// Only these are ever pushed between terminals — anything else uploaded is
// kept but never synced.
const SYNCABLE_TYPES = [BIO_TYPE.FINGERPRINT, BIO_TYPE.FACE_VISIBLE];

// Terminals keep a short fixed-size user name.
const DEVICE_NAME_MAX_BYTES = 24;

const QUERY_USERS_COMMAND = 'DATA QUERY USERINFO';
const QUERY_TEMPLATES_COMMAND = 'DATA QUERY BIODATA';

function splitLines(body) {
  return (body || '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toInt(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// "Key=Value\tKey2=Value2" → fields, every key also lower-cased because
// firmware disagrees on case (Pin= vs PIN=). Only the first "=" splits, so a
// base64 value's "==" padding survives.
function parseFields(text) {
  const fields = {};
  for (const part of (text || '').split('\t')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    fields[key] = value;
    fields[key.toLowerCase()] = value;
  }
  return fields;
}

// One uploaded line → { tag, fields }. Covers the attendance push style
// ("USER PIN=…", "BIODATA Pin=…", "FP PIN=…") and the lower-case style some
// firmware answers queries with ("user pin=…", "templatev10 pin=…"). A bare
// "PIN=…\tName=…" line comes back with an empty tag.
function parseRecordLine(line) {
  const match = /^([A-Za-z][A-Za-z0-9]*)\s+(.*)$/.exec(line);
  if (match && match[2].includes('=')) {
    return { tag: match[1].toUpperCase(), fields: parseFields(match[2]) };
  }
  return { tag: '', fields: parseFields(line) };
}

function userFromRecord({ tag, fields }) {
  if (tag && tag !== 'USER' && tag !== 'USERINFO') return null;
  const pin = (fields.pin || '').trim();
  if (!pin) return null;
  const name = (fields.name || '').trim();
  return { pin, name: name || undefined };
}

// A fingerprint/face template line → the normalized shape BiometricTemplate
// stores. Older "FP"/"FACE" lines carry no algorithm version of their own, so
// it's taken from what the uploading terminal reported about itself.
function templateFromRecord({ tag, fields }, deviceInfo = {}) {
  const pin = (fields.pin || '').trim();
  if (!pin) return null;
  if (tag === 'BIODATA') {
    const type = toInt(fields.type);
    if (!fields.tmp || type === undefined) return null;
    return {
      pin,
      type,
      no: toInt(fields.no) ?? 0,
      index: toInt(fields.index) ?? 0,
      valid: toInt(fields.valid) ?? 1,
      duress: toInt(fields.duress) ?? 0,
      majorVer: toInt(fields.majorver),
      minorVer: toInt(fields.minorver) ?? 0,
      format: toInt(fields.format) ?? 0,
      tmp: fields.tmp.trim(),
    };
  }
  if (tag === 'FP' || tag === 'FINGERTMP' || tag === 'TEMPLATEV10') {
    const tmp = fields.tmp ?? fields.template;
    if (!tmp) return null;
    return {
      pin,
      type: BIO_TYPE.FINGERPRINT,
      no: toInt(fields.fid ?? fields.fingerid) ?? 0,
      index: 0,
      valid: toInt(fields.valid) ?? 1,
      duress: 0,
      majorVer: toInt(deviceInfo.fpVersion),
      minorVer: 0,
      format: 0,
      tmp: tmp.trim(),
    };
  }
  if (tag === 'FACE') {
    if (!fields.tmp) return null;
    return {
      pin,
      type: BIO_TYPE.FACE_IR,
      no: toInt(fields.fid) ?? 0,
      index: 0,
      valid: toInt(fields.valid) ?? 1,
      duress: 0,
      majorVer: toInt(deviceInfo.faceVersion),
      minorVer: 0,
      format: 0,
      tmp: fields.tmp.trim(),
    };
  }
  return null;
}

// The comma-separated "options" upload a terminal sends about itself. Values
// can contain commas ("ZKTECO CO., LTD."), so a piece with no "=" is glued
// back onto the value before it. The ~Max… capacities are reported in
// hundreds (users, fingerprints) and tens of thousands (attendance records):
// ~MaxUserCount=5 on an MB10-VL is its 500-user spec. ~MaxFaceCount is a
// plain count.
function parseDeviceOptions(body) {
  const raw = {};
  let lastKey = null;
  for (const piece of (body || '').split(',')) {
    const eq = piece.indexOf('=');
    if (eq > 0) {
      lastKey = piece.slice(0, eq).trim().replace(/^~/, '');
      raw[lastKey] = piece.slice(eq + 1).trim();
    } else if (lastKey) {
      raw[lastKey] += `,${piece}`;
    }
  }
  const num = (key) => toInt(raw[key]);
  const scaled = (key, factor) => (num(key) === undefined ? undefined : num(key) * factor);
  return {
    deviceName: raw.DeviceName || undefined,
    firmware: raw.FWVersion || undefined,
    pushVersion: raw.PushVersion || undefined,
    platform: raw.Platform || undefined,
    ipAddress: raw.IPAddress || undefined,
    fpVersion: num('FPVersion'),
    faceVersion: num('FaceVersion'),
    multiBioDataSupport: raw.MultiBioDataSupport || undefined,
    userCount: num('UserCount'),
    maxUsers: scaled('MaxUserCount', 100),
    fingerprintCount: num('FPCount'),
    maxFingerprints: scaled('MaxFingerCount', 100),
    faceCount: num('FaceCount'),
    maxFaces: num('MaxFaceCount'),
    attLogCount: num('TransactionCount'),
    maxAttLogs: scaled('MaxAttLogCount', 10000),
  };
}

// "0:1:0:0:0:0:0:0:0:1" — position N is template type N.
function supportsBioType(multiBioDataSupport, type) {
  return (multiBioDataSupport || '').split(':')[type] === '1';
}

// A template only works on a terminal running the same algorithm version it
// was made with (a V10 fingerprint means nothing to a V13 reader), so it's
// pushed only where that version matches — never to a terminal whose versions
// aren't known yet.
function canReceiveTemplate(info, template) {
  if (!info || !SYNCABLE_TYPES.includes(template.type)) return false;
  if (info.multiBioDataSupport && !supportsBioType(info.multiBioDataSupport, template.type)) return false;
  const deviceVersion = template.type === BIO_TYPE.FINGERPRINT ? info.fpVersion : info.faceVersion;
  return deviceVersion != null && template.majorVer != null && Number(deviceVersion) === Number(template.majorVer);
}

function sanitizeValue(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]/g, ' ')
    .trim();
}

// Cuts on a whole character so a Lao name never ends mid UTF-8 sequence.
function truncateUtf8(text, maxBytes) {
  let out = '';
  for (const ch of text) {
    if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
    out += ch;
  }
  return out;
}

// Same fields and defaults the terminal reports in its own USER lines
// (Grp=1, TZ=0000000100000000, Verify=0 …). Pri=0 is an ordinary user —
// admin rights are never pushed from here.
function buildUserInfoCommand({ pin, name }) {
  const safeName = truncateUtf8(sanitizeValue(name), DEVICE_NAME_MAX_BYTES);
  return (
    `DATA UPDATE USERINFO PIN=${sanitizeValue(pin)}\tName=${safeName}\tPri=0\tPasswd=\tCard=\tGrp=1` +
    '\tTZ=0000000100000000\tVerify=0\tViceCard=\tStartDatetime=0\tEndDatetime=0'
  );
}

function buildDeleteUserCommand(pin) {
  return `DATA DELETE USERINFO PIN=${sanitizeValue(pin)}`;
}

function buildBiodataCommand(t) {
  return (
    `DATA UPDATE BIODATA Pin=${sanitizeValue(t.pin)}\tNo=${t.no ?? 0}\tIndex=${t.index ?? 0}\tValid=${t.valid ?? 1}` +
    `\tDuress=${t.duress ?? 0}\tType=${t.type}\tMajorVer=${t.majorVer}\tMinorVer=${t.minorVer ?? 0}` +
    `\tFormat=${t.format ?? 0}\tTmp=${t.tmp}`
  );
}

// startTime/endTime as "YYYY-MM-DD HH:mm:ss" in the terminal's local time.
function buildQueryAttLogCommand(startTime, endTime) {
  return `DATA QUERY ATTLOG StartTime=${startTime}\tEndTime=${endTime}`;
}

function hashText(text) {
  return crypto.createHash('sha1').update(text || '').digest('hex');
}

module.exports = {
  BIO_TYPE,
  SYNCABLE_TYPES,
  DEVICE_NAME_MAX_BYTES,
  QUERY_USERS_COMMAND,
  QUERY_TEMPLATES_COMMAND,
  splitLines,
  parseFields,
  parseRecordLine,
  userFromRecord,
  templateFromRecord,
  parseDeviceOptions,
  supportsBioType,
  canReceiveTemplate,
  truncateUtf8,
  buildUserInfoCommand,
  buildDeleteUserCommand,
  buildBiodataCommand,
  buildQueryAttLogCommand,
  hashText,
};
