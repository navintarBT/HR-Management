const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const ScanEvidence = require('../models/ScanEvidence');
const EvidencePhoto = require('../models/EvidencePhoto');
const { authenticate } = require('../middleware/auth');
const { resolveShiftDateKey, resolveExpectedShift, toDateKey } = require('../utils/attendanceProcessor');
const { sha256, isJpeg, storageState, storageChanged, serializeEvidence } = require('../utils/evidence');

// The employees' app (/me): their own photo evidence, one for coming in and
// one for going out per shift. Everything here is about the signed-in
// employee only (an employee account reaches nothing else —
// middleware/auth.js).
const router = express.Router();

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 300 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 2 } }).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
]);

function withUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ message: 'ໄຟລ໌ຮູບໃຫຍ່ເກີນໄປ ຫຼື ບໍ່ຖືກຕ້ອງ' });
    next();
  });
}

function ownEmployeeId(req, res) {
  const id = req.user.employeeId?._id;
  if (!id) res.status(400).json({ message: 'ບັນຊີນີ້ບໍ່ໄດ້ຜູກກັບພະນັກງານ' });
  return id;
}

const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());

// The photo and thumbnail the app sends, checked and stored.
async function storePhoto(employeeId, files) {
  const photo = files?.photo?.[0]?.buffer;
  const thumb = files?.thumb?.[0]?.buffer;
  if (!isJpeg(photo) || !isJpeg(thumb) || thumb.length > MAX_THUMB_BYTES) {
    const err = new Error('ຮູບບໍ່ຖືກຕ້ອງ — ກະລຸນາຖ່າຍໃໝ່');
    err.status = 400;
    throw err;
  }
  const hash = sha256(photo);
  const reused = await EvidencePhoto.exists({ sha256: hash, employee: employeeId });
  const doc = await EvidencePhoto.create({ employee: employeeId, data: photo, thumb, size: photo.length, sha256: hash });
  storageChanged();
  return { doc, reused: !!reused };
}

async function refuseWhenFull(res) {
  const storage = await storageState();
  if (!storage.full) return false;
  res.status(507).json({ message: 'ບ່ອນເກັບຮູບເຕັມແລ້ວ — ກະລຸນາແຈ້ງ HR', storageFull: true });
  return true;
}

// What the camera screen needs: the shift-day it's on right now (a night
// shift's small hours belong to the evening before), its hours, and which of
// the two photos are already in.
router.get('/evidence/today', authenticate, async (req, res, next) => {
  try {
    const employeeId = ownEmployeeId(req, res);
    if (!employeeId) return;
    const date = await resolveShiftDateKey(employeeId, new Date());
    const [expected, rows, storage] = await Promise.all([
      resolveExpectedShift(employeeId, date),
      ScanEvidence.find({ employee: employeeId, date }),
      storageState(),
    ]);
    const slot = (kind) => {
      const row = rows.find((r) => r.kind === kind);
      return row ? serializeEvidence(row) : null;
    };
    res.json({
      date,
      shift: expected ? { start: hm(expected.startHour, expected.startMinute), end: hm(expected.endHour, expected.endMinute) } : null,
      in: slot('in'),
      out: slot('out'),
      storageFull: storage.full,
    });
  } catch (err) {
    next(err);
  }
});

// Their history, newest shift first (the last 62 days unless asked for more).
router.get('/evidence', authenticate, async (req, res, next) => {
  try {
    const employeeId = ownEmployeeId(req, res);
    if (!employeeId) return;
    const today = toDateKey(new Date());
    const fallbackFrom = toDateKey(new Date(Date.now() - 62 * 24 * 3600000));
    const from = isDateKey(req.query.from) ? req.query.from : fallbackFrom;
    const to = isDateKey(req.query.to) ? req.query.to : today;
    const rows = await ScanEvidence.find({ employee: employeeId, date: { $gte: from, $lte: to } }).sort({ date: -1, kind: 1 });
    res.json(rows.map(serializeEvidence));
  } catch (err) {
    next(err);
  }
});

