const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');
const { employeeAccountOf, EMPLOYEE_MIN_PASSWORD, USERNAME_RULE, USERNAME_RULE_MESSAGE, USERNAME_TAKEN } = require('../utils/accounts');
const { blockedFor, recordFailure, clearFailures } = require('../utils/loginLimiter');
const { sealPassword } = require('../utils/passwordView');
// `tv` in the token ties it to the password it was signed in with (see
// middleware/auth.js) — changing or resetting the password ends it.
const { signToken } = require('../utils/tokens');

const router = express.Router();


function serializeUser(user) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    role: user.role,
    employee: user.employeeId || null,
    mustChangePassword: user.mustChangePassword,
  };
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const tooManyTries = (res, minutes) =>
  res.status(429).json({ message: `ລອງຫຼາຍເທື່ອເກີນໄປ — ກະລຸນາລໍຖ້າ ${minutes} ນາທີ ແລ້ວລອງໃໝ່` });

// Admins and managers sign in with their email; employees (the ROMEO app at
// /me) with one field that is either the username they picked or their
// employee code (digits only — a username always starts with a letter). The
// account found is their own role-'employee' one, never an admin/manager
// account linked to the same person.
router.post('/login', async (req, res, next) => {
  try {
    const email = text(req.body.email).toLowerCase();
    const appId = text(req.body.login) || text(req.body.employeeCode);
    const employeeCode = /^\d+$/.test(appId) ? appId : '';
    const username = appId && !employeeCode ? appId.toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if ((!email && !appId) || !password) {
      return res.status(400).json({ message: appId || !email ? 'ກະລຸນາປ້ອນຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ' : 'Email and password are required' });
    }
    const limitKey = employeeCode ? `code:${employeeCode}` : username ? `user:${username}` : `email:${email}`;
    const wait = blockedFor(limitKey);
    if (wait) return tooManyTries(res, wait);

    const needsSetup = () =>
      res.status(401).json({ message: 'ບັນຊີນີ້ຍັງບໍ່ໄດ້ລົງທະບຽນ — ກົດ "ລົງທະບຽນ" ກ່ອນ', needsSetup: true });
    let user = null;
    if (employeeCode) {
      const employee = await Employee.findOne({ employeeCode }, '_id status');
      if (employee) user = await employeeAccountOf(employee._id).populate('employeeId');
      // An active employee who hasn't registered yet: point them to
      // registering rather than calling it a wrong password.
      if (employee?.status === 'active' && !user) return needsSetup();
    } else if (username) {
      user = await User.findOne({ username, role: 'employee' }).populate('employeeId');
    } else {
      user = await User.findOne({ email }).populate('employeeId');
    }
    const wrong = appId ? 'ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ' : 'Invalid email or password';
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
    // The copy an admin can read back — also how an account registered before
    // that copy existed gets one.
    if (user.role === 'employee') user.passwordView = sealPassword(password);
    await user.save();

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// An employee registers in the app: a username of their own, their employee
// code and a password — the first time, and again after an admin resets a
// forgotten password (routes/employeeAccounts.js). Nothing else is asked
// (decided 21/11/2026, to keep it simple — the phone-number check is gone), so
// a code can be registered only once: after that only an admin reset opens it
// again, and the employee page shows HR which username took which code, and when.
// An admin can also set the username, password or code (routes/employeeAccounts.js).
router.post('/employee-register', async (req, res, next) => {
  try {
    const username = text(req.body.username).toLowerCase();
    const employeeCode = text(req.body.employeeCode);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!username || !employeeCode || !password) {
      return res.status(400).json({ message: 'ກະລຸນາປ້ອນ ຊື່ຜູ້ໃຊ້, ລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ' });
    }
    if (!USERNAME_RULE.test(username)) {
      return res.status(400).json({ message: USERNAME_RULE_MESSAGE });
    }
    if (password.length < EMPLOYEE_MIN_PASSWORD) {
      return res.status(400).json({ message: `ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ ${EMPLOYEE_MIN_PASSWORD} ຕົວ` });
    }
    const limitKey = `register:${employeeCode}`;
    const wait = blockedFor(limitKey);
    if (wait) return tooManyTries(res, wait);

    const employee = await Employee.findOne({ employeeCode }, '_id status');
    if (!employee || employee.status !== 'active') {
      recordFailure(limitKey);
      return res.status(400).json({ message: 'ບໍ່ພົບລະຫັດພະນັກງານນີ້ — ກວດລະຫັດອີກຄັ້ງ ຫຼື ຖາມ HR' });
    }

    let user = await employeeAccountOf(employee._id);
    if (user?.passwordHash) {
      return res.status(409).json({ message: 'ລະຫັດພະນັກງານນີ້ລົງທະບຽນແລ້ວ — ກົດ "ເຂົ້າສູ່ລະບົບ" ໄດ້ເລີຍ. ຖ້າລືມລະຫັດຜ່ານ ໃຫ້ HR ກົດຣີເຊັດໃຫ້' });
    }
    // Their own old username (kept through an admin reset) may be picked again.
    if (await User.exists(user ? { username, _id: { $ne: user._id } } : { username })) {
      return res.status(409).json({ message: USERNAME_TAKEN });
    }
    if (!user) user = new User({ role: 'employee', employeeId: employee._id });
    user.username = username;
    user.registeredCode = employeeCode;
    user.passwordHash = await bcrypt.hash(password, 10);
    user.passwordView = sealPassword(password);
    user.passwordSetAt = new Date();
    user.lastLoginAt = new Date();
    user.isActive = true;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    try {
      await user.save();
    } catch (err) {
      // Two people taking the same username at the same moment.
      if (err?.code === 11000) return res.status(409).json({ message: USERNAME_TAKEN });
      throw err;
    }
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
    if (req.user.role === 'employee') req.user.passwordView = sealPassword(newPassword);
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
