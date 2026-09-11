import { Tag } from 'antd';
import type { AttendanceStatus, LeaveStatus, LeaveType, ShiftSwapStatus } from '../types';

const leaveStatusMap: Record<LeaveStatus, { label: string; color: string }> = {
  pending: { label: 'ລໍຖ້າອະນຸມັດ', color: 'gold' },
  approved: { label: 'ອະນຸມັດແລ້ວ', color: 'green' },
  rejected: { label: 'ບໍ່ອະນຸມັດ', color: 'red' },
};

const leaveTypeMap: Record<LeaveType, { label: string; color: string }> = {
  vacation: { label: 'ລາພັກຜ່ອນ', color: 'blue' },
  sick: { label: 'ລາເຈັບປ່ວຍ', color: 'volcano' },
  personal: { label: 'ລາກິດສ່ວນຕົວ', color: 'purple' },
};

const attendanceStatusMap: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: 'ມາເຮັດວຽກ', color: 'green' },
  late: { label: 'ມາຊ້າ', color: 'orange' },
  absent: { label: 'ຂາດງານ', color: 'red' },
  leave: { label: 'ລາ', color: 'purple' },
  incomplete: { label: 'ລືມສະແກນອອກ', color: 'default' },
};

export const LeaveStatusTag: React.FC<{ status: LeaveStatus }> = ({ status }) => {
  const item = leaveStatusMap[status];
  return <Tag color={item.color}>{item.label}</Tag>;
};

// Same pending/approved/rejected shape as leave requests — reuse the wording.
export const ShiftSwapStatusTag: React.FC<{ status: ShiftSwapStatus }> = ({ status }) => {
  const item = leaveStatusMap[status];
  return <Tag color={item.color}>{item.label}</Tag>;
};

export const LeaveTypeTag: React.FC<{ type: LeaveType }> = ({ type }) => {
  const item = leaveTypeMap[type];
  return <Tag color={item.color}>{item.label}</Tag>;
};

export const AttendanceStatusTag: React.FC<{ status: AttendanceStatus }> = ({ status }) => {
  const item = attendanceStatusMap[status];
  return <Tag color={item.color}>{item.label}</Tag>;
};

export const employeeStatusMap = {
  active: { label: 'ກໍາລັງເຮັດວຽກ', color: 'green' },
  inactive: { label: 'ພົ້ນສະພາບ', color: 'default' },
} as const;

export const EmployeeStatusTag: React.FC<{ status: 'active' | 'inactive' }> = ({ status }) => {
  const item = employeeStatusMap[status];
  return <Tag color={item.color}>{item.label}</Tag>;
};
