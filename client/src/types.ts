export type Role = 'admin' | 'manager' | 'employee';

export interface Department {
  _id: string;
  name: string;
  head?: Employee | string;
}

export interface Position {
  _id: string;
  name: string;
  departments?: (Department | string)[];
  head?: Employee | string;
  allowsSubstituteStatus?: boolean;
  restrictedRestDays?: number[];
  restDayFallback?: number | null;
  noAbsenceDays?: number[]; // 0 = Sunday .. 6 = Saturday — this position can never be absent on these days
  noAbsenceSeverity?: 'X2' | 'X3' | null; // deduction tier charged for an absence on a noAbsenceDays day
  ordinaryAbsenceSeverity?: 'X2' | 'X3' | null; // deduction tier for an absence on any OTHER day — independent of noAbsenceDays
}

export interface EmploymentType {
  _id: string;
  name: string;
}

export interface RestDayHistory {
  _id: string;
  employee: Employee | string;
  previousRestDay: number[]; // 0 = Sunday .. 6 = Saturday, [] = had none set before
  newRestDay: number[]; // [] = cleared to none
  effectiveDate?: string; // YYYY-MM-DD — first day newRestDay applies
  source?: string; // 'manual' | 'position-swap' | 'migration'
  appliedAt?: string | null; // null while still waiting for effectiveDate
  changedBy?: Employee | string;
  changedByEmail?: string; // fallback identity when changedBy has no linked Employee (e.g. a pure admin account)
  createdAt: string;
}

// The rest-day changes a page needs for a date range (GET /rest-day-history/schedule).
export interface RestDayScheduleRow {
  _id: string;
  employee: string;
  effectiveDate: string;
  previousRestDay: number[];
  newRestDay: number[];
  createdAt: string;
}

// What saving a recurring rest day would do (POST /rest-day-history/preview) —
// and, from the save itself, what it did.
export interface RestDayChangePlan {
  restDays: number[];
  redirected: boolean;
  effectiveDate: string;
  reason: 'thisWeek' | 'restedThisWeek' | 'newDayPassed';
  unchanged: boolean;
  replaces: { _id: string; effectiveDate: string; newRestDay: number[] }[];
  pending: { _id: string; effectiveDate: string; newRestDay: number[] }[];
  conflicts: { date: string; startTime?: string; endTime?: string }[];
  leavesAffected: number;
  leavesRecalculated?: number;
}

export interface Employee {
  _id: string;
  employeeCode?: string;
  firstName?: string;
  lastName?: string;
  department?: Department | string;
  position?: Position | string;
  supervisor?: Employee | string;
  positionHead?: Employee | string;
  hireDate?: string;
  terminationDate?: string | null;
  terminationReason?: string | null;
  employmentType?: EmploymentType | string;
  status: 'draft' | 'active' | 'inactive' | 'resigned' | 'suspended';
  deviceUserId?: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
  defaultShiftCategory?: ShiftCategory | string | null;
  defaultShiftStart?: string; // HH:mm — fallback for a manual time with no matching category
  defaultShiftEnd?: string; // HH:mm
  defaultRestDay?: number[] | null; // 0 = Sunday .. 6 = Saturday, usually one day but a role can rest several
  salary?: number | null;
  annualLeaveDays?: number | null;
  allowsSubstituteStatus?: boolean | null; // overrides Position.allowsSubstituteStatus when set
  // Individual overrides of the matching Position fields — empty/unset
  // inherits the position's rule; set non-empty to replace it for this one
  // person. See server/src/utils/restDayRules.js.
  restrictedRestDays?: number[];
  restDayFallback?: number | null;
  noAbsenceDays?: number[];
  noAbsenceSeverity?: 'X2' | 'X3' | null;
  ordinaryAbsenceSeverity?: 'X2' | 'X3' | null;
}

export interface Identity {
  id: string;
  email: string;
  role: Role;
  employee: Employee | null;
  mustChangePassword?: boolean;
}

export type AttendanceLogType = 'in' | 'out' | 'auto';

export interface AttendanceLog {
  _id: string;
  employee?: Employee | string;
  deviceUserId?: string;
  deviceId?: string;
  timestamp: string;
  type: AttendanceLogType;
}

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave' | 'incomplete' | 'substituted';