// A new photo. Without a date it's for the shift-day the photo was taken on;
// without a kind it fills the shift's first empty slot (in, then out). Sending
// one for a slot that already has a photo replaces it — the old one is kept.
// Any past shift can be uploaded for (ອັບໂຫຼດຍ້ອນຫຼັງ — flagged), not a future one.
router.post('/evidence', authenticate, withUpload, async (req, res, next) => {
  let stored = null;
  try {
    const employeeId = ownEmployeeId(req, res);
    if (!employeeId) return;
    if (await refuseWhenFull(res)) return;

    const now = new Date();
    const sentAt = req.body.takenAt ? new Date(req.body.takenAt) : null;
    const takenAt = sentAt && !Number.isNaN(sentAt.getTime()) && sentAt <= new Date(now.getTime() + 5 * 60000) ? sentAt : now;
    const currentDay = await resolveShiftDateKey(employeeId, now);
    const date = isDateKey(req.body.date) ? req.body.date : await resolveShiftDateKey(employeeId, takenAt);
    if (date > currentDay) return res.status(400).json({ message: 'ອັບໂຫຼດລ່ວງໜ້າບໍ່ໄດ້' });

    const existing = await ScanEvidence.find({ employee: employeeId, date });
    let kind = req.body.kind === 'in' || req.body.kind === 'out' ? req.body.kind : null;
    if (!kind) {
      if (!existing.some((r) => r.kind === 'in')) kind = 'in';
      else if (!existing.some((r) => r.kind === 'out')) kind = 'out';
      else return res.status(409).json({ message: 'ກະນີ້ມີຮູບເຂົ້າ ແລະ ອອກແລ້ວ — ເລືອກວ່າຈະແທນຮູບໃດ', needsKind: true });
    }

    stored = await storePhoto(employeeId, req.files);
    const slot = existing.find((r) => r.kind === kind);
    const fields = {
      photo: stored.doc._id,
      takenAt,
      uploadedAt: now,
      backdated: date < currentDay,
      duplicate: stored.reused,
      note: typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : slot?.note ?? '',
    };
    let row;
    if (slot) {
      slot.replaced.push({ photo: slot.photo, takenAt: slot.takenAt, uploadedAt: slot.uploadedAt, replacedAt: now });
      Object.assign(slot, fields, { editedAt: now });
      row = await slot.save();
    } else {
      row = await ScanEvidence.create({ employee: employeeId, date, kind, ...fields });
    }
    res.status(slot ? 200 : 201).json(serializeEvidence(row));
  } catch (err) {
    if (stored?.doc) await EvidencePhoto.deleteOne({ _id: stored.doc._id }).catch(() => undefined);
    if (err?.code === 11000) return res.status(409).json({ message: 'ມີຮູບນີ້ຢູ່ແລ້ວ — ລອງໃໝ່ອີກຄັ້ງ' });
    next(err);
  }
});

// Editing one: another photo, another shift-day or in/out, or the note —
// whenever they like (the photo itself shows who and when).
router.patch('/evidence/:id', authenticate, withUpload, async (req, res, next) => {
  let stored = null;
  try {
    const employeeId = ownEmployeeId(req, res);
    if (!employeeId) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
    const row = await ScanEvidence.findOne({ _id: req.params.id, employee: employeeId });
    if (!row) return res.status(404).json({ message: 'Not found' });

    const now = new Date();
    const currentDay = await resolveShiftDateKey(employeeId, now);
    const date = isDateKey(req.body.date) ? req.body.date : row.date;
    const kind = req.body.kind === 'in' || req.body.kind === 'out' ? req.body.kind : row.kind;
    if (date > currentDay) return res.status(400).json({ message: 'ເລືອກວັນໃນອະນາຄົດບໍ່ໄດ້' });
    if ((date !== row.date || kind !== row.kind) && (await ScanEvidence.exists({ employee: employeeId, date, kind, _id: { $ne: row._id } }))) {
      return res.status(409).json({ message: 'ວັນ ແລະ ປະເພດນັ້ນມີຮູບຢູ່ແລ້ວ — ແກ້ຮູບນັ້ນແທນ' });
    }

    if (req.files?.photo) {
      if (await refuseWhenFull(res)) return;
      stored = await storePhoto(employeeId, req.files);
      row.replaced.push({ photo: row.photo, takenAt: row.takenAt, uploadedAt: row.uploadedAt, replacedAt: now });
      row.photo = stored.doc._id;
      row.duplicate = stored.reused;
      const sentAt = req.body.takenAt ? new Date(req.body.takenAt) : null;
      row.takenAt = sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : now;
      row.uploadedAt = now;
    }
    // Uploaded after its shift-day — judged again when the photo or the day changes.
    if (req.files?.photo || date !== row.date) row.backdated = date < currentDay;
    row.date = date;
    row.kind = kind;
    if (typeof req.body.note === 'string') row.note = req.body.note.slice(0, 500);
    row.editedAt = now;
    await row.save();
    res.json(serializeEvidence(row));
  } catch (err) {
    if (stored?.doc) await EvidencePhoto.deleteOne({ _id: stored.doc._id }).catch(() => undefined);
    next(err);
  }
});

module.exports = router;
