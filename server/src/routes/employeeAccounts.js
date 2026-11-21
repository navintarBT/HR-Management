const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ScanEvidence = require('../models/ScanEvidence');
const EvidencePhoto = require('../models/EvidencePhoto');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  employeeAccountOf,
  EMPLOYEE_MIN_PASSWORD,
  USERNAME_RULE,
  USERNAME_RULE_MESSAGE,
  USERNAME_TAKEN,
} = require('../utils/accounts');
const { sealPassword, openPassword } = require('../utils/passwordView');

// Employees' own accounts for the ROMEO app (/me). Employees create theirs
// themselves (routes/auth.js employee-register); HR sees where each one stands
// (and which username registered it), resets a forgotten password, and an
// admin can set the username, a new password or the employee code it belongs
// to (decided 22/11/2026). Admins also see the password itself (an encrypted
// copy, utils/passwordView.js — known from the registration, a password set
// here, or the next sign-in); managers never do.
const router = express.Router();

// 'none' — never registered; 'active' — password set; 'reset' — HR reset it
// and the employee hasn't registered again yet.
function accountStatus(user) {
  if (!user) return 'none';
  return user.passwordHash ? 'active' : 'reset';
}

// `withPassword`: an admin asking — the password when it's known (null when
// it isn't yet); left out altogether for anyone else. `ownCode`: the code of
// the employee the account belongs to now — what registeredCode is compared
// with (and stands in for it on an account from before it was kept).
function accountView(user, evidenceCount = 0, withPassword = false, ownCode = null) {
  return {
    status: accountStatus(user),
    username: user?.username ?? null,
    registeredCode: user ? user.registeredCode || ownCode || null : null,
    isActive: user ? user.isActive !== false : null,
    passwordSetAt: user?.passwordSetAt ?? null,
    lastLoginAt: user?.lastLoginAt ?? null,
    evidenceCount,
    ...(withPassword ? { password: user?.passwordHash ? openPassword(user.passwordView) : null } : {}),
  };
}

const isAdmin = (req) => req.user?.role === 'admin';
const ACCOUNT_FIELDS = 'employeeId username registeredCode passwordHash passwordSetAt lastLoginAt isActive';
// Named outright: User.passwordView is never loaded otherwise (select: false).
const accountFields = (req) => (isAdmin(req) ? `${ACCOUNT_FIELDS} passwordView` : ACCOUNT_FIELDS);

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Everyone on the staff list (not drafts), with their app account if they have one.
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const [employees, users, evidence] = await Promise.all([
      Employee.find({ status: { $ne: 'draft' } }, 'employeeCode firstName lastName status position department')
        .populate('position', 'name')
        .populate('department', 'name')
        .lean(),
      User.find({ role: 'employee', employeeId: { $ne: null } }).select(accountFields(req)).lean(),
      ScanEvidence.aggregate([{ $group: { _id: '$employee', count: { $sum: 1 } } }]),
    ]);
    const userOf = new Map(users.map((u) => [String(u.employeeId), u]));
    const evidenceOf = new Map(evidence.map((e) => [String(e._id), e.count]));
    res.json(
      employees.map((e) => ({
        employee: {
          _id: e._id,
          employeeCode: e.employeeCode ?? null,
          firstName: e.firstName ?? '',
          lastName: e.lastName ?? '',
          status: e.status,
          position: e.position?.name ?? null,
          positionId: e.position?._id ?? null,
          department: e.department?.name ?? null,
          departmentId: e.department?._id ?? null,
        },
        ...accountView(userOf.get(String(e._id)), evidenceOf.get(String(e._id)) ?? 0, isAdmin(req), e.employeeCode ?? null),
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:employeeId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.employeeId)) return res.status(404).json({ message: 'Not found' });
    const [user, employee] = await Promise.all([
      employeeAccountOf(req.params.employeeId).select(accountFields(req)).lean(),
      Employee.findById(req.params.employeeId, 'employeeCode').lean(),
    ]);
    res.json(accountView(user, await ScanEvidence.countDocuments({ employee: req.params.employeeId }), isAdmin(req), employee?.employeeCode ?? null));
  } catch (err) {
    next(err);
  }
});