export interface AttendanceDaily {
  _id: string;
  employee: Employee | string;
  date: string;
  firstIn?: string | null;
  lastOut?: string | null;
  workedHours: number;
  expectedHours: number;
  lateMinutes: number;
  graceMinutes?: number | null; // the shift category's late policy in effect when this was computed — sizes the "ຊ້າ"/"ຊ້າເກີນ" label tiers, not a threshold that suppresses "late" itself
  severeLateMinutes?: number | null; // top-tier boundary in effect when this was computed
  earlyLeaveMinutes: number;
  otHours: number;
  status: AttendanceStatus;
  disciplinaryNote?: string | null; // set only when an admin/manager forced status='absent' as discipline — the reason given
  autoFilledReason?: string | null; // set only when an admin bulk-filled this day as 'present' because the scanning system itself was down
  // An absence's ວັນຫ້າມຂາດ / ມື້ທຳມະດາ tier, locked when it was recorded
  // (server/src/utils/absenceSeverity.js) — read this, don't recompute it from
  // today's rules. absenceSeveritySetAt null = not locked yet.
  absenceSeverity?: 'X2' | 'X3' | null;
  absenceSeveritySetAt?: string | null;
}

// One absence whose locked tier would change under today's rules — from
// POST /attendance-daily/absence-severity.
export interface AbsenceSeverityChange {
  _id: string;
  employee: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  from: 'X2' | 'X3' | null;
  to: 'X2' | 'X3' | null;
}

export type LeaveType = 'vacation' | 'sick' | 'personal';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface Leave {
  _id: string;
  employee: Employee | string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
  status: LeaveStatus;
  approver?: Employee | string;
  decidedAt?: string;
  deductDaysX1?: number | null;
  deductDaysX2?: number | null;
  billableDays?: number;
  deductAmount?: 'X0' | 'X1' | 'X2' | 'X3' | null;
  deductAmountTotal?: number | null;
  deductNote?: string | null;
  // Set when a rest-day change made the server work the days out again
  // (server/src/utils/leaveDeduction.js) — what changed, and when.
  recalcNote?: string | null;
  restDayOverlaps?: { date: string; type: 'personal' | 'holiday'; holidayName?: string }[];
  // Set only when this request's dates crossed the employee's own 1-year
  // tenure anniversary — the server splits it into two linked records
  // sharing the same splitGroupId (one 'before', one 'after' the
  // anniversary). null/unset for an ordinary, unsplit leave.
  splitGroupId?: string | null;
  splitPart?: 'before' | 'after' | null;
}

export type ScheduledPositionSwapStatus = 'pending' | 'applied' | 'cancelled';

export interface ScheduledPositionSwap {
  _id: string;
  positionA: Position | string;
  positionB: Position | string;
  effectiveDate: string; // YYYY-MM-DD
  status: ScheduledPositionSwapStatus;
  createdBy?: Employee | string;
  createdByEmail?: string;
  appliedAt?: string;
  movedFromA?: number;
  movedFromB?: number;
  createdAt: string;
}

// A PIN a scanner reports as enrolled (table=BIODATA) with no matching
// Employee.deviceUserId anywhere in our system — see
// server/src/routes/deviceUsers.js.
export interface OrphanedDeviceUser {
  id: string;
  serialNumber: string;
  pin: string;
  name?: string;
  lastSeenAt: string;
}

// What a scanner reports about itself (server: utils/zkProtocol.js parseDeviceOptions).
export interface ScannerDeviceInfo {
  deviceName?: string;
  firmware?: string;
  pushVersion?: string;
  platform?: string;
  ipAddress?: string;
  fpVersion?: number;
  faceVersion?: number;
  multiBioDataSupport?: string;
  userCount?: number;
  maxUsers?: number;
  fingerprintCount?: number;
  maxFingerprints?: number;
  faceCount?: number;
  maxFaces?: number;
  attLogCount?: number;
  maxAttLogs?: number;
}

export interface ScannerDevice {
  serialNumber: string;
  info: ScannerDeviceInfo;
  infoUpdatedAt?: string;
  syncEnabled: boolean;
  lastSeenAt?: string;
  lastGetRequestAt?: string;
  lastUnknownRequest: { method: string; path: string; receivedAt: string } | null;
  commands: { pending: number; sent: number; acked: number; failed: number };
  storedTemplates: { fingerprint: number; face: number };
  enrolledPins: number;
}

export interface EmployeeScannerStatus {
  pin: string | null;
  devices: {
    serialNumber: string;
    deviceName?: string;
    syncEnabled: boolean;
    enrolled: boolean;
    nameOnDevice?: string;
    reportedAt?: string;
  }[];
  templates: { type: number; no: number; majorVer?: number; sourceSerial?: string; updatedAt: string }[];
  pendingCommands: number;
}

export type ScheduledShiftChangeStatus = 'pending' | 'applied' | 'cancelled';

// A standing change to one employee's own default shift (ย้ายกะล่วงหน้า),
// scheduled ahead and applied automatically on effectiveDate — see
// server/src/utils/scheduledShiftChange.js.
export interface ScheduledShiftChange {
  _id: string;
  employee: Employee | string;
  newShiftCategory: ShiftCategory | string;
  effectiveDate: string; // YYYY-MM-DD
  status: ScheduledShiftChangeStatus;
  createdBy?: Employee | string;
  createdByEmail?: string;
  appliedAt?: string;
  createdAt: string;
}

