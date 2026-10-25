// Copies employee photos from the old server into this install's
// server/uploads — run by migrate-from-atlas.ps1 after the data is restored,
// so the photo paths are read from the (now local) database.
//   node deploy/windows/download-photos.js https://<old-server>/api
const fs = require('fs');
const path = require('path');

const serverDir = path.resolve(__dirname, '../../server');
require(path.join(serverDir, 'node_modules/dotenv')).config({ path: path.join(serverDir, '.env') });
const mongoose = require(path.join(serverDir, 'node_modules/mongoose'));

(async () => {
  const base = (process.argv[2] || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) {
    console.error('Usage: node download-photos.js https://<old-server>/api');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const employees = await mongoose.connection.db
    .collection('employees')
    .find({ photoUrl: { $nin: [null, ''] } }, { projection: { employeeCode: 1, photoUrl: 1 } })
    .toArray();
  let copied = 0;
  let present = 0;
  const missing = [];
  for (const e of employees) {
    // Only ever a file under uploads/ — never a path that could climb out of it.
    if (!/^\/uploads\/[\w.\-/]+$/.test(e.photoUrl) || e.photoUrl.includes('..')) {
      missing.push(`${e.employeeCode} (unexpected path ${e.photoUrl})`);
      continue;
    }
    const dest = path.join(serverDir, e.photoUrl);
    if (fs.existsSync(dest)) {
      present += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(base + e.photoUrl);
    if (!res.ok) {
      missing.push(`${e.employeeCode} (${res.status})`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    copied += 1;
  }
  console.log(`photos: ${copied} copied, ${present} already here, ${missing.length} not available`);
  if (missing.length) console.log(`not available: ${missing.join(', ')}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
