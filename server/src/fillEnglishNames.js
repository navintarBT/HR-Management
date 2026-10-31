require('dotenv').config();
const fs = require('fs');
const path = require('path');
const connectDB = require('./config/db');
const Employee = require('./models/Employee');
const Device = require('./models/Device');
const { englishNameFor } = require('./utils/laoRomanize');
const { buildUserInfoCommand } = require('./utils/zkProtocol');
const { queueCommandsForDevice } = require('./utils/deviceCommands');
const { APPROVED_DEVICE_FILTER } = require('./utils/deviceApproval');
const { allowsScanner } = require('./utils/scannerAccess');

// Gives everyone without an English name (Employee.nameEn) one written from
// their Lao name, karaoke style — the scanners can't display Lao. Looks before
// it writes: on its own it only prints the list and saves it to
// english-names.csv for checking. With --apply it saves the names and sends
// them to the sync-enabled scanners. Never touches a name already set.
//
//   node src/fillEnglishNames.js            (look)
//   node src/fillEnglishNames.js --apply    (save + send to scanners)
async function main() {
  const apply = process.argv.includes('--apply');
  await connectDB();

  const [total, active] = await Promise.all([Employee.countDocuments(), Employee.countDocuments({ status: 'active' })]);
  const missing = await Employee.find({ $or: [{ nameEn: { $exists: false } }, { nameEn: null }, { nameEn: '' }] })
    .select('employeeCode deviceUserId firstName lastName status allowedScanners')
    .sort({ employeeCode: 1 })
    .lean();
  const rows = missing.map((e) => ({ employee: e, nameEn: englishNameFor(e.firstName, e.lastName) }));
  const unnamed = rows.filter((r) => !r.nameEn);

  console.log(`พนักงานทั้งหมด ${total} คน (ใช้งาน ${active}) — ยังไม่มีชื่ออังกฤษ ${rows.length} คน`);
  console.log('');
  for (const { employee: e, nameEn } of rows) {
    const lao = [e.firstName, e.lastName].filter(Boolean).join(' ');
    console.log(`${String(e.employeeCode ?? '-').padEnd(6)} ${String(e.status).padEnd(9)} ${lao}  ->  ${nameEn || '(แปลงไม่ได้ — ต้องใส่เอง)'}`);
  }

  // UTF-8 with a BOM so Excel shows the Lao column properly.
  const csvPath = path.resolve('english-names.csv');
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [['code', 'status', 'lao', 'english'].join(',')]
    .concat(rows.map(({ employee: e, nameEn }) => [e.employeeCode, e.status, [e.firstName, e.lastName].filter(Boolean).join(' '), nameEn].map(quote).join(',')))
    .join('\r\n');
  fs.writeFileSync(csvPath, `﻿${csv}\r\n`);
  console.log('');
  console.log(`บันทึกรายชื่อไว้ที่ ${csvPath}`);
  if (unnamed.length) console.log(`${unnamed.length} คนแปลงไม่ได้ — ใส่ชื่ออังกฤษเองในหน้าแก้พนักงาน`);

  if (!apply) {
    console.log('');
    console.log('ยังไม่ได้บันทึกอะไร — ตรวจรายชื่อแล้วรันอีกครั้งพร้อม --apply เพื่อบันทึก');
    process.exit(0);
  }

  const named = rows.filter((r) => r.nameEn);
  // Only where it's still missing — someone HR named in the meantime keeps theirs.
  const result = await Employee.bulkWrite(
    named.map(({ employee: e, nameEn }) => ({
      updateOne: {
        filter: { _id: e._id, $or: [{ nameEn: { $exists: false } }, { nameEn: null }, { nameEn: '' }] },
        update: { $set: { nameEn } },
      },
    }))
  );
  console.log('');
  console.log(`บันทึกชื่ออังกฤษแล้ว ${result.modifiedCount} คน`);

  // Just the name on each scanner they're allowed on — the face/finger there stays as it is.
  const onScanners = named.filter(({ employee: e }) => e.status === 'active' && e.deviceUserId);
  const devices = await Device.find({ syncEnabled: true, ...APPROVED_DEVICE_FILTER });
  for (const device of devices) {
    // eslint-disable-next-line no-await-in-loop
    const queued = await queueCommandsForDevice(
      device,
      onScanners.filter(({ employee: e }) => allowsScanner(e, device.serialNumber)).map(({ employee: e, nameEn }) => ({
        command: buildUserInfoCommand({ pin: e.deviceUserId, name: nameEn }),
        pin: e.deviceUserId,
        employeeId: e._id,
      }))
    );
    console.log(`เครื่อง ${device.serialNumber}: ตั้งคิวส่งชื่อใหม่ ${queued.length} คน`);
  }
  if (!devices.length) console.log('ไม่มีเครื่องที่เปิดซิงค์ — ชื่อจะไปถึงเครื่องตอนเปิดซิงค์');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
