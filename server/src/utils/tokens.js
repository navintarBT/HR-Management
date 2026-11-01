const jwt = require('jsonwebtoken');

// Sign-in tokens. The HR pages get JWT_EXPIRES_IN (7 days by default). An
// employee's own app (/me) stays signed in until they sign out: their token
// lasts a year and is renewed while they keep using it (middleware/auth.js),
// so nobody has to sign in again just because time passed. Either kind ends
// at once when the password is changed or HR resets it (User.tokenVersion).
const EMPLOYEE_TOKEN_TTL = '365d';
const RENEW_AFTER_SECONDS = 7 * 24 * 60 * 60;
const RENEW_BEFORE_END_SECONDS = 30 * 24 * 60 * 60;

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, tv: user.tokenVersion ?? 0 }, process.env.JWT_SECRET, {
    expiresIn: user.role === 'employee' ? EMPLOYEE_TOKEN_TTL : process.env.JWT_EXPIRES_IN || '7d',
  });
}

// An employee token more than a week old, or within a month of running out (a
// 7-day one from before this, too), gets a fresh one with the response.
function shouldRenew(user, payload) {
  if (user.role !== 'employee') return false;
  const now = Date.now() / 1000;
  const old = typeof payload.iat === 'number' && now - payload.iat > RENEW_AFTER_SECONDS;
  const endingSoon = typeof payload.exp === 'number' && payload.exp - now < RENEW_BEFORE_END_SECONDS;
  return old || endingSoon;
}

module.exports = { signToken, shouldRenew };