// An admin edits the account: { username?, password?, employeeCode? } — any of
// them. With no account yet, a username and a password make one (as if the
// employee had registered). A new password signs the account out everywhere;
// so does moving it to another code (the app then shows the right person). Moving
// takes the photos sent through it along (decided 22/11/2026: they're the
// photos of whoever uses the account) and frees the old code to register.
router.patch('/:employeeId', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.employeeId)) return res.status(404).json({ message: 'Not found' });
    const employee = await Employee.findById(req.params.employeeId, 'employeeCode status');
    if (!employee) return res.status(404).json({ message: 'Not found' });
    let user = await employeeAccountOf(employee._id);

    const username = text(req.body.username).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const code = text(req.body.employeeCode);
    if (!username && !password && !code) return res.status(400).json({ message: 'ບໍ່ມີຫຍັງປ່ຽນ' });

    if (!user && (!username || !password)) {
      return res.status(400).json({ message: 'ຄົນນີ້ຍັງບໍ່ມີບັນຊີ — ປ້ອນທັງ ຊື່ຜູ້ໃຊ້ ແລະ ລະຫັດຜ່ານ ເພື່ອສ້າງບັນຊີໃຫ້' });
    }
    if (!user && employee.status !== 'active') {
      return res.status(400).json({ message: 'ພະນັກງານຄົນນີ້ບໍ່ໄດ້ເຮັດວຽກຢູ່ແລ້ວ — ສ້າງບັນຊີໃຫ້ບໍ່ໄດ້' });
    }
    if (username && !USERNAME_RULE.test(username)) return res.status(400).json({ message: USERNAME_RULE_MESSAGE });
    if (password && password.length < EMPLOYEE_MIN_PASSWORD) {
      return res.status(400).json({ message: `ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ ${EMPLOYEE_MIN_PASSWORD} ຕົວ` });
    }
    if (username && (await User.exists(user ? { username, _id: { $ne: user._id } } : { username }))) {
      return res.status(409).json({ message: USERNAME_TAKEN });
    }

    // Moving to another employee code: someone active with no account of their own.
    let target = null;
    if (code && code !== employee.employeeCode) {
      if (!user) return res.status(400).json({ message: 'ຄົນນີ້ຍັງບໍ່ມີບັນຊີ — ບໍ່ມີຫຍັງໃຫ້ຍ້າຍ' });
      target = await Employee.findOne({ employeeCode: code }, '_id employeeCode firstName lastName status');
      if (!target || target.status !== 'active') {
        return res.status(400).json({ message: `ບໍ່ພົບພະນັກງານທີ່ເຮັດວຽກຢູ່ ລະຫັດ ${code}` });
      }
      if (await employeeAccountOf(target._id)) {
        return res.status(409).json({ message: `ລະຫັດ ${code} ມີບັນຊີແອັບຂອງຕົນເອງແລ້ວ — 1 ລະຫັດມີໄດ້ 1 ບັນຊີ` });
      }
      // A slot (day + in/out) can hold one photo: refuse rather than drop one.
      const mine = await ScanEvidence.find({ employee: employee._id }, 'date kind').lean();
      if (mine.length) {
        const clash = await ScanEvidence.countDocuments({ employee: target._id, $or: mine.map((e) => ({ date: e.date, kind: e.kind })) });
        if (clash) {
          return res.status(409).json({ message: `ລະຫັດ ${code} ມີຮູບຫຼັກຖານຂອງມື້ດຽວກັນຢູ່ແລ້ວ ${clash} ຮູບ — ຍ້າຍບັນຊີພ້ອມຮູບບໍ່ໄດ້` });
        }
      }
    }

    const now = new Date();
    if (!user) user = new User({ role: 'employee', employeeId: employee._id, lastLoginAt: null, registeredCode: employee.employeeCode });
    // Moving keeps the ID it was registered with (an account from before that
    // was kept: the code it's leaving, which it was registered with).
    if (target && !user.registeredCode) user.registeredCode = employee.employeeCode;
    if (username) user.username = username;
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
      user.passwordView = sealPassword(password);
      user.passwordSetAt = now;
      user.mustChangePassword = false;
    }
    if (password || target) user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    if (target) user.employeeId = target._id;
    if (password || target) user.isActive = (target ?? employee).status === 'active';
    try {
      await user.save();
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ message: USERNAME_TAKEN });
      throw err;
    }

    let movedEvidence = 0;
    if (target) {
      const moved = await ScanEvidence.updateMany({ employee: employee._id }, { $set: { employee: target._id } });
      await EvidencePhoto.updateMany({ employee: employee._id }, { $set: { employee: target._id } });
      movedEvidence = moved.modifiedCount ?? 0;
    }
    const owner = target ?? employee;
    const saved = await User.findById(user._id).select(accountFields(req)).lean();
    res.json({
      ...accountView(saved, await ScanEvidence.countDocuments({ employee: owner._id }), true, owner.employeeCode ?? null),
      employeeId: owner._id,
      employeeCode: owner.employeeCode,
      movedEvidence,
    });
  } catch (err) {
    next(err);
  }
});

// Forgotten password: clears it and signs the account out everywhere, so the
// employee registers again in the app (username, code, password) the same way
// as the first time. The username stays until then, so HR still sees whose it was.
router.post('/:employeeId/reset', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.employeeId)) return res.status(404).json({ message: 'Not found' });
    const employee = await Employee.findById(req.params.employeeId, 'status');
    if (!employee) return res.status(404).json({ message: 'Not found' });
    const user = await employeeAccountOf(employee._id);
    if (!user) return res.status(404).json({ message: 'ພະນັກງານຄົນນີ້ຍັງບໍ່ໄດ້ລົງທະບຽນ — ໃຫ້ເຂົາລົງທະບຽນໃນແອັບເອງ' });
    user.passwordHash = undefined;
    user.passwordView = undefined;
    user.passwordSetAt = undefined;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.isActive = employee.status === 'active';
    await user.save();
    res.json({ status: accountStatus(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
