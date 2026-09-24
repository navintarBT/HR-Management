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
const admsRoutes = require('./routes/adms');
const { runDueScheduledSwaps } = require('./utils/positionSwap');

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    exposedHeaders: ['X-Total-Count'],
  })
);
app.use(morgan('dev'));
app.use(express.json());
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));

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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
    // Catches any position swap scheduled for a date that's already arrived
    // (including while the server was down), then re-checks periodically so
    // one left running overnight still fires without anyone's browser open.
    runDueScheduledSwaps().catch((err) => console.error('[position-swaps] startup check failed', err));
    setInterval(() => {
      runDueScheduledSwaps().catch((err) => console.error('[position-swaps] scheduled check failed', err));
    }, 15 * 60 * 1000);
  })
  .catch((err) => {
    console.error('[server] failed to connect to MongoDB', err);
    process.exit(1);
  });
