import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { List, useSelect } from '@refinedev/antd';
import { useList } from '@refinedev/core';
import { Table, DatePicker, Button, Space, Typography, Select, Card, Divider, message } from 'antd';
import { LeftOutlined, RightOutlined, DownloadOutlined, HomeOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Employee, Shift, Leave, Overtime, Department, Position } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker } = DatePicker;

const LAO_MONTHS = [
  'ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ',
  'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ',
];
// Indexed by dayjs's .day() (0 = Sunday .. 6 = Saturday) — short enough to
// fit the print table's narrow per-day header cells alongside the date number.
const LAO_WEEKDAYS_SHORT = ['ອາ', 'ຈ', 'ອັງ', 'ພຸ', 'ພະ', 'ສຸ', 'ເສ'];
const MAX_RANGE_DAYS = 31;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// Leave.startDate/endDate are Mongoose Dates, so the API serializes them as
// full ISO datetimes ("2026-09-23T00:00:00.000Z") — comparing that directly
// against a plain "YYYY-MM-DD" key as strings breaks right on the leave's own
// boundary dates: "...T00:00:00.000Z" sorts AFTER the bare date it represents
// (a longer string with a matching prefix is lexicographically greater), so
// `startDate <= dateKey` silently fails on exactly the leave's first day.
// Normalizing both sides to plain date keys first avoids that trap.
function toDateKey(value: string) {
  return dayjs(value).format('YYYY-MM-DD');
}

function resignedNote(emp: Employee) {
  if (emp.status !== 'resigned' || !emp.terminationDate) return null;
  const reason = emp.terminationReason ? ` (${emp.terminationReason})` : '';
  return `ລາອອກ ${dayjs(emp.terminationDate).format('DD/MM/YYYY')}${reason}`;
}

