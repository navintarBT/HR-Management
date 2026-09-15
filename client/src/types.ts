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
}

export interface EmploymentType {
  _id: string;
  name: string;
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
  employmentType?: EmploymentType | string;
  status: 'draft' | 'active' | 'inactive' | 'resigned' | 'suspended';
  deviceUserId?: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
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

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave' | 'incomplete';

export interface AttendanceDaily {
  _id: string;
  employee: Employee | string;
  date: string;
  firstIn?: string | null;
  lastOut?: string | null;
  workedHours: number;
  lateMinutes: number;
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
}

export interface ShiftCategory {
  _id: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  color?: string;
  graceMinutes: number; // late by up to this many minutes still counts as "present"
  autoAbsentMinutes?: number | null; // late beyond this many minutes is recorded as "absent" instead of "late"
}

export type ShiftStatus = 'scheduled' | 'cancelled';

export interface Shift {
  _id: string;
  employee: Employee | string;
  position: Position | string;
  category?: ShiftCategory | string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  note?: string;
  status: ShiftStatus;
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
