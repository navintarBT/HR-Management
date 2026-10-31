// Everything here reads and writes wall-clock times as Lao local time: the
// scanner sends "YYYY-MM-DD HH:mm:ss" with no zone (routes/adms.js), and day
// keys, shift start/end and lateness are built with new Date('…T08:00:00') /
// setHours (utils/attendanceProcessor.js). On a host running UTC every one of
// those lands 7 hours off — a 21:05 scan showed as 04:05 the next day. Pin
// the process to Lao time before anything touches a Date.
process.env.TZ = process.env.APP_TZ || 'Asia/Vientiane';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const departmentRoutes = require('./routes/departments');
const positionRoutes = require('./routes/positions');
const employmentTypeRoutes = require('./routes/employmentTypes');
const attendanceLogRoutes = require('./routes/attendanceLogs');
const attendanceDailyRoutes = require('./routes/attendanceDaily');
const attendanceActionRoutes = require('./routes/attendanceActions');
const leaveRoutes = require('./routes/leaves');
const overtimeRoutes = require('./routes/overtime');
const shiftRoutes = require('./routes/shifts');
const shiftSwapRoutes = require('./routes/shiftSwaps');
const positionSwapRoutes = require('./routes/positionSwaps');
const shiftCategoryRoutes = require('./routes/shiftCategories');
const holidayRoutes = require('./routes/holidays');
const medicineExpenseRoutes = require('./routes/medicineExpenses');
const dashboardRoutes = require('./routes/dashboard');
const restDayHistoryRoutes = require('./routes/restDayHistory');
const payrollCommentRoutes = require('./routes/payrollComments');
const scheduledShiftChangeRoutes = require('./routes/scheduledShiftChanges');
const shiftChangeLogRoutes = require('./routes/shiftChangeLogs');
const deviceUserRoutes = require('./routes/deviceUsers');
const employeeAccountRoutes = require('./routes/employeeAccounts');
const meEvidenceRoutes = require('./routes/meEvidence');
const evidenceRoutes = require('./routes/evidence');
const evidencePhotoRoutes = require('./routes/evidencePhoto');
const admsRoutes = require('./routes/adms');
const { runDueScheduledSwaps } = require('./utils/positionSwap');
const { runDueScheduledShiftChanges } = require('./utils/scheduledShiftChange');
const { markAbsentForMissedScans, relabelScannedLeaveDays } = require('./utils/attendanceProcessor');
const { deactivateEndedResignations } = require('./utils/employeeStatus');
const { lockUnlockedAbsences } = require('./utils/absenceSeverity');
const { migrateUserEmailIndex } = require('./utils/accounts');
const { unsetNullEmployeeKeys } = require('./utils/employeeKeys');
const { migrateRestDayHistory, applyDueRestDayChanges } = require('./utils/restDaySchedule');

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    exposedHeaders: ['X-Total-Count'],
  })
);
app.use(morgan('dev'));
app.use(express.json());
// nosniff stops a browser from executing a served file as something other than
// its declared Content-Type — defense in depth alongside the magic-byte check
// in routes/employees.js's photo upload (which is what actually prevents a
// non-image from landing in this directory in the first place).
app.use(
  '/api/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// ZKTeco ADMS (push protocol) lives at the device's fixed expected root path,
// not under /api — real terminals are hardcoded to hit /iclock/... directly.
app.use('/', admsRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/employment-types', employmentTypeRoutes);
app.use('/api/attendance-logs', attendanceLogRoutes);
app.use('/api/attendance-daily', attendanceDailyRoutes);
app.use('/api/attendance', attendanceActionRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/overtime', overtimeRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/shift-swaps', shiftSwapRoutes);
app.use('/api/position-swaps', positionSwapRoutes);
app.use('/api/shift-categories', shiftCategoryRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/medicine-expenses', medicineExpenseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/rest-day-history', restDayHistoryRoutes);
app.use('/api/payroll-comments', payrollCommentRoutes);
app.use('/api/scheduled-shift-changes', scheduledShiftChangeRoutes);
app.use('/api/shift-change-logs', shiftChangeLogRoutes);
app.use('/api/device-users', deviceUserRoutes);
app.use('/api/employee-accounts', employeeAccountRoutes);
app.use('/api/me', meEvidenceRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/evidence-photo', evidencePhotoRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Self-hosted install (deploy/windows): the same process also serves the built
// web app, so the whole system is one address on the shop network. Off unless
// CLIENT_DIST points at a client build (relative to the server folder, e.g.
// ../client/dist) — the Render deploy never sets it.
if (process.env.CLIENT_DIST) {
  const clientDist = path.resolve(__dirname, '..', process.env.CLIENT_DIST);
  app.use(express.static(clientDist));
  // The employees' own app (/me) is a page of its own; any other page path is
  // the HR app's own route.
  app.get(/^\/me(\/.*)?$/, (req, res) => res.sendFile(path.join(clientDist, 'me', 'index.html')));
  app.get(/^\/(?!api\/|iclock\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(async () => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
    console.log(`[server] timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}, now ${new Date().toString()}`);
    // Rest-day changes recorded before they carried their own effective date
    // get dated (the day each was made; someone's first setup applies from
    // the start) before anything reads them — the absence sweep below judges
    // each day by the rest day in force then. A no-op once done.
    await migrateRestDayHistory()
      .then((n) => n && console.log(`[rest-days] dated ${n} earlier rest-day changes`))
      .catch((err) => console.error('[rest-days] dating earlier changes failed', err));
    // Employees' own accounts have no email — the email index becomes unique
    // only among accounts that have one. A no-op once done.
    await migrateUserEmailIndex()
      .then((changed) => changed && console.log('[accounts] email index now allows accounts without an email'))
      .catch((err) => console.error('[accounts] updating the email index failed', err));
    // Scanner/employee codes cleared to null clash with each other on the
    // unique index — removed instead. A no-op once done.
    unsetNullEmployeeKeys()
      .then((n) => n && console.log(`[employees] removed ${n} empty (null) employee/scanner codes`))
      .catch((err) => console.error('[employees] removing null codes failed', err));
    // Absences recorded before tiers were stored on them get locked at the
    // tier the pages already showed — a no-op once that's done.
    lockUnlockedAbsences()
      .then((n) => n && console.log(`[attendance] locked the deduction tier on ${n} earlier absences`))
      .catch((err) => console.error('[attendance] locking absence tiers failed', err));
    // Leave days a scan had turned into a scan record go back to ລາ (the
    // scan kept and flagged) — a no-op once done.
    relabelScannedLeaveDays()
      .then((n) => n && console.log(`[attendance] put ${n} scanned leave days back to leave`))
      .catch((err) => console.error('[attendance] relabelling scanned leave days failed', err));
    // A rest-day change whose day has come switches Employee.defaultRestDay
    // (what "today" shows) — same catch-up-on-restart + periodic recheck as
    // the jobs below.
    applyDueRestDayChanges().catch((err) => console.error('[rest-days] startup check failed', err));
    setInterval(() => {
      applyDueRestDayChanges().catch((err) => console.error('[rest-days] scheduled check failed', err));
    }, 15 * 60 * 1000);
    // Catches any position swap scheduled for a date that's already arrived
    // (including while the server was down), then re-checks periodically so
    // one left running overnight still fires without anyone's browser open.
    runDueScheduledSwaps().catch((err) => console.error('[position-swaps] startup check failed', err));
    setInterval(() => {
      runDueScheduledSwaps().catch((err) => console.error('[position-swaps] scheduled check failed', err));
    }, 15 * 60 * 1000);
    runDueScheduledShiftChanges().catch((err) => console.error('[shift-changes] startup check failed', err));
    setInterval(() => {
      runDueScheduledShiftChanges().catch((err) => console.error('[shift-changes] scheduled check failed', err));
    }, 15 * 60 * 1000);
    // Same catch-up-on-restart + periodic-recheck pattern as the swap check
    // above — sweeps the last few days for anyone who never scanned at all
    // and has no rest/leave on file, marking them ຂາດວຽກ.
    markAbsentForMissedScans().catch((err) => console.error('[attendance] absent sweep startup check failed', err));
    setInterval(() => {
      markAbsentForMissedScans().catch((err) => console.error('[attendance] absent sweep scheduled check failed', err));
    }, 15 * 60 * 1000);
    deactivateEndedResignations().catch((err) => console.error('[employees] resignation sweep startup check failed', err));
    setInterval(() => {
      deactivateEndedResignations().catch((err) => console.error('[employees] resignation sweep scheduled check failed', err));
    }, 15 * 60 * 1000);
  })
  .catch((err) => {
    console.error('[server] failed to connect to MongoDB', err);
    process.exit(1);
  });
