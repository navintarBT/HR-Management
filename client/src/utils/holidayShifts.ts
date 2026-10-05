import { API_URL, axiosInstance } from '../providers/axios';
import type { Employee } from '../types';

// Sets every given employee's Shift to 'rest' for one date — overwriting
// whatever real shift they already had that day rather than creating a
// second, conflicting Shift row for the same employee/date. Pass a
// `holidayId` to tag the rows this creates/touches so they can be cleanly
// unwound later (see Holiday.beforeDelete on the server).
export async function applyRestDayToAll(dateStr: string, employees: Employee[], holidayId?: string) {
  const existingRes = await axiosInstance.get(`${API_URL}/shifts`, {
    params: { date_gte: dateStr, date_lte: dateStr, _end: 5000 },
  });
  const existingByEmployee: Record<string, string> = {};
  for (const s of existingRes.data as any[]) {
    const empId = s.employee && typeof s.employee === 'object' ? s.employee._id : s.employee;
    if (empId) existingByEmployee[empId] = s._id;
  }

  return Promise.allSettled(
    employees.map((emp) => {
      const existingId = existingByEmployee[emp._id];
      const payload = { status: 'rest', ...(holidayId ? { holiday: holidayId } : {}) };
      return existingId
        ? axiosInstance.patch(`${API_URL}/shifts/${existingId}`, payload)
        : axiosInstance.post(`${API_URL}/shifts`, { employee: emp._id, date: dateStr, ...payload });
    })
  );
}
