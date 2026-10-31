const jwt = require('jsonwebtoken');
const User = require('../models/User');

// An employee's own account (the ROMEO app at /me) reaches only these: its
// own sign-in endpoints and the app's own API. Everything else — every HR
// page's API, leave, attendance, other people's data — is refused outright,
// whatever each route would otherwise allow the 'employee' role.
const EMPLOYEE_API_PREFIXES = ['/api/auth/', '/api/me/'];

function employeeMayUse(req) {
  const path = (req.originalUrl || '').split('?')[0];
  return EMPLOYEE_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).populate('employeeId');
    if (!user) return res.status(401).json({ message: 'Invalid token' });
    if (user.isActive === false) return res.status(401).json({ message: 'Account is inactive' });
    // Signed in before the password last changed or was reset.
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return res.status(401).json({ message: 'Session ended — sign in again' });
    if (user.role === 'employee' && !employeeMayUse(req)) return res.status(403).json({ message: 'Forbidden' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
