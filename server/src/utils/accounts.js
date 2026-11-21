const User = require('../models/User');

// Users' email index used to be a plain unique one, back when every account
// had an email. An employee's own account has none, so it's now unique only
// among accounts that do (models/User.js) — the old index is swapped for the
// new one once, at startup. A no-op once done.
async function migrateUserEmailIndex() {
  const indexes = await User.collection.indexes().catch(() => []);
  const old = indexes.find((i) => i.name === 'email_1' && !i.partialFilterExpression);
  if (old) await User.collection.dropIndex('email_1');
  await User.createIndexes();
  return !!old;
}

// An employee's own account for the ROMEO app — the one role 'employee'
// account linked to them (an admin/manager account linked to the same person
// is a separate thing and is never touched by the app's flows).
function employeeAccountOf(employeeId) {
  return User.findOne({ employeeId, role: 'employee' });
}

module.exports = { migrateUserEmailIndex, employeeAccountOf };
