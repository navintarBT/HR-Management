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
}

export interface EmploymentType {
  _id: string;
  name: string;
}

export interface RestDayHistory {
  _id: string;
  employee: Employee | string;
  previousRestDay: number | null; // 0 = Sunday .. 6 = Saturday, null = had none set before
  newRestDay: number | null; // null = cleared to none
  changedBy?: Employee | string;
  changedByEmail?: string; // fallback identity when changedBy has no linked Employee (e.g. a pure admin account)
  createdAt: string;
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
  defaultRestDay?: number | null; // 0 = Sunday .. 6 = Saturday
  salary?: number | null;
  annualLeaveDays?: number | null;
  allowsSubstituteStatus?: boolean | null; // overrides Position.allowsSubstituteStatus when set
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
  appliedAt?: string;
  movedFromA?: number;
  movedFromB?: number;
  createdAt: string;
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

export type ShiftStatus = 'scheduled' | 'cancelled' | 'rest';

export interface Shift {
  _id: string;
  employee: Employee | string;
  position?: Position | string; // not set for a 'rest' entry
  category?: ShiftCategory | string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm — not set for a 'rest' entry
  endTime?: string; // HH:mm — not set for a 'rest' entry
  note?: string;
  status: ShiftStatus;
  holiday?: Holiday | string | null; // set when this 'rest' entry came from a company-wide holiday
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
