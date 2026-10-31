const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Links to an evidence image carry their own short-lived signed token, so an
// <img> can load it without the Authorization header a browser won't send
// for one — and a copied link stops working after a few hours.
const PHOTO_LINK_TTL = '6h';

function photoUrl(photoId, size) {
  const token = jwt.sign({ p: String(photoId) }, process.env.JWT_SECRET, { expiresIn: PHOTO_LINK_TTL });
  return `/evidence-photo/${photoId}?s=${size}&t=${encodeURIComponent(token)}`;
}

function photoTokenAllows(photoId, token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET).p === String(photoId);
  } catch {
    return false;
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Every phone sends a JPEG it made itself (resized in the app).
function isJpeg(buffer) {
  return !!buffer && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

// Photos live in the same database as everything else — they must never
// fill it: when it nears EVIDENCE_DB_LIMIT_MB, new photos are refused and
// scans, leave and the rest of HR keep working. The default suits MongoDB
// Atlas's free tier (512MB); set it to the real plan's size, or 0 for no
// limit (a database on the shop's own server).
const DEFAULT_LIMIT_MB = 450;
const STATS_TTL_MS = 5 * 60 * 1000;
let cachedStats = null;

function storageLimitMb() {
  const raw = process.env.EVIDENCE_DB_LIMIT_MB;
  if (raw === undefined || raw === '') return DEFAULT_LIMIT_MB;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMIT_MB;
}

async function storageState({ fresh = false } = {}) {
  const limitMb = storageLimitMb();
  if (!limitMb) return { full: false, usedMb: null, limitMb: 0 };
  if (fresh || !cachedStats || Date.now() - cachedStats.at > STATS_TTL_MS) {
    try {
      const stats = await mongoose.connection.db.stats();
      cachedStats = { at: Date.now(), usedMb: ((stats.storageSize ?? 0) + (stats.indexSize ?? 0)) / (1024 * 1024) };
    } catch (err) {
      console.error('[evidence] could not read database size', err.message);
      cachedStats = { at: Date.now(), usedMb: null };
    }
  }
  const usedMb = cachedStats.usedMb;
  return { full: usedMb != null && usedMb >= limitMb, usedMb, limitMb };
}

// A stored photo makes the cached size stale.
function storageChanged() {
  cachedStats = null;
}

function serializeEvidence(doc) {
  const e = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    _id: e._id,
    employee: e.employee,
    date: e.date,
    kind: e.kind,
    takenAt: e.takenAt,
    uploadedAt: e.uploadedAt,
    backdated: !!e.backdated,
    duplicate: !!e.duplicate,
    note: e.note ?? '',
    editedAt: e.editedAt ?? null,
    thumbUrl: photoUrl(e.photo, 'thumb'),
    photoUrl: photoUrl(e.photo, 'full'),
    history: (e.replaced ?? []).map((r) => ({
      takenAt: r.takenAt,
      uploadedAt: r.uploadedAt,
      replacedAt: r.replacedAt,
      thumbUrl: photoUrl(r.photo, 'thumb'),
      photoUrl: photoUrl(r.photo, 'full'),
    })),
  };
}

module.exports = { photoUrl, photoTokenAllows, sha256, isJpeg, storageState, storageChanged, serializeEvidence };
