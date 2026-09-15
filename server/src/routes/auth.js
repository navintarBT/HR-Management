const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
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

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).populate('employeeId');
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });
    if (user.isActive === false) return res.status(403).json({ message: 'Account is inactive' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Invalid email or password' });

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
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
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Current password is incorrect' });

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    req.user.mustChangePassword = false;
    await req.user.save();

    res.json(serializeUser(req.user));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
