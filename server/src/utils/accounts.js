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

// The app account's own rules — the same whether the employee registers
// (routes/auth.js) or an admin edits the account (routes/employeeAccounts.js).
const EMPLOYEE_MIN_PASSWORD = 6;
// English letters and digits (plus . _ -), starting with a letter, so a
// username never looks like an employee code at sign-in.
const USERNAME_RULE = /^[a-z][a-z0-9._-]{2,29}$/;
const USERNAME_RULE_MESSAGE = 'ຊື່ຜູ້ໃຊ້ຕ້ອງເປັນຕົວອັກສອນອັງກິດ ຫຼື ຕົວເລກ 3–30 ໂຕ ຂຶ້ນຕົ້ນດ້ວຍຕົວອັກສອນ ແລະ ບໍ່ມີຍະຫວ່າງ — ຕົວຢ່າງ: somphone';
const USERNAME_TAKEN = 'ຊື່ຜູ້ໃຊ້ນີ້ມີຄົນໃຊ້ແລ້ວ — ລອງຊື່ອື່ນ';

module.exports = {
  migrateUserEmailIndex,
  employeeAccountOf,
  EMPLOYEE_MIN_PASSWORD,
  USERNAME_RULE,
  USERNAME_RULE_MESSAGE,
  USERNAME_TAKEN,
};
