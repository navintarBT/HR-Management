require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');
const User = require('./models/User');

// Creates (or updates the password/role of, if the email already exists) one
// login account directly — there's no public /register endpoint by design, so
// this is how an admin account gets its first user. Non-destructive: touches
// only the one User document matched by email, unlike the old seed script.
async function main() {
  const [, , email, password, role = 'admin'] = process.argv;
  if (!email || !password) {
    console.error('Usage: node src/createUser.js <email> <password> [role=admin|manager|employee]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  await connectDB();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { email: email.toLowerCase(), passwordHash, role },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`[createUser] ok: ${user.email} (${user.role})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
