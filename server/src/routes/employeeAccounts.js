const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { authenticate, requireRole } = require('../middleware/auth');
const { employeeAccountOf } = require('../utils/accounts');

// Employees' own accounts for the ROMEO app (/me). Employees create theirs
// themselves (routes/auth.js employee-setup); HR only sees where each one
// stands and resets a forgotten password.
const router = express.Router();

// 'none' — never set up; 'active' — password set; 'reset' — HR reset it and
// the employee hasn't set a new one yet.
function accountStatus(user) {
  if (!user) return 'none';
  return user.passwordHash ? 'active' : 'reset';
}

router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const users = await User.find({ role: 'employee', employeeId: { $ne: null } }, 'employeeId passwordHash passwordSetAt lastLoginAt isActive').lean();
    res.json(
      users.map((u) => ({
        employee: u.employeeId,
        status: accountStatus(u),
        isActive: u.isActive !== false,
        passwordSetAt: u.passwordSetAt ?? null,
        lastLoginAt: u.lastLoginAt ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:employeeId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.employeeId)) return res.status(404).json({ message: 'Not found' });
    const user = await employeeAccountOf(req.params.employeeId).lean();
    res.json({
      status: accountStatus(user),
      isActive: user ? user.isActive !== false : null,
      passwordSetAt: user?.passwordSetAt ?? null,
      lastLoginAt: user?.lastLoginAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// Forgotten password: clears it and signs the account out everywhere, so the
// employee sets a new one with their code and phone number, the same way as
// the first time.
router.post('/:employeeId/reset', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.employeeId)) return res.status(404).json({ message: 'Not found' });
    const employee = await Employee.findById(req.params.employeeId, 'status');
    if (!employee) return res.status(404).json({ message: 'Not found' });
    const user = await employeeAccountOf(employee._id);
    if (!user) return res.status(404).json({ message: 'ພະນັກງານຄົນນີ້ຍັງບໍ່ໄດ້ສ້າງບັນຊີ — ໃຫ້ເຂົາຕັ້ງລະຫັດຜ່ານໃນແອັບເອງ' });
    user.passwordHash = undefined;
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