// Hours between an approved Overtime record's startTime/endTime, crediting a
// crossed midnight (endTime <= startTime) as running into the next day —
// same "overnight" convention as a shift's own start/end.
function otHoursOf(ot: Overtime): number {
  const [sh, sm] = ot.startTime.split(':').map(Number);
  const [eh, em] = ot.endTime.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

interface SummaryRow {
  employee: Employee;
  workDays: number;
  restDays: number;
  x1: number;
  x2: number;
  x3: number;
  grace: number;
  totalDays: number;
  otHours: number;
  otDays: number;
}

type DayStatus = 'work' | 'rest' | 'leave' | 'future';

// One-letter day-cell scheme, shared by the on-screen grid and the print
// table, with 'leave' split out by which deduction tier the covering Leave
// record carries — same tiers as the x1/x2/x3/ป summary columns — so a day
// cell reads as which rate it's billed at, not just "on leave". 'future' is
// a day that hasn't happened yet — never counted as "work" just because
// nothing else matched.
type PrintDayState = 'work' | 'rest' | 'graceLeave' | 'x1Leave' | 'x2Leave' | 'x3Leave' | 'future' | 'out';
type SummaryTone = 'work' | 'rest' | 'x1' | 'x2' | 'x3' | 'grace';

const SUMMARY_TONE: Record<SummaryTone, { bg: string; text: string }> = {
  work: { bg: '#52c41a', text: '#ffffff' },
  rest: { bg: '#d9d9d9', text: '#434343' },
  x1: { bg: '#ffccc7', text: '#a8071a' },
  x2: { bg: '#ff7875', text: '#ffffff' },
  x3: { bg: '#cf1322', text: '#ffffff' },
  grace: { bg: '#e6f4ff', text: '#1677ff' },
};

const toneColors = (tone: SummaryTone) => ({
  background: SUMMARY_TONE[tone].bg,
  color: SUMMARY_TONE[tone].text,
  fontWeight: 600,
});

const toneStyle = (value: number, tone: SummaryTone) => (value > 0 ? toneColors(tone) : undefined);

const PRINT_DAY_STYLE: Record<PrintDayState, { bg: string; text: string; label: string; zoom?: number }> = {
  work: { bg: SUMMARY_TONE.work.bg, text: SUMMARY_TONE.work.text, label: 'ມ', zoom: 1.3 },
  rest: { bg: SUMMARY_TONE.rest.bg, text: SUMMARY_TONE.rest.text, label: 'ພ' },
  graceLeave: { bg: SUMMARY_TONE.grace.bg, text: SUMMARY_TONE.grace.text, label: 'ປ' },
  x1Leave: { bg: SUMMARY_TONE.x1.bg, text: SUMMARY_TONE.x1.text, label: '1' },
  x2Leave: { bg: SUMMARY_TONE.x2.bg, text: SUMMARY_TONE.x2.text, label: '2' },
  x3Leave: { bg: SUMMARY_TONE.x3.bg, text: SUMMARY_TONE.x3.text, label: '3' },
  out: { bg: '#fff1f0', text: '#cf1322', label: '-' },
  future: { bg: '#fafafa', text: '#bfbfbf', label: '-' },
};
const PRINT_DAY_LEGEND_TEXT: Record<PrintDayState, string> = {
  work: 'ມາເຮັດວຽກ',
  rest: 'ພັກ',
  graceLeave: 'ລາ (ຍັງຟຣີ)',
  x1Leave: 'ລາ (ຕັດ x1)',
  x2Leave: 'ລາ (ຕັດ x2)',
  x3Leave: 'ລາ (ຕັດ x3)',
  out: 'ລາອອກແລ້ວ',
  future: 'ຍັງບໍ່ເຖິງວັນ',
};

// Plain, undistorted borders for the print-only table — a real <table> with
// real per-cell borders instead of AntD's Table (which, once forced through
// a CSS transform to fit the page width, warped the glyphs and lost its
// fixed-column header's per-page repeat). No JS-computed scaling here: if a
// full month's columns still don't fit, the browser's own print-dialog
// "fit to page width" option handles it losslessly, without hand-rolled math.
const PRINT_TH: CSSProperties = {
  border: '1px solid #999',
  padding: '2px 3px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  background: '#FBF3E0',
  color: '#5C4315',
  fontWeight: 600,
};
const PRINT_TD: CSSProperties = {
  border: '1px solid #ccc',
  padding: '2px 3px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

// A4 landscape printable width at the 96dpi CSS reference pixel, minus a 5mm
// @page margin on each side.
const PRINT_PAGE_WIDTH_PX = ((297 - 10) / 25.4) * 96;
// Sum of every print-table column's width EXCEPT the day columns (ລ/ດ 22 +
// ລະຫັດ 42 + ຊື່ 110 + ມາ 38 + ພັກ 32 + x1/x2/x3/ປ 22×4 + ລວມ 38 + ຊ/ມx3 34 +
// ມື້x2 34). Day columns split whatever width is left over this many ways —
// see dayColWidth below — so the printed table always spans exactly one page
// width no matter how many days are in the selected range, instead of a
// fixed per-day width that overflows once the range gets long enough.
const PRINT_FIXED_COLS_WIDTH_PX = 22 + 42 + 110 + 38 + 32 + 22 * 4 + 38 + 34 + 34;
const PRINT_MIN_DAY_COL_WIDTH_PX = 6;

// Sends a per-employee attendance/leave rollup to ການເງິນ for payroll. Day-by-day
// bucketing mirrors AttendanceLogsPage's isRestDay precedence (a queued 'scheduled'
// override always wins, then 'rest'/'swapped' overrides, then the recurring
// defaultRestDay) so this page never disagrees with what ປະຫວັດການສະແກນ shows for
// the same date. x1/x2/x3/ป read straight off ການລາ's own deduction-tier fields
// (deductDaysX1 grouped by which deductAmount tier the request carries, deductDaysX2
// for the free-grace bucket) rather than recomputing anything — a leave that
// straddles the edge of the selected range is counted by its full stored total, not
// prorated to just the days inside range, same as ตาราง leaves already treats it.
// ຊ/ມ x3 ແລະ ມື້ x2 have no wired-up rule yet (2026-09-28 conversation: user deferred
// the exact formula) so they're plain manual-entry cells, not computed.
const PayrollSummaryGrid: React.FC = () => {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');
  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

  const days = useMemo(() => {
    const count = range[1].startOf('day').diff(range[0].startOf('day'), 'day') + 1;
    return Array.from({ length: Math.max(count, 0) }, (_, i) => range[0].add(i, 'day'));
  }, [range]);

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status_in', operator: 'eq', value: 'active,resigned' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [personFilter, setPersonFilter] = useState<string>();

  const { selectProps: departmentSelect, query: departmentQuery } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allDepartments = departmentQuery?.data?.data ?? [];
  const { selectProps: positionSelect, query: positionQuery } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allPositions = positionQuery?.data?.data ?? [];
  const positionOptionsForDepartment = useMemo(() => {
    if (!departmentFilter) return undefined;
    return allPositions
      .filter((p) => (p.departments ?? []).some((d) => idOf(d) === departmentFilter))
      .map((p) => ({ label: p.name, value: p._id }));
  }, [allPositions, departmentFilter]);

  const employees = useMemo(
    () =>
      allEmployees.filter((e) => {
        if (departmentFilter && idOf(e.department) !== departmentFilter) return false;
        if (positionFilter && idOf(e.position) !== positionFilter) return false;
        if (personFilter && e._id !== personFilter) return false;
        return true;
      }),
    [allEmployees, departmentFilter, positionFilter, personFilter]
  );

  // Options narrow along with department/position so a person can't be picked
  // outside whatever's already selected above.
  const personOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => (!departmentFilter || idOf(e.department) === departmentFilter) && (!positionFilter || idOf(e.position) === positionFilter))
        .map((e) => ({ label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(), value: e._id })),
    [allEmployees, departmentFilter, positionFilter]
  );

  const selectedDepartment = allDepartments.find((d) => d._id === departmentFilter);
  const selectedPosition = allPositions.find((p) => p._id === positionFilter);
  const selectedPerson = allEmployees.find((e) => e._id === personFilter);

  const periodLabel = useMemo(() => {
    const isFullMonth = range[0].isSame(range[0].startOf('month'), 'day') && range[1].isSame(range[0].endOf('month'), 'day');
    if (isFullMonth) return `ປະຈໍາເດືອນ ${LAO_MONTHS[range[0].month()]} ${range[0].year()}`;
    return `ປະຈໍາວັນທີ ${range[0].format('DD/MM/YYYY')} - ${range[1].format('DD/MM/YYYY')}`;
  }, [range]);

  const printTitle = useMemo(() => {
    let base = 'ລາຍຊື່ພະນັກງານ';
    if (!selectedDepartment && !selectedPosition && !selectedPerson) {
      base += 'ທັງໝົດ';
    } else {
      if (selectedDepartment) base += selectedDepartment.name;
      if (selectedPosition) base += selectedPosition.name;
      if (selectedPerson) base += `${selectedPerson.firstName ?? ''} ${selectedPerson.lastName ?? ''}`;
    }
    return `${base} ${periodLabel}`;
  }, [selectedDepartment, selectedPosition, selectedPerson, periodLabel]);

  // Splits whatever width is left (after the fixed columns) evenly across
  // however many days are in range, so the printed table always spans
  // exactly one page width — a full month, two months, doesn't matter — the
  // bars just get thinner instead of the table overflowing the page.
  const printDayColWidth = Math.max(
    PRINT_MIN_DAY_COL_WIDTH_PX,
    (PRINT_PAGE_WIDTH_PX - PRINT_FIXED_COLS_WIDTH_PX) / Math.max(days.length, 1)
  );
  const printTotalColumns = 3 + days.length + 9;

  const { data: scheduledShiftsData, isLoading: scheduledLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'scheduled' },
    ],
    pagination: { pageSize: 5000 },
  });
  const { data: restShiftsData, isLoading: restLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'rest' },
    ],
    pagination: { pageSize: 5000 },
  });
  const { data: swappedShiftsData, isLoading: swappedLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'swapped' },
    ],
    pagination: { pageSize: 5000 },
  });
  // No startDate/endDate filter here — leaves.js's own list route doesn't
  // support _gte/_lte (unlike the crudFactory-backed shifts route above), so
  // every approved leave is fetched once and matched against the range client-side.
  const { data: leavesData, isLoading: leavesLoading } = useList<Leave>({
    resource: 'leaves',
    filters: [{ field: 'status', operator: 'eq', value: 'approved' }],
    pagination: { pageSize: 5000 },
  });
  const leaves = leavesData?.data ?? [];

  // ຊ/ມ x3 (OT hours) / ມື້ x2 (OT days) — overtime.js's route DOES support
  // _gte/_lte (unlike leaves.js above), so this can filter server-side.
  const { data: overtimeData, isLoading: overtimeLoading } = useList<Overtime>({
    resource: 'overtime',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'approved' },
    ],
    pagination: { pageSize: 5000 },
  });
  const overtimeRecords = overtimeData?.data ?? [];

  const scheduledSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of scheduledShiftsData?.data ?? []) {
      if (!s.employee) continue;
      set.add(`${idOf(s.employee)}_${s.date}`);
    }
    return set;
  }, [scheduledShiftsData?.data]);
  const restSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of restShiftsData?.data ?? []) {
      if (!s.employee) continue;
      set.add(`${idOf(s.employee)}_${s.date}`);
    }
    return set;
  }, [restShiftsData?.data]);
  const swappedSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of swappedShiftsData?.data ?? []) {
      if (!s.employee) continue;
      set.add(`${idOf(s.employee)}_${s.date}`);
    }
    return set;
  }, [swappedShiftsData?.data]);

  // Groups approved OT records per employee — ມື້ x2 counts the distinct
  // dates (one OT day can only be logged once per employee/date in practice,
  // but grouping by date rather than by record count is the safe read
  // either way), ຊ/ມ x3 sums their hours.
  const overtimeByEmployee = useMemo(() => {
    const map: Record<string, Overtime[]> = {};
    for (const ot of overtimeRecords) {
      if (!ot.employee) continue;
      const empId = idOf(ot.employee)!;
      (map[empId] ??= []).push(ot);
    }
    return map;
  }, [overtimeRecords]);

  const findCoveringLeave = (emp: Employee, dateKey: string) =>
    leaves.find((l) => idOf(l.employee) === emp._id && toDateKey(l.startDate) <= dateKey && toDateKey(l.endDate) >= dateKey);

  // Pay runs only up to the resignation date; days after it count as neither
  // work nor rest.
  const afterResignation = (emp: Employee, dateKey: string) =>
    emp.status === 'resigned' && !!emp.terminationDate && dateKey > toDateKey(emp.terminationDate);

  // Single source of truth for "what was this employee doing on this day" —
  // used both for the totals below and for the day-by-day grid, so the two
  // views can never disagree with each other. An approved leave is checked
  // FIRST, ahead of any Shift override — this matches the real attendance
  // pipeline, where approving a leave stamps AttendanceDaily.status='leave'
  // directly (markApprovedLeaveDays → markLeave) regardless of whatever shift
  // happens to be queued for that date; a 'scheduled' override landing on an
  // already-approved leave day is a scheduling conflict the leave still wins
  // (the employee isn't coming in either way), not a reason to show "work".
  // A leave day is only really "on leave" if it ISN'T one of that leave's own
  // restDayOverlaps — leaves.js computes that per date (personal rest day or
  // a company holiday) and excludes those days from billableDays for the
  // same reason: a day that was never really worked anyway isn't "taken off"
  // as leave, so it must render as ພັກ/ຮ້ານປິດ here too. Outside of any leave,
  // the precedence falls back to AttendanceLogsPage's isRestDay: a queued
  // 'scheduled' override wins over what would otherwise be a rest day, then
  // 'rest'/'swapped', then the recurring weekly default.
  const classifyDay = (emp: Employee, dateKey: string, dow: number): DayStatus => {
    if (afterResignation(emp, dateKey)) return 'future';
    const coveringLeave = findCoveringLeave(emp, dateKey);
    if (coveringLeave) {
      const isRestOverlap = (coveringLeave.restDayOverlaps ?? []).some((o) => o.date === dateKey);
      return isRestOverlap ? 'rest' : 'leave';
    }
    const key = `${emp._id}_${dateKey}`;
    if (scheduledSet.has(key)) return 'work';
    if (restSet.has(key) || swappedSet.has(key)) return 'rest';
    if (emp.defaultRestDay === dow) return 'rest';
    // Nothing is actually known/decided for this date yet — a queued shift,
    // a rest override, a leave, or the recurring default would all have
    // already matched above (and are shown as such even when the date is in
    // the future, since those ARE known in advance). Only the "presumably
    // just a plain work day" guess is wrong for a day that hasn't happened
    // yet — there's nothing to presume, so it stays blank instead.
    return dayjs(dateKey).isAfter(dayjs(), 'day') ? 'future' : 'work';
  };

  // Same precedence as classifyDay, but for a 'leave' day it also looks up
  // which Leave record covers this date to report its deductAmount tier —
  // that's not needed for the work/rest/leave totals above, only for the
  // print table's per-day letter.
  const printDayState = (emp: Employee, dateKey: string, dow: number): PrintDayState => {
    if (afterResignation(emp, dateKey)) return 'out';
    const status = classifyDay(emp, dateKey, dow);
    if (status !== 'leave') return status;
    const coveringLeave = findCoveringLeave(emp, dateKey);
    if (coveringLeave?.deductAmount === 'X1') return 'x1Leave';
    if (coveringLeave?.deductAmount === 'X2') return 'x2Leave';
    if (coveringLeave?.deductAmount === 'X3') return 'x3Leave';
    return 'graceLeave';
  };

  const rows = useMemo<SummaryRow[]>(() => {
    return employees.map((emp) => {
      let workDays = 0;
      let restDays = 0;
      let leaveDays = 0;
      let futureDays = 0;

      for (const day of days) {
        const dateKey = day.format('YYYY-MM-DD');
        const status = classifyDay(emp, dateKey, day.day());
        if (status === 'work') workDays += 1;
        else if (status === 'rest') restDays += 1;
        else if (status === 'future') futureDays += 1;
        else leaveDays += 1;
      }

      const empLeaves = leaves.filter(
        (l) => idOf(l.employee) === emp._id && toDateKey(l.startDate) <= rangeEndKey && toDateKey(l.endDate) >= rangeStartKey
      );
      let x1 = 0;
      let x2 = 0;
      let x3 = 0;
      let grace = 0;
      for (const l of empLeaves) {
        grace += l.deductDaysX2 ?? 0;
        const chargeableDays = l.deductDaysX1 ?? 0;
        if (l.deductAmount === 'X1') x1 += chargeableDays;
        else if (l.deductAmount === 'X2') x2 += chargeableDays;
        else if (l.deductAmount === 'X3') x3 += chargeableDays;
      }

      // Same rule as OvertimeSummaryPage's own "ນັບເປັນມື້ (24 ຊມ./ມື້)"
      // column: a ມື້ is a full 24-hour block of accumulated OT, not a
      // calendar day that happened to have any OT logged on it — 10 hours
      // total is 0 ມື້, not 1, no matter how many separate OT entries or
      // distinct dates it's split across.
      const empOvertime = overtimeByEmployee[emp._id] ?? [];
      const otHours = empOvertime.reduce((sum, ot) => sum + otHoursOf(ot), 0);
      const otDays = Math.floor(otHours / 24);

      return { employee: emp, workDays, restDays, x1, x2, x3, grace, totalDays: workDays + restDays + leaveDays + futureDays, otHours, otDays };
    });
  }, [employees, days, scheduledSet, restSet, swappedSet, leaves, overtimeByEmployee, rangeStartKey, rangeEndKey]);

  const exportCsv = () => {
    const header = ['ລະຫັດ', 'ຊື່', 'ມາເຮັດວຽກ', 'ພັກ', 'x1', 'x2', 'x3', 'ປ', 'ວັນທັງໝົດ', 'ຊ/ມ x3', 'ມື້ x2'];
    const lines = rows.map((r) => {
      const name = `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`.trim();
      return [
        r.employee.employeeCode ?? '',
        name,
        r.workDays,
        r.restDays,
        r.x1,
        r.x2,
        r.x3,
        r.grace,
        r.totalDays,
        r.otHours,
        r.otDays,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-summary_${rangeStartKey}_${rangeEndKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();
  const loading = employeesLoading || scheduledLoading || restLoading || swappedLoading || leavesLoading || overtimeLoading;

  const handlePrintClick = () => window.print();

  return (
    <div>
      <style>{`
        .payroll-print-only { display: none; }
        .payroll-print-table { display: none; }
        .payroll-resigned-row > td { border-top: 1px solid #cf1322 !important; border-bottom: 1px solid #cf1322 !important; }
        .payroll-resigned-row > td:first-child { border-left: 2px solid #cf1322 !important; }
        @media print {
          @page { size: A4 landscape; margin: 5mm; }
          .payroll-no-print { display: none !important; }
          .payroll-print-only { display: flex !important; }
          .payroll-print-table { display: table !important; }
          /* Chrome/Edge drop background colors on print by default — without
             this, the day-status colors and the header row tint would all
             print as plain white. */
          .payroll-print-table, .payroll-print-table *, .payroll-print-only, .payroll-print-only * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body:has(.payroll-print-table) .ant-layout-header { display: none !important; }
          body:has(.payroll-print-table) .ant-page-header-heading { display: none !important; }
        }
      `}</style>
      <div ref={toolbarRef} className="payroll-no-print" style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Link to="/">
              <Button icon={<HomeOutlined />}>ໜ້າຫຼັກ</Button>
            </Link>
            <Button icon={<LeftOutlined />} onClick={() => goToMonth(range[0].subtract(1, 'month'))} />
            <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
            <Button icon={<RightOutlined />} onClick={() => goToMonth(range[0].add(1, 'month'))} />
            <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
            <RangePicker
              value={range}
              onChange={(v) => {
                if (!v || !v[0] || !v[1]) return;
                let [start, end] = v;
                const spanDays = end.startOf('day').diff(start.startOf('day'), 'day') + 1;
                if (spanDays > MAX_RANGE_DAYS) {
                  end = start.add(MAX_RANGE_DAYS - 1, 'day');
                  message.warning(`ເລືອກຊ່ວງວັນທີໄດ້ສູງສຸດ ${MAX_RANGE_DAYS} ວັນ`);
                }
                setRange([start, end]);
              }}
              format="DD/MM/YYYY"
              allowClear={false}
            />
            <Select
              {...departmentSelect}
              placeholder="ກອງຕາມພະແນກ"
              allowClear
              style={{ width: 180 }}
              value={departmentFilter}
              onChange={(v: any) => {
                setDepartmentFilter(v);
                const stillValid = !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some((d) => idOf(d) === v);
                if (!stillValid) setPositionFilter(undefined);
                if (v && personFilter && idOf(allEmployees.find((e) => e._id === personFilter)?.department) !== v) setPersonFilter(undefined);
              }}
            />
            <Select
              {...positionSelect}
              options={positionOptionsForDepartment}
              placeholder="ກອງຕາມຕຳແໜ່ງ"
              allowClear
              style={{ width: 180 }}
              value={positionFilter}
              onChange={(v: any) => {
                setPositionFilter(v);
                if (v && personFilter && idOf(allEmployees.find((e) => e._id === personFilter)?.position) !== v) setPersonFilter(undefined);
              }}
            />
            <Select
              showSearch
              options={personOptions}
              filterOption={(input, option) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="ກອງຕາມບຸກຄົນ"
              allowClear
              style={{ width: 200 }}
              value={personFilter}
              onChange={(v: any) => setPersonFilter(v)}
            />
            <Button icon={<PrinterOutlined />} onClick={handlePrintClick}>
              ພິມ
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportCsv}>
              ສົ່ງອອກ CSV
            </Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            x1/x2/x3/ປ = ມາຈາກໜ້າ "ການລາ" (x1-x3 = ມື້ລາທີ່ຕັດເງິນ ແຍກຕາມອັດຕາ 1/2/3 ເທົ່າ, ປ = ມື້ລາທີ່ຍັງຟຣີ) &nbsp;|&nbsp; ຊ/ມ x3 = ຊົ່ວໂມງ OT ທັງໝົດ (ຈາກໜ້າ OT ທີ່ອະນຸມັດແລ້ວ), ມື້ x2 = ຈຳນວນມື້ທີ່ມີ OT
          </Typography.Text>
          <Space size={[14, 6]} wrap>
            {(Object.keys(PRINT_DAY_STYLE) as PrintDayState[]).map((state) => (
              <Space key={state} size={6}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: PRINT_DAY_STYLE[state].bg,
                    color: PRINT_DAY_STYLE[state].text,
                    border: `1px solid ${PRINT_DAY_STYLE[state].text}`,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {PRINT_DAY_STYLE[state].label}
                </span>
                <Typography.Text strong style={{ fontSize: 13, color: '#262626' }}>
                  {PRINT_DAY_LEGEND_TEXT[state]}
                </Typography.Text>
              </Space>
            ))}
          </Space>
        </Space>
      </div>

      <Card size="small" className="payroll-no-print" style={{ marginTop: 16, marginBottom: 16 }} styles={{ body: { padding: '10px 20px' } }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ minWidth: 130 }}>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>ROMEO</div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>ລະບົບຈັດການພະນັກງານ</Typography.Text>
          </div>
          <Divider type="vertical" style={{ height: 36, margin: '0 16px' }} />
          <div style={{ flex: 1, textAlign: 'center' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>{printTitle}</Typography.Title>
          </div>
          <Divider type="vertical" style={{ height: 36, margin: '0 16px' }} />
          <div style={{ minWidth: 130, textAlign: 'right' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>ພິມ: {dayjs().format('DD/MM/YYYY HH:mm')}</Typography.Text>
          </div>
        </div>
      </Card>

      <div className="payroll-no-print">
      <Table
        dataSource={rows}
        rowKey={(r) => r.employee._id}
        loading={loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
        onRow={(r: SummaryRow) => ({ className: r.employee.status === 'resigned' ? 'payroll-resigned-row' : undefined })}
      >
        <Table.Column title="ລ/ດ" fixed="left" width={50} align="center" render={(_, __, index) => index + 1} />
        <Table.Column title="ລະຫັດ" fixed="left" width={90} render={(_, r: SummaryRow) => r.employee.employeeCode || '-'} />
        <Table.Column
          title="ຊື່"
          fixed="left"
          width={160}
          render={(_, r: SummaryRow) => {
            const note = resignedNote(r.employee);
            return (
              <span>
                {`${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`}
                {note && <span style={{ marginLeft: 6, fontSize: 11, color: '#a6a6a6' }}>{note}</span>}
              </span>
            );
          }}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              width={54}
              align="center"
              title={
                <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
                  <div style={{ fontSize: 12 }}>{day.format('DD')}</div>
                  <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 'normal' }}>{day.format('ddd')}</div>
                </div>
              }
              render={(_, r: SummaryRow) => {
                const state = printDayState(r.employee, dateKey, day.day());
                const style = PRINT_DAY_STYLE[state];
                return (
                  <div style={{ background: style.bg, color: style.text, borderRadius: 4, padding: '2px 0', fontSize: 12 * (style.zoom ?? 1), fontWeight: 600 }}>
                    {style.label}
                  </div>
                );
              }}
            />
          );
        })}
        <Table.Column
          title="ມາເຮັດວຽກ (ມື້)"
          width={110}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.workDays, 'work') })}
          onHeaderCell={() => ({ style: toneColors('work') })}
          render={(_, r: SummaryRow) => r.workDays}
        />
        <Table.Column
          title="ພັກ (ມື້)"
          width={90}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.restDays, 'rest') })}
          onHeaderCell={() => ({ style: toneColors('rest') })}
          render={(_, r: SummaryRow) => r.restDays}
        />
        <Table.Column
          title="x1"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x1, 'x1') })}
          onHeaderCell={() => ({ style: toneColors('x1') })}
          render={(_, r: SummaryRow) => r.x1}
        />
        <Table.Column
          title="x2"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x2, 'x2') })}
          onHeaderCell={() => ({ style: toneColors('x2') })}
          render={(_, r: SummaryRow) => r.x2}
        />
        <Table.Column
          title="x3"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x3, 'x3') })}
          onHeaderCell={() => ({ style: toneColors('x3') })}
          render={(_, r: SummaryRow) => r.x3}
        />
        <Table.Column
          title="ປ"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.grace, 'grace') })}
          onHeaderCell={() => ({ style: toneColors('grace') })}
          render={(_, r: SummaryRow) => r.grace}
        />
        <Table.Column title="ວັນທັງໝົດ" width={100} align="center" render={(_, r: SummaryRow) => r.totalDays} />
        <Table.Column title="ຊ/ມ x3" width={90} align="center" render={(_, r: SummaryRow) => r.otHours} />
        <Table.Column title="ມື້ x2" width={80} align="center" render={(_, r: SummaryRow) => r.otDays} />
      </Table>
      </div>

      <div className="payroll-print-only" style={{ flexWrap: 'wrap', gap: 12, fontSize: 9, marginBottom: 4 }}>
        {(Object.keys(PRINT_DAY_STYLE) as PrintDayState[]).map((state) => (
          <span key={state} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 12,
                height: 12,
                background: PRINT_DAY_STYLE[state].bg,
                color: PRINT_DAY_STYLE[state].text,
                border: '1px solid #999',
                fontWeight: 700,
                fontSize: 8,
              }}
            >
              {PRINT_DAY_STYLE[state].label}
            </span>
            {PRINT_DAY_LEGEND_TEXT[state]}
          </span>
        ))}
      </div>

      <table className="payroll-print-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 9 }}>
        <colgroup>
          <col style={{ width: 22 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 110 }} />
          {days.map((d) => (
            <col key={d.format('YYYY-MM-DD')} style={{ width: printDayColWidth }} />
          ))}
          <col style={{ width: 38 }} />
          <col style={{ width: 32 }} />
          <col style={{ width: 22 }} />
          <col style={{ width: 22 }} />
          <col style={{ width: 22 }} />
          <col style={{ width: 22 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 34 }} />
          <col style={{ width: 34 }} />
        </colgroup>
        <thead>
          <tr>
            {/* Spans the whole header row so it repeats on every printed
                page along with the column headers below it — a plain <th>
                inside a real <thead> is what browsers reliably repeat per
                page; the earlier position:fixed banner needed its height to
                exactly match a hand-picked @page margin, which is exactly
                what kept drifting out of sync and covering row 1. */}
            <th colSpan={printTotalColumns} style={{ border: '1px solid #999', borderBottom: '2px solid #A9761E', padding: '6px 10px', background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
                <div style={{ fontWeight: 700, letterSpacing: 1, minWidth: 90, textAlign: 'left' }}>ROMEO</div>
                <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 13 }}>{printTitle}</div>
                <div style={{ minWidth: 110, textAlign: 'right', color: '#8c8c8c', fontWeight: 400 }}>
                  ພິມ: {dayjs().format('DD/MM/YYYY HH:mm')}
                </div>
              </div>
            </th>
          </tr>
          <tr>
            <th style={PRINT_TH}>ລ/ດ</th>
            <th style={PRINT_TH}>ລະຫັດ</th>
            <th style={PRINT_TH}>ຊື່</th>
            {days.map((d) => (
              <th key={d.format('YYYY-MM-DD')} style={{ ...PRINT_TH, fontSize: 7, lineHeight: 1.15 }}>
                <div>{d.format('DD')}</div>
                <div style={{ fontWeight: 400, color: '#8c8c8c' }}>{LAO_WEEKDAYS_SHORT[d.day()]}</div>
              </th>
            ))}
            <th style={{ ...PRINT_TH, ...toneColors('work') }}>ມາ</th>
            <th style={{ ...PRINT_TH, ...toneColors('rest') }}>ພັກ</th>
            <th style={{ ...PRINT_TH, ...toneColors('x1') }}>x1</th>
            <th style={{ ...PRINT_TH, ...toneColors('x2') }}>x2</th>
            <th style={{ ...PRINT_TH, ...toneColors('x3') }}>x3</th>
            <th style={{ ...PRINT_TH, ...toneColors('grace') }}>ປ</th>
            <th style={PRINT_TH}>ລວມ</th>
            <th style={PRINT_TH}>ຊ/ມx3</th>
            <th style={PRINT_TH}>ມື້x2</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.employee._id} className={r.employee.status === 'resigned' ? 'payroll-resigned-row' : undefined}>
              <td style={PRINT_TD}>{idx + 1}</td>
              <td style={PRINT_TD}>{r.employee.employeeCode || '-'}</td>
              <td style={{ ...PRINT_TD, textAlign: 'left' }}>
                {`${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`}
                {resignedNote(r.employee) && (
                  <span style={{ marginLeft: 4, fontSize: 7, color: '#a6a6a6' }}>{resignedNote(r.employee)}</span>
                )}
              </td>
              {days.map((d) => {
                const dateKey = d.format('YYYY-MM-DD');
                const state = printDayState(r.employee, dateKey, d.day());
                const style = PRINT_DAY_STYLE[state];
                return (
                  <td key={dateKey} style={{ ...PRINT_TD, background: style.bg, color: style.text, fontSize: 8 * (style.zoom ?? 1), fontWeight: 700, padding: '1px 0' }}>
                    {style.label}
                  </td>
                );
              })}
              <td style={{ ...PRINT_TD, ...toneStyle(r.workDays, 'work') }}>{r.workDays}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.restDays, 'rest') }}>{r.restDays}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.x1, 'x1') }}>{r.x1}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.x2, 'x2') }}>{r.x2}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.x3, 'x3') }}>{r.x3}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.grace, 'grace') }}>{r.grace}</td>
              <td style={PRINT_TD}>{r.totalDays}</td>
              <td style={PRINT_TD}>{r.otHours}</td>
              <td style={PRINT_TD}>{r.otDays}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="payroll-print-only" style={{ justifyContent: 'space-between', marginTop: 64, padding: '0 24px' }}>
        {['ຜູ້ຮັບຜິດຊອບ', 'ຜູ້ທວດສອບ', 'ຜູ້ທວດສອບ'].map((label, i) => (
          <div key={i} style={{ textAlign: 'center', width: 220 }}>
            <div style={{ height: 48 }} />
            <div style={{ borderTop: '1px solid #000' }} />
            <Typography.Title level={4} style={{ marginTop: 4, marginBottom: 0 }}>{label}</Typography.Title>
          </div>
        ))}
      </div>
    </div>
  );
};

export const PayrollSummaryPage: React.FC = () => (
  <List title="ສະຫຼຸບເງິນເດືອນ" breadcrumb={false}>
    <PayrollSummaryGrid />
  </List>
);