// One change to an employee's regular shift and the day it took effect
// (server/src/models/ShiftChangeLog.js), as GET /shift-change-logs returns it.
export interface ShiftSnapshot {
  category?: string | null;
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm
}

export interface ShiftChangeLogEntry {
  _id: string;
  employee: string;
  effectiveDate: string; // YYYY-MM-DD — first day of `next`
  previous?: ShiftSnapshot;
  next?: ShiftSnapshot;
}

export type OvertimeStatus = 'pending' | 'approved' | 'rejected';

export interface Overtime {
  _id: string;
  employee: Employee | string;
  date: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  proposedBy?: Employee | string;
  reason?: string;
  status: OvertimeStatus;
  approver?: Employee | string;
  decidedAt?: string;
  note?: string;
}

export interface MedicineExpense {
  _id: string;
  employee: Employee | string;
  date: string;
  billDate?: string;
  items?: string;
  billAmount?: number;
  shopPayAmount?: number;
  note?: string;
}

export interface ShiftCategory {
  _id: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  color?: string;
  graceMinutes: number; // late by up to this many minutes shows the plain "ຊ້າ" label (no longer "present")
  autoAbsentMinutes?: number | null; // late beyond this many minutes is recorded as "absent" instead of "late"
  severeLateMinutes?: number; // late beyond this many minutes shows the most severe "ຊ້າເກີນ..." label
}

export type ShiftStatus = 'scheduled' | 'cancelled' | 'rest' | 'swapped';

export interface Shift {
  _id: string;
  employee: Employee | string;
  position?: Position | string; // not set for a 'rest'/'swapped' entry
  category?: ShiftCategory | string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm — not set for a 'rest'/'swapped' entry
  endTime?: string; // HH:mm — not set for a 'rest'/'swapped' entry
  note?: string;
  status: ShiftStatus;
  holiday?: Holiday | string | null; // set when this 'rest' entry came from a company-wide holiday
  coveringFor?: Employee | string | null; // set on a scheduled entry that covers someone else's shift
}

export interface Holiday {
  _id: string;
  date: string; // YYYY-MM-DD
  name: string; // occasion, e.g. "ວັນປີໃໝ່"
}

export type ShiftSwapStatus = 'pending' | 'approved' | 'rejected';

export interface ShiftSwapRequest {
  _id: string;
  requestedBy: Employee | string;
  fromShift: Shift | string;
  toEmployee?: Employee | string;
  toShift?: Shift | string;
  reason?: string;
  status: ShiftSwapStatus;
  approver?: Employee | string;
  decidedAt?: string;
}

export interface DashboardTodayShift {
  _id: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  employeeCode: string;
  positionName: string;
  attendanceStatus: AttendanceStatus | null;
}

export interface DashboardPendingApproval {
  _id: string;
  kind: 'leave' | 'swap';
  employeeName: string;
  createdAt: string;
  // leave
  leaveType?: LeaveType;
  startDate?: string;
  endDate?: string;
  // swap
  shiftDate?: string;
  shiftStart?: string;
  shiftEnd?: string;
  toEmployeeName?: string | null;
}

export interface PayrollComment {
  _id: string;
  employee: Employee | string;
  // A day-grid cell: `day:YYYY-MM-DD`. A summary column: `<columnName>:<rangeStartKey>_<rangeEndKey>`.
  column: string;
  text: string;
  author?: Employee | string;
  authorEmail?: string;
  createdAt: string;
  // Later messages on the same cell — one thread per cell.
  replies?: PayrollCommentReply[];
  // 'open' = ລໍຖ້າຢືນຢັນ (counted on the bell); 'resolved' = ຢືນຢັນແລ້ວ.
  status?: 'open' | 'resolved';
  resolvedAt?: string;
  resolvedBy?: Employee | string;
  resolvedByEmail?: string;
}

export interface PayrollCommentReply {
  _id: string;
  text: string;
  author?: Employee | string;
  authorEmail?: string;
  createdAt: string;
}

export interface DashboardSummary {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  onLeaveToday: number;
  absentToday: number;
  pendingLeaves: number;
  trend: Array<{ date: string; present: number; late: number; absent: number; leave: number }>;
  todayShifts: DashboardTodayShift[];
  pendingApprovals: DashboardPendingApproval[];
}

export interface DashboardOrgComposition {
  byDepartment: Array<{ name: string; count: number }>;
  byStatus: Array<{ status: Employee['status']; count: number }>;
}

export interface DashboardDataQuality {
  missingPosition: number;
  missingDepartment: number;
  missingHireDate: number;
  missingEmploymentType: number;
  missingEmail: number;
  missingReportingLine: number;
  missingRestDay: number;
  missingDeviceCode: number;
  stuckDrafts: number;
  resignedNoTerminationDate: number;
  missingPayInfo: number;
}
