const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');
const { samePhone, employeeAccountOf } = require('../utils/accounts');
const { blockedFor, recordFailure, clearFailures } = require('../utils/loginLimiter');

const router = express.Router();

// `tv` ties the token to the password it was signed in with (see
// middleware/auth.js) — changing or resetting the password ends it.
function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, tv: user.tokenVersion ?? 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function serializeUser(user) {
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    employee: user.employeeId || null,
    mustChangePassword: user.mustChangePassword,
  };
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const tooManyTries = (res, minutes) =>
  res.status(429).json({ message: `ລອງຫຼາຍເທື່ອເກີນໄປ — ກະລຸນາລໍຖ້າ ${minutes} ນາທີ ແລ້ວລອງໃໝ່` });

// Admins and managers sign in with their email; employees with their
// employee code (the ROMEO app at /me) — the account found is their own
// role-'employee' one, never an admin/manager account linked to the same person.
router.post('/login', async (req, res, next) => {
  try {
    const email = text(req.body.email).toLowerCase();
    const employeeCode = text(req.body.employeeCode);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if ((!email && !employeeCode) || !password) {
      return res.status(400).json({ message: employeeCode || !email ? 'ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ' : 'Email and password are required' });
    }
    const limitKey = employeeCode ? `code:${employeeCode}` : `email:${email}`;
    const wait = blockedFor(limitKey);
    if (wait) return tooManyTries(res, wait);

    const needsSetup = () =>
      res.status(401).json({ message: 'ບັນຊີນີ້ຍັງບໍ່ໄດ້ຕັ້ງລະຫັດຜ່ານ — ກົດ "ຕັ້ງລະຫັດຜ່ານ" ກ່ອນ', needsSetup: true });
    let user = null;
    if (employeeCode) {
      const employee = await Employee.findOne({ employeeCode }, '_id status');
      if (employee) user = await employeeAccountOf(employee._id).populate('employeeId');
      // An active employee who hasn't made their account yet: point them to
      // setting a password rather than calling it a wrong one.
      if (employee?.status === 'active' && !user) return needsSetup();
    } else {
      user = await User.findOne({ email }).populate('employeeId');
    }
    const wrong = employeeCode ? 'ລະຫັດພະນັກງານ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ' : 'Invalid email or password';
    if (!user) {
      recordFailure(limitKey);
      return res.status(401).json({ message: wrong });
    }
    if (user.isActive === false) return res.status(403).json({ message: 'ບັນຊີນີ້ຖືກປິດແລ້ວ' });
    if (!user.passwordHash) return needsSetup();

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      recordFailure(limitKey);
      return res.status(401).json({ message: wrong });
    }
    clearFailures(limitKey);
    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// An employee sets their own password — the first time, and again after an
// admin resets it (routes/employeeAccounts.js). Their phone number on file is
// what proves it's them. Only while no password is set: once it is, nobody
// who merely knows a colleague's code and number can take the account over,
// only an admin reset reopens it.
const EMPLOYEE_MIN_PASSWORD = 6;
router.post('/employee-setup', async (req, res, next) => {
  try {
    const employeeCode = text(req.body.employeeCode);
    const phone = text(req.body.phone);
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    if (!employeeCode || !phone || !newPassword) {
      return res.status(400).json({ message: 'ກະລຸນາປ້ອນ ລະຫັດພະນັກງານ, ເບີໂທ ແລະ ລະຫັດຜ່ານໃໝ່' });
    }
    if (newPassword.length < EMPLOYEE_MIN_PASSWORD) {
      return res.status(400).json({ message: `ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ ${EMPLOYEE_MIN_PASSWORD} ຕົວ` });
    }
    const limitKey = `setup:${employeeCode}`;
    const wait = blockedFor(limitKey);
    if (wait) return tooManyTries(res, wait);

    const employee = await Employee.findOne({ employeeCode }, '_id status phone');
    // One answer for a wrong code and a wrong number, so neither can be probed.
    if (!employee || employee.status !== 'active' || !samePhone(employee.phone, phone)) {
      recordFailure(limitKey);
      return res.status(400).json({
        message: employee && employee.status === 'active' && !employee.phone
          ? 'ຍັງບໍ່ມີເບີໂທຂອງທ່ານໃນລະບົບ — ກະລຸນາຕິດຕໍ່ HR'
          : 'ລະຫັດພະນັກງານ ຫຼື ເບີໂທບໍ່ຖືກຕ້ອງ',
      });
    }

    let user = await employeeAccountOf(employee._id);
    if (user?.passwordHash) {
      return res.status(409).json({ message: 'ບັນຊີນີ້ຕັ້ງລະຫັດຜ່ານແລ້ວ — ຖ້າລືມລະຫັດ ໃຫ້ HR ກົດຣີເຊັດໃຫ້' });
    }
    if (!user) user = new User({ role: 'employee', employeeId: employee._id });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordSetAt = new Date();
    user.lastLoginAt = new Date();
    user.isActive = true;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    clearFailures(limitKey);

    await user.populate('employeeId');
    res.json({ token: signToken(user), user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json(serializeUser(req.user));
});

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const valid = req.user.passwordHash ? await bcrypt.compare(currentPassword, req.user.passwordHash) : false;
    if (!valid) return res.status(401).json({ message: 'Current password is incorrect' });

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    req.user.mustChangePassword = false;
    req.user.passwordSetAt = new Date();
    // Ends every other session; this one continues with the new token below.
    req.user.tokenVersion = (req.user.tokenVersion ?? 0) + 1;
    await req.user.save();

    res.json({ ...serializeUser(req.user), token: signToken(req.user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
