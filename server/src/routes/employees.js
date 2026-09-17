const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const POPULATE = 'department position supervisor positionHead employmentType defaultShiftCategory';

const PHOTOS_DIR = path.join(__dirname, '../../uploads/employees');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PHOTOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

function uploadPhoto(req, res, next) {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      err.status = 400;
      return next(err);
    }
    next();
  });
}

function buildListQuery(req) {
  const { _start = 0, _end = 10, _sort = 'employeeCode', _order = 'asc', q, ...filters } = req.query;
  const query = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (key.endsWith('_gte') || key.endsWith('_lte')) {
      const field = key.replace(/_(gte|lte)$/, '');
      const op = key.endsWith('_gte') ? '$gte' : '$lte';
      query[field] = { ...query[field], [op]: value };
    } else {
      query[key] = value;
    }
  }

  if (q) {
    query.$or = ['firstName', 'lastName', 'employeeCode', 'email', 'phone'].map((field) => ({
      [field]: { $regex: q, $options: 'i' },
    }));
  }

  if (req.user.role === 'employee') {
    query._id = req.user.employeeId ? req.user.employeeId._id : null;
  }

  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

function cleanEmployeePayload(body) {
  const { createUser, userEmail, userPassword, userRole, mustChangePassword, ...employeePayload } = body;

  for (const field of ['employeeCode', 'email', 'phone', 'deviceUserId', 'defaultShiftStart', 'defaultShiftEnd']) {
    if (employeePayload[field] === '') delete employeePayload[field];
  }
  // Number/ObjectId fields: an empty string would fail Mongoose's cast, so
  // drop it (a request that never mentions the field at all); explicit null
  // still passes through so a PATCH can deliberately clear a previously-set value.
  for (const field of ['defaultRestDay', 'salary', 'annualLeaveDays', 'defaultShiftCategory']) {
    if (employeePayload[field] === '' || employeePayload[field] === undefined) {
      delete employeePayload[field];
    }
  }
  if (!employeePayload.terminationDate) delete employeePayload.terminationDate;
  if (!employeePayload.supervisor) delete employeePayload.supervisor;

  return {
    employeePayload,
    userPayload: {
      createUser: Boolean(createUser),
      email: userEmail || employeePayload.email,
      password: userPassword,
      role: userRole || 'employee',
      mustChangePassword: mustChangePassword !== false,
    },
  };
}

async function generateEmployeeCode() {
  const existing = await Employee.find({ employeeCode: { $regex: /^EMP\d+$/ } }, 'employeeCode');
  const max = existing.reduce((acc, e) => {
    const n = parseInt(e.employeeCode.slice(3), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `EMP${String(max + 1).padStart(3, '0')}`;
}

async function ensureUniqueEmployeeFields(payload, currentId) {
  const or = [];
  if (payload.employeeCode) or.push({ employeeCode: payload.employeeCode });
  if (payload.email) or.push({ email: payload.email.toLowerCase() });
  if (payload.deviceUserId) or.push({ deviceUserId: payload.deviceUserId });
  if (!or.length) return;

  const query = { $or: or };
  if (currentId) query._id = { $ne: currentId };
  const existing = await Employee.findOne(query);
  if (!existing) return;

  const err = new Error('ມີພະນັກງານທີ່ໃຊ້ ລະຫັດພະນັກງານ, ອີເມວ, ຫຼື ລະຫັດເຄື່ອງສະແກນດຽວກັນຢູ່ແລ້ວ');
  err.status = 409;
  throw err;
}

function validateEmployee(payload, partial = false) {
  const isDraft = payload.status === 'draft';
  if (!isDraft && !partial && (!payload.employeeCode || !payload.firstName || !payload.lastName || !payload.hireDate)) {
    const err = new Error('ກະລຸນາປ້ອນ ລະຫັດພະນັກງານ, ຊື່, ນາມສະກຸນ, ແລະ ວັນທີເລີ່ມງານ ໃຫ້ຄົບ');
    err.status = 400;
    throw err;
  }
  if (payload.terminationDate && payload.hireDate && new Date(payload.terminationDate) < new Date(payload.hireDate)) {
    const err = new Error('ວັນທີອອກງານ ຈະຢູ່ກ່ອນ ວັນທີເລີ່ມງານ ບໍ່ໄດ້');
    err.status = 400;
    throw err;
  }
}

router.post('/upload-photo', authenticate, requireRole('admin'), uploadPhoto, (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  res.status(201).json({ url: `/uploads/employees/${req.file.filename}` });
});

router.get('/', authenticate, requireRole('admin', 'manager', 'employee'), async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = buildListQuery(req);
    const [items, total] = await Promise.all([
      Employee.find(query)
        .populate(POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Employee.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, requireRole('admin', 'manager', 'employee'), async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role === 'employee') {
      query._id = req.user.employeeId ? req.user.employeeId._id : null;
    }
    const item = await Employee.findOne(query).populate(POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { employeePayload, userPayload } = cleanEmployeePayload(req.body);
    employeePayload.employeeCode = await generateEmployeeCode();
    validateEmployee(employeePayload);
    await ensureUniqueEmployeeFields(employeePayload);

    if (userPayload.createUser) {
      if (!userPayload.email || !userPayload.password) {
        return res.status(400).json({ message: 'ກະລຸນາປ້ອນອີເມວ ແລະ ລະຫັດຜ່ານ ສຳລັບບັນຊີເຂົ້າສູ່ລະບົບ' });
      }
      const existingUser = await User.findOne({ email: userPayload.email.toLowerCase() });
      if (existingUser) return res.status(409).json({ message: 'ອີເມວນີ້ຖືກໃຊ້ເຂົ້າສູ່ລະບົບແລ້ວ' });
    }

    const employee = await Employee.create(employeePayload);

    if (userPayload.createUser) {
      const passwordHash = await bcrypt.hash(userPayload.password, 10);
      await User.create({
        email: userPayload.email,
        passwordHash,
        role: userPayload.role,
        employeeId: employee._id,
        mustChangePassword: userPayload.mustChangePassword,
      });
    }

    const populated = await employee.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { employeePayload } = cleanEmployeePayload(req.body);
    const current = await Employee.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Not found' });

    // Termination date isn't hand-entered — it's stamped automatically the
    // moment status actually transitions into/out of "resigned".
    if (employeePayload.status !== undefined && employeePayload.status !== current.status) {
      if (employeePayload.status === 'resigned') {
        employeePayload.terminationDate = new Date();
      } else if (current.status === 'resigned') {
        employeePayload.terminationDate = null;
        employeePayload.terminationReason = null;
      }
    }

    const nextPayload = {
      ...current.toObject(),
      ...employeePayload,
    };
    validateEmployee(nextPayload);
    await ensureUniqueEmployeeFields(employeePayload, req.params.id);

    const item = await Employee.findByIdAndUpdate(req.params.id, employeePayload, {
      new: true,
      runValidators: true,
    }).populate(POPULATE);

    if (['inactive', 'resigned', 'suspended'].includes(item.status)) {
      await User.updateMany({ employeeId: item._id }, { isActive: false });
    }

    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Employee.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    await User.updateMany({ employeeId: item._id }, { isActive: false });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
