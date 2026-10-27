import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { List, useSelect } from '@refinedev/antd';
import { useList, useCreate, useCustom, useCustomMutation } from '@refinedev/core';
import { Table, DatePicker, Button, Space, Typography, Select, Card, Divider, Modal, Input, Popover, Badge, Segmented, Tag, message } from 'antd';
import { LeftOutlined, RightOutlined, DownloadOutlined, HomeOutlined, PrinterOutlined, BellOutlined, CheckOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceDaily, Employee, Shift, Leave, Overtime, Department, Position, PayrollComment } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL } from '../../providers/axios';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';

const { RangePicker } = DatePicker;

const LAO_MONTHS = [
  'ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ',
  'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ',
];
// Indexed by dayjs's .day() (0 = Sunday .. 6 = Saturday) — short enough to
// fit the print table's narrow per-day header cells alongside the date number.
const LAO_WEEKDAYS_SHORT = ['ອາ', 'ຈ', 'ອັງ', 'ພຸ', 'ພະ', 'ສຸ', 'ເສ'];
const MAX_RANGE_DAYS = 31;
// Page size for every per-range list on this page (shifts, leaves, OT,
// attendance, comments): at most about one row per person per day, so
// staff ceiling × the longest range always fits — a fixed number like 5000
// silently drops rows once the staff grows past it.
const RANGE_ROW_LIMIT = ALL_EMPLOYEES_PAGE_SIZE * MAX_RANGE_DAYS;

// The 10 summary cells a comment can attach to, in the same order they're
// rendered — used to resolve a stored column key back to the Lao label for
// display.
const SUMMARY_COLUMN_LABELS: Record<string, string> = {
  workDays: 'ມາເຮັດວຽກ (ມື້)',
  restDays: 'ພັກ (ມື້)',
  absentDays: 'ຂາດວຽກ (ມື້)',
  x1: 'x1',
  x2: 'x2',
  x3: 'x3',
  grace: 'ປ',
  totalDays: 'ວັນທັງໝົດ',
  otHours: 'ຊ/ມ x3',
  otDays: 'ມື້ x2',
};

function labelForColumn(column: string): string {
  if (column.startsWith('day:')) return dayjs(column.slice(4)).format('DD/MM/YYYY');
  const [col, range] = column.split(':');
  const label = SUMMARY_COLUMN_LABELS[col] ?? col;
  // The bell lists threads from every month, so a summary cell carries its
  // range — "x2" alone wouldn't say which month's number it's about.
  const [from, to] = (range ?? '').split('_');
  return from && to ? `${label} (${dayjs(from).format('DD/MM')}–${dayjs(to).format('DD/MM/YYYY')})` : label;
}

// Whether a comment's cell falls inside the date range the page shows: a day
// cell's date, or a summary cell's whole range (baked into its key).
function columnInRange(column: string, startKey: string, endKey: string) {
  if (column.startsWith('day:')) {
    const day = column.slice(4);
    return day >= startKey && day <= endKey;
  }
  const [from, to] = (column.split(':')[1] ?? '').split('_');
  return !!from && !!to && from >= startKey && to <= endKey;
}

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

function personName(person: unknown, fallback?: string) {
  const p = person && typeof person === 'object' ? (person as { firstName?: string; lastName?: string }) : null;
  const name = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
  return name || fallback || 'ບໍ່ຮູ້ຈັກ';
}

// One cell's comment thread as the page shows it: every message on that cell
// in time order. Cells commented before threads existed can hold several
// PayrollComment documents — they're merged here into one thread, and the
// thread counts as open while any of them is.
interface CommentThread {
  key: string;
  employeeId: string;
  employeeCode?: string;
  employeeName: string;
  column: string;
  messages: { id: string; text: string; authorName: string; createdAt: string }[];
  status: 'open' | 'resolved';
  resolvedAt?: string;
  resolvedByName?: string;
  lastActivity: string;
}

const RESOLVED_LIST_LIMIT = 50;

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
  absentDays: number;
  x1: number;
  x2: number;
  x3: number;
  grace: number;
  totalDays: number;
  otHours: number;
  otDays: number;
  // No scanner code — ມາເຮັດວຽກ / ຂາດວຽກ can't be known and are shown blank.
  untracked: boolean;
}

// ມາເຮັດວຽກ / ຂາດວຽກ value as displayed (blank for someone with no scanner code).
const trackedCount = (r: SummaryRow, value: number) => (r.untracked ? '' : value);

type DayStatus = 'work' | 'rest' | 'leave' | 'future' | 'absent' | 'blank';

// One-letter day-cell scheme, shared by the on-screen grid and the print
// table, with 'leave' split out by which deduction tier the covering Leave
// record carries — same tiers as the x1/x2/x3/ป summary columns — so a day
// cell reads as which rate it's billed at, not just "on leave". 'future' is
// a day that hasn't happened yet — never counted as "work" just because
// nothing else matched.
type PrintDayState =
  | 'work'
  | 'rest'
  | 'graceLeave'
  | 'x1Leave'
  | 'x2Leave'
  | 'x3Leave'
  | 'x2Absent'
  | 'x3Absent'
  | 'future'
  | 'out'
  | 'notStarted'
  | 'blank'
  | 'absent';
type SummaryTone = 'work' | 'rest' | 'x1' | 'x2' | 'x3' | 'grace' | 'absent';

// work, x2 and x3 are deliberately muted: staff found the saturated green
// that fills most of the grid, and the vivid reds, glaring. Each red tier
// stays darker than the one before so the x1 → x2 → x3 severity order still
// reads at a glance.
const SUMMARY_TONE: Record<SummaryTone, { bg: string; text: string }> = {
  work: { bg: '#b7eb8f', text: '#237804' },
  rest: { bg: '#d9d9d9', text: '#434343' },
  x1: { bg: '#ffccc7', text: '#a8071a' },
  x2: { bg: '#e88b8b', text: '#ffffff' },
  x3: { bg: '#c75b5b', text: '#ffffff' },
  grace: { bg: '#e6f4ff', text: '#1677ff' },
  // Same red ປະຫວັດການສະແກນ uses for ຂາດວຽກ (see attendance/logs.tsx
  // CELL_STYLE.absent) — same meaning, same color, on both pages.
  absent: { bg: '#fff1f0', text: '#cf1322' },
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
  // Same severity colors as the leave-deduction tiers above (same meaning —
  // how hard this hits pay) but a distinct label so it never looks like a
  // leave record: this is an unexcused absence, not leave.
  x2Absent: { bg: SUMMARY_TONE.x2.bg, text: SUMMARY_TONE.x2.text, label: 'ຂ2' },
  x3Absent: { bg: SUMMARY_TONE.x3.bg, text: SUMMARY_TONE.x3.text, label: 'ຂ3' },
  out: { bg: '#fff1f0', text: '#cf1322', label: '-' },
  absent: { bg: SUMMARY_TONE.absent.bg, text: SUMMARY_TONE.absent.text, label: 'ຂ' },
  future: { bg: '#fafafa', text: '#bfbfbf', label: '-' },
  notStarted: { bg: '#f0f0f0', text: '#8c8c8c', label: '-' },
  blank: { bg: '#ffffff', text: '#bfbfbf', label: '' },
};
const PRINT_DAY_LEGEND_TEXT: Record<PrintDayState, string> = {
  work: 'ມາເຮັດວຽກ',
  rest: 'ພັກ',
  graceLeave: 'ລາ (ຍັງຟຣີ)',
  x1Leave: 'ລx1',
  x2Leave: 'ລx2',
  x3Leave: 'ລx3',
  x2Absent: 'ຂX2',
  x3Absent: 'ຂX3',
  out: 'ລາອອກແລ້ວ',
  absent: 'ຂາດວຽກ',
  future: 'ຍັງບໍ່ເຖິງວັນ',
  notStarted: 'ຍັງບໍ່ເລີ່ມວຽກ',
  blank: 'ບໍ່ມີຂໍ້ມູນສະແກນ',
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
// ລະຫັດ 42 + ຊື່ 110 + ມາ 38 + ພັກ 32 + ຂາດ 32 + x1/x2/x3/ປ 22×4 + ລວມ 38 +
// ຊ/ມx3 34 + ມື້x2 34). Day columns split whatever width is left over this
// many ways — see dayColWidth below — so the printed table always spans
// exactly one page width no matter how many days are in the selected range,
// instead of a fixed per-day width that overflows once the range gets long
// enough.
const PRINT_FIXED_COLS_WIDTH_PX = 22 + 42 + 110 + 38 + 32 + 32 + 22 * 4 + 38 + 34 + 34;
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
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
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
  const printTotalColumns = 3 + days.length + 10;

  const { data: scheduledShiftsData, isLoading: scheduledLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'scheduled' },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  const { data: restShiftsData, isLoading: restLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'rest' },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  const { data: swappedShiftsData, isLoading: swappedLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'swapped' },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  // Only approved leaves overlapping the range (leaves.js's from/to) — every
  // leave ever filed used to be fetched and matched here, and the newest ones
  // would have silently dropped off once there were more than the page size.
  const { data: leavesData, isLoading: leavesLoading } = useList<Leave>({
    resource: 'leaves',
    filters: [
      { field: 'status', operator: 'eq', value: 'approved' },
      { field: 'from', operator: 'eq', value: rangeStartKey },
      { field: 'to', operator: 'eq', value: rangeEndKey },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
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
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  const overtimeRecords = overtimeData?.data ?? [];

  // ขาดงาน — the one place this page reads the actual recorded attendance
  // outcome rather than just what was scheduled. Without this, a day the
  // employee was scheduled to work but never scanned for (a real no-show, or
  // a disciplinary override — see attendanceActions.js mark-absent) still
  // counted as a worked day here even while ປະຫວັດການສະແກນ correctly showed
  // it as ຂາດວຽກ.
  const { data: absentDailyData, isLoading: absentLoading } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'absent' },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  // Keyed `${employeeId}_${date}` — the record itself is kept because it
  // carries the absence's locked tier (see noAbsenceSeverityFor).
  const absentSet = useMemo(() => {
    const map = new Map<string, AttendanceDaily>();
    for (const a of absentDailyData?.data ?? []) {
      if (!a.employee) continue;
      map.set(`${idOf(a.employee)}_${a.date}`, a);
    }
    return map;
  }, [absentDailyData?.data]);

  // Today's and last night's outcome usually isn't known yet: an overnight
  // shift that started yesterday is still running this morning, and the
  // automatic ຂາດວຽກ sweep only judges a day once its scan window has closed
  // (markAbsentForMissedScans). So on those two dates, a day with no
  // AttendanceDaily row at all yet stays blank instead of presumed worked.
  const todayKey = dayjs().format('YYYY-MM-DD');
  const yesterdayKey = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const recentFrom = rangeStartKey > yesterdayKey ? rangeStartKey : yesterdayKey;
  const recentTo = rangeEndKey < todayKey ? rangeEndKey : todayKey;
  const recentEnabled = recentFrom <= recentTo;
  const { data: recentDailyData, isLoading: recentLoading } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: recentFrom },
      { field: 'date', operator: 'lte', value: recentTo },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
    queryOptions: { enabled: recentEnabled },
  });
  const recentDailySet = useMemo(() => {
    const set = new Set<string>();
    for (const d of recentDailyData?.data ?? []) {
      if (!d.employee) continue;
      set.add(`${idOf(d.employee)}_${d.date}`);
    }
    return set;
  }, [recentDailyData?.data]);

  // Days someone actually scanned before their recorded start date — still
  // counted as worked (see beforeHire below).
  const { data: scannedBeforeHireData, isLoading: scannedBeforeHireLoading } = useCustom<{ employee: string; date: string }[]>({
    url: `${API_URL}/attendance-daily/scanned-before-hire`,
    method: 'get',
    config: { query: { from: rangeStartKey, to: rangeEndKey } },
  });
  const scannedBeforeHireSet = useMemo(
    () => new Set((scannedBeforeHireData?.data ?? []).map((r) => `${r.employee}_${r.date}`)),
    [scannedBeforeHireData?.data]
  );

  // Days the DJs (ມາແທນ positions) actually scanned or were marked ມາແທນ —
  // see classifyDay.
  const { data: substituteDaysData, isLoading: substituteDaysLoading } = useCustom<{ employee: string; date: string }[]>({
    url: `${API_URL}/attendance-daily/substitute-position-days`,
    method: 'get',
    config: { query: { from: rangeStartKey, to: rangeEndKey } },
  });
  const substituteDaySet = useMemo(
    () => new Set((substituteDaysData?.data ?? []).map((r) => `${r.employee}_${r.date}`)),
    [substituteDaysData?.data]
  );

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
  // Nor before their start date — those days were never theirs to work. A
  // start date still in the future is ignored (a data-entry error on someone
  // already working), and a day they actually scanned still counts (the start
  // date is evidently wrong). The server's absence sweep skips the same days.
  const beforeHire = (emp: Employee, dateKey: string) => {
    if (!emp.hireDate) return false;
    const hireKey = toDateKey(emp.hireDate);
    return hireKey <= todayKey && dateKey < hireKey && !scannedBeforeHireSet.has(`${emp._id}_${dateKey}`);
  };

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
  // What the SCHEDULE says should have happened — doesn't yet know whether it
  // actually did. classifyDay below is the one that checks that.
  const classifyScheduledDay = (emp: Employee, dateKey: string, dow: number): DayStatus => {
    if (afterResignation(emp, dateKey) || beforeHire(emp, dateKey)) return 'future';
    const coveringLeave = findCoveringLeave(emp, dateKey);
    if (coveringLeave) {
      const isRestOverlap = (coveringLeave.restDayOverlaps ?? []).some((o) => o.date === dateKey);
      return isRestOverlap ? 'rest' : 'leave';
    }
    const key = `${emp._id}_${dateKey}`;
    if (scheduledSet.has(key)) return 'work';
    if (restSet.has(key) || swappedSet.has(key)) return 'rest';
    if ((emp.defaultRestDay ?? []).includes(dow)) return 'rest';
    // Nothing is actually known/decided for this date yet — a queued shift,
    // a rest override, a leave, or the recurring default would all have
    // already matched above (and are shown as such even when the date is in
    // the future, since those ARE known in advance). Only the "presumably
    // just a plain work day" guess is wrong for a day that hasn't happened
    // yet — there's nothing to presume, so it stays blank instead. Same for
    // today/last night while nothing has been recorded yet (recentDailySet).
    if (dayjs(dateKey).isAfter(dayjs(), 'day')) return 'future';
    if (dateKey >= yesterdayKey && !recentDailySet.has(key)) return 'future';
    return 'work';
  };

  // A day the schedule says was a work day, but ປະຫວັດການສະແກນ's own
  // AttendanceDaily record says the employee was actually marked absent that
  // day (a genuine no-show, or a disciplinary override) — counts as ຂາດວຽກ
  // here instead of a worked day, so the two pages never disagree. A day the
  // schedule itself already resolves to rest/leave/future is left alone —
  // there's no AttendanceDaily 'absent' row for those anyway (leave stamps
  // 'leave' directly, a rest day is never swept for absence).
  // A DJ — someone in a ມາແທນ position (unless switched off for them) — has
  // no fixed shift, so the absence sweep never judges their days.
  const inSubstitutePosition = (emp: Employee) => {
    const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
    return emp.allowsSubstituteStatus !== false && position?.allowsSubstituteStatus === true;
  };

  // A day that would read as ມາ or ຂາດ stays blank when the system can't
  // know: no scanner code at all, or a DJ day with no scan and no ມາແທນ
  // mark (a deliberate ຂາດ still shows). Rest days and leave are known
  // either way.
  const classifyDay = (emp: Employee, dateKey: string, dow: number): DayStatus => {
    const scheduled = classifyScheduledDay(emp, dateKey, dow);
    if (scheduled !== 'work') return scheduled;
    const key = `${emp._id}_${dateKey}`;
    if (!emp.deviceUserId) return 'blank';
    if (absentSet.has(key)) return 'absent';
    if (inSubstitutePosition(emp) && !substituteDaySet.has(key)) return 'blank';
    return 'work';
  };

  // ຕັ້ງຄ່າກົດຂອງຕຳແໜ່ງ's "ວັນຫ້າມຂາດ" / ມື້ທຳມະດາ — the tier an absence is
  // charged at. Only meaningful for a day classifyDay already resolved to
  // 'absent' (that precedence — rest/leave always wins first — is classifyDay's
  // job, not this one's). The tier is the one locked onto the absence when it
  // was recorded (server/src/utils/absenceSeverity.js) — working it out from
  // today's rules and position, as this used to, let a rule change or a
  // position move rewrite months already paid. The live rule below is only a
  // fallback for an absence not locked yet.
  const noAbsenceSeverityFor = (emp: Employee, dateKey: string, dow: number): 'X2' | 'X3' | null => {
    const absence = absentSet.get(`${emp._id}_${dateKey}`);
    if (absence?.absenceSeveritySetAt) return absence.absenceSeverity ?? null;
    const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
    // The employee's own override (ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ) fully replaces the
    // position's when set — same precedence as the server's mergeRestDayRule.
    const noAbsenceDays = emp.noAbsenceDays?.length ? emp.noAbsenceDays : position?.noAbsenceDays ?? [];
    const noAbsenceSeverity = emp.noAbsenceSeverity ?? position?.noAbsenceSeverity;
    if (noAbsenceDays.includes(dow) && noAbsenceSeverity) return noAbsenceSeverity;
    // Otherwise whatever's configured for an ordinary (non-listed) day — same
    // precedence/fallback as attendance/logs.tsx's absentSeverity, so this
    // page and ປະຫວັດການສະແກນ always agree on the tier.
    return emp.ordinaryAbsenceSeverity ?? position?.ordinaryAbsenceSeverity ?? null;
  };

  // Same precedence as classifyDay, but for a 'leave' day it also looks up
  // which Leave record covers this date to report its deductAmount tier —
  // that's not needed for the work/rest/leave totals above, only for the
  // print table's per-day letter.
  const printDayState = (emp: Employee, dateKey: string, dow: number): PrintDayState => {
    if (afterResignation(emp, dateKey)) return 'out';
    if (beforeHire(emp, dateKey)) return 'notStarted';
    const status = classifyDay(emp, dateKey, dow);
    if (status === 'absent') {
      const severity = noAbsenceSeverityFor(emp, dateKey, dow);
      if (severity === 'X2') return 'x2Absent';
      if (severity === 'X3') return 'x3Absent';
      return 'absent';
    }
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
      let absentDays = 0;
      let leaveDays = 0;
      let futureDays = 0;
      let blankDays = 0;
      // Declared before the day loop (not after, like empLeaves below) because
      // an absence on a ວັນຫ້າມຂາດ day feeds these same totals too — see
      // noAbsenceSeverityFor.
      let x1 = 0;
      let x2 = 0;
      let x3 = 0;
      let grace = 0;

      for (const day of days) {
        const dateKey = day.format('YYYY-MM-DD');
        const dow = day.day();
        const status = classifyDay(emp, dateKey, dow);
        if (status === 'work') workDays += 1;
        else if (status === 'rest') restDays += 1;
        else if (status === 'absent') {
          absentDays += 1;
          const severity = noAbsenceSeverityFor(emp, dateKey, dow);
          if (severity === 'X2') x2 += 1;
          else if (severity === 'X3') x3 += 1;
        } else if (status === 'future') futureDays += 1;
        else if (status === 'blank') blankDays += 1;
        else leaveDays += 1;
      }

      const empLeaves = leaves.filter(
        (l) => idOf(l.employee) === emp._id && toDateKey(l.startDate) <= rangeEndKey && toDateKey(l.endDate) >= rangeStartKey
      );
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

      return {
        employee: emp,
        workDays,
        restDays,
        absentDays,
        x1,
        x2,
        x3,
        grace,
        totalDays: workDays + restDays + absentDays + leaveDays + futureDays + blankDays,
        otHours,
        otDays,
        untracked: !emp.deviceUserId,
      };
    });
  }, [employees, days, scheduledSet, restSet, swappedSet, absentSet, recentDailySet, yesterdayKey, scannedBeforeHireSet, substituteDaySet, todayKey, leaves, overtimeByEmployee, rangeStartKey, rangeEndKey]);

  // ຄອມເມັ້ນ — a reviewer leaves a note on any cell (a day, or a summary
  // column) for whoever maintains payroll to see, answer and confirm. One
  // thread per cell: fetched in bulk like every other data source on this
  // page, then grouped by a flat employee+column key — see the PayrollComment
  // type for what that key looks like for each cell kind.
  // Only the cells in the range on screen (payrollComments.js's from/to) —
  // every comment ever written was fetched before, and past the page size
  // the newest would have silently dropped off the grid and the bell.
  const { data: commentsData, refetch: refetchComments } = useList<PayrollComment>({
    resource: 'payroll-comments',
    filters: [
      { field: 'from', operator: 'eq', value: rangeStartKey },
      { field: 'to', operator: 'eq', value: rangeEndKey },
    ],
    pagination: { pageSize: RANGE_ROW_LIMIT },
  });
  const threadsByKey = useMemo(() => {
    const docsByKey = new Map<string, PayrollComment[]>();
    for (const c of commentsData?.data ?? []) {
      const employeeId = idOf(c.employee);
      if (!employeeId) continue;
      const key = `${employeeId}::${c.column}`;
      const list = docsByKey.get(key) ?? [];
      list.push(c);
      docsByKey.set(key, list);
    }
    const map = new Map<string, CommentThread>();
    for (const [key, docs] of docsByKey) {
      const messages = docs
        .flatMap((d) => [
          { id: d._id, text: d.text, authorName: personName(d.author, d.authorEmail), createdAt: d.createdAt },
          ...(d.replies ?? []).map((r) => ({ id: r._id, text: r.text, authorName: personName(r.author, r.authorEmail), createdAt: r.createdAt })),
        ])
        .sort((a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf());
      const open = docs.some((d) => d.status !== 'resolved');
      const lastResolved = open ? undefined : docs.reduce((a, b) => (dayjs(b.resolvedAt).isAfter(a.resolvedAt) ? b : a));
      const employee = typeof docs[0].employee === 'object' ? docs[0].employee : undefined;
      map.set(key, {
        key,
        employeeId: idOf(docs[0].employee) as string,
        employeeCode: employee?.employeeCode,
        employeeName: personName(employee, '-'),
        column: docs[0].column,
        messages,
        status: open ? 'open' : 'resolved',
        resolvedAt: lastResolved?.resolvedAt,
        resolvedByName: lastResolved ? personName(lastResolved.resolvedBy, lastResolved.resolvedByEmail) : undefined,
        lastActivity: messages[messages.length - 1].createdAt,
      });
    }
    return map;
  }, [commentsData?.data]);

  const dayCommentColumn = (dateKey: string) => `day:${dateKey}`;
  const summaryCommentColumn = (col: string) => `${col}:${rangeStartKey}_${rangeEndKey}`;

  const [commentCell, setCommentCell] = useState<{ employeeId: string; employeeName: string; column: string; label: string } | null>(
    null
  );
  const { mutate: createComment, isLoading: postingComment } = useCreate();
  const { mutate: patchCommentStatus, isLoading: savingCommentStatus } = useCustomMutation();

  const openComments = (employeeId: string, employeeName: string, column: string, label: string) => {
    setCommentCell({ employeeId, employeeName, column, label });
  };

  const closeComments = () => setCommentCell(null);

  // Typing a draft lives inside CommentThreadModal itself (its own local
  // state), not here — this component also renders the full payroll table
  // (every employee × every day, twice over for the print copy), so if the
  // draft were state on THIS component every keystroke would re-render all
  // of that and the textbox would visibly lag/freeze.
  //
  // A cell that already has a thread gets this as a reply (server side), and
  // any new message reopens it for review.
  const submitComment = (text: string) => {
    if (!commentCell) return;
    createComment(
      { resource: 'payroll-comments', values: { employee: commentCell.employeeId, column: commentCell.column, text } },
      { onSuccess: () => refetchComments() }
    );
  };

  // ຢືນຢັນ / ເປີດຄືນ without posting a message.
  const setThreadStatus = (employeeId: string, column: string, status: 'open' | 'resolved', onDone?: () => void) => {
    patchCommentStatus(
      { url: `${API_URL}/payroll-comments/status`, method: 'patch', values: { employee: employeeId, column, status } },
      {
        onSuccess: () => {
          refetchComments();
          onDone?.();
        },
      }
    );
  };

  // Clickable marker on a cell's corner — a big orange-red dot while the
  // cell's thread waits for ຢືນຢັນ, a smaller blue one once confirmed (green
  // vanished on the green ມ cells), faint when there's none, so a reviewer
  // scanning the grid can spot flagged cells without opening anything. Both
  // carry a white ring so they stand out on every cell color. A pure-CSS ::after dot (see the .payroll-comment-cell rules
  // below) instead of a rendered icon component — with up to ~250 employees
  // × ~41 columns, an antd icon (several real DOM nodes: span > svg > path)
  // on every single cell was enough extra DOM weight to make the whole table
  // noticeably sluggish; a CSS pseudo-element costs nothing in the DOM at all.
  const withComment = (content: React.ReactNode, employeeId: string, employeeName: string, column: string, label: string) => {
    const thread = threadsByKey.get(`${employeeId}::${column}`);
    const marker = thread ? (thread.status === 'open' ? ' has-comment' : ' is-resolved') : '';
    return (
      <div
        id={`comment-${employeeId}::${column}`}
        className={`payroll-comment-cell${marker}`}
        onClick={() => openComments(employeeId, employeeName, column, label)}
        title={thread ? `${thread.messages.length} ຂໍ້ຄວາມ · ${thread.status === 'open' ? 'ລໍຖ້າຢືນຢັນ' : 'ຢືນຢັນແລ້ວ'}` : 'ເພີ່ມຄອມເມັ້ນ'}
      >
        {content}
      </div>
    );
  };

  // Bell — the threads on cells inside the date range on screen: the month by
  // default, or whatever range the date filter is set to. An entry takes the
  // reader to its cell (see jumpToThread), and they open it there themselves.
  // The badge is the open count, so it drops as threads are confirmed.
  // Confirmed threads are listed on the second tab, most recently confirmed
  // first. No ຢືນຢັນ button on the entries themselves: a button at the right
  // of each row looked like the table's action buttons and got pressed by
  // mistake — confirming happens inside the thread, after reading it.
  const { openThreads, resolvedThreads } = useMemo(() => {
    const all = [...threadsByKey.values()].filter((t) => columnInRange(t.column, rangeStartKey, rangeEndKey));
    return {
      openThreads: all
        .filter((t) => t.status === 'open')
        .sort((a, b) => dayjs(b.lastActivity).valueOf() - dayjs(a.lastActivity).valueOf()),
      resolvedThreads: all
        .filter((t) => t.status === 'resolved')
        .sort((a, b) => dayjs(b.resolvedAt).valueOf() - dayjs(a.resolvedAt).valueOf()),
    };
  }, [threadsByKey, rangeStartKey, rangeEndKey]);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'open' | 'resolved'>('open');
  const shownThreads = notifTab === 'open' ? openThreads : resolvedThreads.slice(0, RESOLVED_LIST_LIMIT);

  // Imperative, not React state — scrolling/flashing a cell must NOT trigger
  // a re-render of the whole table (same reasoning as the comment draft
  // living in its own component instead of state up here). Returns false when
  // the cell isn't in the current view.
  const focusComment = (employeeId: string, column: string) => {
    const el = document.getElementById(`comment-${employeeId}::${column}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    el.classList.remove('payroll-comment-flash');
    void el.offsetWidth;
    el.classList.add('payroll-comment-flash');
    setTimeout(() => el.classList.remove('payroll-comment-flash'), 4500);
    return true;
  };

  // A bell entry whose cell isn't on screen because a department/position/
  // person filter hides that employee (the bell only follows the date range):
  // clear those filters, then scroll once the table has re-rendered with the
  // cell in it — pendingFocus is checked after every render.
  const pendingFocus = useRef<{ employeeId: string; column: string } | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target && focusComment(target.employeeId, target.column)) pendingFocus.current = null;
  });
  const jumpToThread = (t: CommentThread) => {
    setNotifOpen(false);
    if (focusComment(t.employeeId, t.column)) return;
    if (!rows.some((r) => r.employee._id === t.employeeId)) {
      setDepartmentFilter(undefined);
      setPositionFilter(undefined);
      setPersonFilter(undefined);
    }
    const pending = { employeeId: t.employeeId, column: t.column };
    pendingFocus.current = pending;
    // Still not on screen after that (e.g. the employee is no longer listed
    // on this page at all) — say so rather than silently doing nothing.
    setTimeout(() => {
      if (pendingFocus.current !== pending) return;
      pendingFocus.current = null;
      message.info('ບໍ່ພົບຊ່ອງນີ້ໃນຕາຕະລາງ');
    }, 8000);
  };

  const exportCsv = () => {
    const header = ['ລະຫັດ', 'ຊື່', 'ມາເຮັດວຽກ', 'ພັກ', 'ຂາດວຽກ', 'x1', 'x2', 'x3', 'ປ', 'ວັນທັງໝົດ', 'ຊ/ມ x3', 'ມື້ x2'];
    const lines = rows.map((r) => {
      const name = `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`.trim();
      return [
        r.employee.employeeCode ?? '',
        name,
        trackedCount(r, r.workDays),
        r.restDays,
        trackedCount(r, r.absentDays),
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
  const loading =
    employeesLoading || scheduledLoading || restLoading || swappedLoading || absentLoading || (recentEnabled && recentLoading) || scannedBeforeHireLoading || substituteDaysLoading || leavesLoading || overtimeLoading;

  const handlePrintClick = () => window.print();

  return (
    <div>
      <style>{`
        .payroll-print-only { display: none; }
        .payroll-print-table { display: none; }
        .payroll-resigned-row > td { border-top: 1px solid #cf1322 !important; border-bottom: 1px solid #cf1322 !important; }
        .payroll-resigned-row > td:first-child { border-left: 2px solid #cf1322 !important; }
        .payroll-comment-cell { position: relative; cursor: pointer; }
        .payroll-comment-cell::after {
          content: '';
          position: absolute;
          top: 1px;
          right: 1px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.12);
        }
        .payroll-comment-cell.has-comment::after { top: -4px; right: -4px; width: 11px; height: 11px; background: #fa541c; box-shadow: 0 0 0 2px #fff; z-index: 1; }
        .payroll-comment-cell.is-resolved::after { top: -3px; right: -3px; width: 8px; height: 8px; background: #1677ff; box-shadow: 0 0 0 2px #fff; z-index: 1; }
        .payroll-comment-flash { animation: payrollCommentFlash 1.1s ease-out 4; border-radius: 4px; outline: 3px solid #fa541c; outline-offset: 2px; }
        @keyframes payrollCommentFlash {
          0% { box-shadow: 0 0 0 0 rgba(250, 84, 28, 0.8); }
          100% { box-shadow: 0 0 0 14px rgba(250, 84, 28, 0); }
        }
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
            <Popover
              trigger="click"
              open={notifOpen}
              onOpenChange={setNotifOpen}
              placement="bottomRight"
              title={
                <Segmented
                  size="small"
                  value={notifTab}
                  onChange={(v) => setNotifTab(v as 'open' | 'resolved')}
                  options={[
                    { value: 'open', label: `ລໍຖ້າຢືນຢັນ (${openThreads.length})` },
                    { value: 'resolved', label: `ຢືນຢັນແລ້ວ (${resolvedThreads.length})` },
                  ]}
                />
              }
              content={
                <div style={{ width: 380, maxHeight: 440, overflowY: 'auto' }}>
                  {shownThreads.length === 0 && (
                    <Typography.Text type="secondary">{notifTab === 'open' ? 'ບໍ່ມີຄອມເມັ້ນລໍຖ້າຢືນຢັນ' : 'ຍັງບໍ່ມີຄອມເມັ້ນທີ່ຢືນຢັນແລ້ວ'}</Typography.Text>
                  )}
                  {shownThreads.map((t) => {
                    const label = labelForColumn(t.column);
                    const first = t.messages[0];
                    const last = t.messages[t.messages.length - 1];
                    const oneLine: CSSProperties = { fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                    return (
                      <div
                        key={t.key}
                        onClick={() => jumpToThread(t)}
                        title="ໄປຫາຊ່ອງນີ້"
                        style={{ padding: '8px 4px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {t.employeeCode ? `${t.employeeCode} ` : ''}{t.employeeName} · {label}
                        </div>
                        <div style={{ ...oneLine, color: '#595959' }}>{first.text}</div>
                        {t.messages.length > 1 && (
                          <div style={{ ...oneLine, color: '#8c8c8c' }}>↳ {last.authorName}: {last.text}</div>
                        )}
                        <div style={{ fontSize: 11, color: '#bfbfbf' }}>
                          {t.status === 'open'
                            ? `${last.authorName} · ${dayjs(t.lastActivity).format('DD/MM HH:mm')}`
                            : `✓ ${t.resolvedByName ?? ''} · ${dayjs(t.resolvedAt).format('DD/MM HH:mm')}`}
                          {t.messages.length > 1 && ` · ${t.messages.length} ຂໍ້ຄວາມ`}
                        </div>
                      </div>
                    );
                  })}
                  {notifTab === 'resolved' && resolvedThreads.length > RESOLVED_LIST_LIMIT && (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      ສະແດງ {RESOLVED_LIST_LIMIT} ລາຍການລ່າສຸດ
                    </Typography.Text>
                  )}
                </div>
              }
            >
              <Badge count={openThreads.length} size="small" offset={[-4, 4]}>
                <Button icon={<BellOutlined />} />
              </Badge>
            </Popover>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ຂາດວຽກ = ມາຈາກປະຫວັດການສະແກນຈິງ (ບໍ່ແມ່ນຕາຕະລາງ) ນັບທັງຂາດວຽກແທ້ໆ ແລະ ຂາດວຽກແບບລົງໂທດ &nbsp;|&nbsp; x1/x2/x3/ປ = ມາຈາກໜ້າ "ການລາ" (x1-x3 = ມື້ລາທີ່ຕັດເງິນ ແຍກຕາມອັດຕາ 1/2/3 ເທົ່າ, ປ = ມື້ລາທີ່ຍັງຟຣີ) &nbsp;|&nbsp; ຊ/ມ x3 = ຊົ່ວໂມງ OT ທັງໝົດ (ຈາກໜ້າ OT ທີ່ອະນຸມັດແລ້ວ), ມື້ x2 = ຈຳນວນມື້ທີ່ມີ OT
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
            {([
              ['has-comment', 'ຄອມເມັ້ນລໍຖ້າຢືນຢັນ'],
              ['is-resolved', 'ຄອມເມັ້ນຢືນຢັນແລ້ວ'],
            ] as const).map(([marker, text]) => (
              <Space key={marker} size={6}>
                <span
                  className={`payroll-comment-cell ${marker}`}
                  style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 3, border: '1px solid #d9d9d9', cursor: 'default' }}
                />
                <Typography.Text strong style={{ fontSize: 13, color: '#262626' }}>
                  {text}
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

      {useMemo(
        () => (
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
                const content = (
                  <div style={{ background: style.bg, color: style.text, borderRadius: 4, padding: '2px 0', fontSize: 12 * (style.zoom ?? 1), fontWeight: 600 }}>
                    {style.label}
                  </div>
                );
                return withComment(
                  content,
                  r.employee._id,
                  `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`,
                  dayCommentColumn(dateKey),
                  day.format('DD/MM/YYYY')
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
          render={(_, r: SummaryRow) =>
            withComment(trackedCount(r, r.workDays), r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('workDays'), 'ມາເຮັດວຽກ (ມື້)')
          }
        />
        <Table.Column
          title="ພັກ (ມື້)"
          width={90}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.restDays, 'rest') })}
          onHeaderCell={() => ({ style: toneColors('rest') })}
          render={(_, r: SummaryRow) =>
            withComment(r.restDays, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('restDays'), 'ພັກ (ມື້)')
          }
        />
        <Table.Column
          title="ຂາດວຽກ (ມື້)"
          width={100}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.absentDays, 'absent') })}
          onHeaderCell={() => ({ style: toneColors('absent') })}
          render={(_, r: SummaryRow) =>
            withComment(trackedCount(r, r.absentDays), r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('absentDays'), 'ຂາດວຽກ (ມື້)')
          }
        />
        <Table.Column
          title="x1"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x1, 'x1') })}
          onHeaderCell={() => ({ style: toneColors('x1') })}
          render={(_, r: SummaryRow) =>
            withComment(r.x1, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('x1'), 'x1')
          }
        />
        <Table.Column
          title="x2"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x2, 'x2') })}
          onHeaderCell={() => ({ style: toneColors('x2') })}
          render={(_, r: SummaryRow) =>
            withComment(r.x2, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('x2'), 'x2')
          }
        />
        <Table.Column
          title="x3"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.x3, 'x3') })}
          onHeaderCell={() => ({ style: toneColors('x3') })}
          render={(_, r: SummaryRow) =>
            withComment(r.x3, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('x3'), 'x3')
          }
        />
        <Table.Column
          title="ປ"
          width={70}
          align="center"
          onCell={(r: SummaryRow) => ({ style: toneStyle(r.grace, 'grace') })}
          onHeaderCell={() => ({ style: toneColors('grace') })}
          render={(_, r: SummaryRow) =>
            withComment(r.grace, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('grace'), 'ປ')
          }
        />
        <Table.Column
          title="ວັນທັງໝົດ"
          width={100}
          align="center"
          render={(_, r: SummaryRow) =>
            withComment(r.totalDays, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('totalDays'), 'ວັນທັງໝົດ')
          }
        />
        <Table.Column
          title="ຊ/ມ x3"
          width={90}
          align="center"
          render={(_, r: SummaryRow) =>
            withComment(r.otHours, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('otHours'), 'ຊ/ມ x3')
          }
        />
        <Table.Column
          title="ມື້ x2"
          width={80}
          align="center"
          render={(_, r: SummaryRow) =>
            withComment(r.otDays, r.employee._id, `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`, summaryCommentColumn('otDays'), 'ມື້ x2')
          }
        />
      </Table>
      </div>
        ),
        [rows, days, threadsByKey, rangeStartKey, rangeEndKey, scheduledSet, restSet, swappedSet, absentSet, recentDailySet, yesterdayKey, scannedBeforeHireSet, substituteDaySet, todayKey, leaves, loading, offsetHeader]
      )}

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

      {useMemo(
        () => (
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
            <th style={{ ...PRINT_TH, ...toneColors('absent') }}>ຂາດ</th>
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
              <td style={{ ...PRINT_TD, ...toneStyle(r.workDays, 'work') }}>{trackedCount(r, r.workDays)}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.restDays, 'rest') }}>{r.restDays}</td>
              <td style={{ ...PRINT_TD, ...toneStyle(r.absentDays, 'absent') }}>{trackedCount(r, r.absentDays)}</td>
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
        ),
        [rows, days, threadsByKey, rangeStartKey, rangeEndKey, scheduledSet, restSet, swappedSet, absentSet, recentDailySet, yesterdayKey, scannedBeforeHireSet, substituteDaySet, todayKey, leaves, printTitle, printTotalColumns, printDayColWidth]
      )}

      <div className="payroll-print-only" style={{ justifyContent: 'space-between', marginTop: 64, padding: '0 24px' }}>
        {['ຜູ້ຮັບຜິດຊອບ', 'ຜູ້ທວດສອບ', 'ຜູ້ທວດສອບ'].map((label, i) => (
          <div key={i} style={{ textAlign: 'center', width: 220 }}>
            <div style={{ height: 48 }} />
            <div style={{ borderTop: '1px solid #000' }} />
            <Typography.Title level={4} style={{ marginTop: 4, marginBottom: 0 }}>{label}</Typography.Title>
          </div>
        ))}
      </div>

      <CommentThreadModal
        cell={commentCell}
        thread={commentCell ? threadsByKey.get(`${commentCell.employeeId}::${commentCell.column}`) : undefined}
        posting={postingComment}
        savingStatus={savingCommentStatus}
        onClose={closeComments}
        onSubmit={submitComment}
        onSetStatus={(status) => {
          if (!commentCell) return;
          setThreadStatus(commentCell.employeeId, commentCell.column, status, status === 'resolved' ? closeComments : undefined);
        }}
      />
    </div>
  );
};

// Split out so a keystroke in the textarea only re-renders this small modal,
// not PayrollSummaryGrid's full table (every employee × every day, twice
// over for the print copy) — co-locating the draft as state up there made
// typing visibly freeze.
//
// Anyone with page access may ຢືນຢັນ, the author included — staff sometimes
// share one login, so "someone else must confirm" can't be enforced anyway.
// ຢືນຢັນ sits up by the status tag, away from ສົ່ງ in the bottom-right corner:
// that corner is where people press after typing (and where the table's own
// action buttons sit), so a confirm button there got pressed by habit.
function CommentThreadModal({
  cell,
  thread,
  posting,
  savingStatus,
  onClose,
  onSubmit,
  onSetStatus,
}: {
  cell: { employeeId: string; employeeName: string; column: string; label: string } | null;
  thread: CommentThread | undefined;
  posting: boolean;
  savingStatus: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  onSetStatus: (status: 'open' | 'resolved') => void;
}) {
  const [draft, setDraft] = useState('');
  const text = draft.trim();
  const isOpen = thread?.status === 'open';

  const send = () => {
    if (!text) return;
    onSubmit(text);
    setDraft('');
  };

  return (
    <Modal
      open={!!cell}
      onCancel={onClose}
      title={cell ? `ຄອມເມັ້ນ — ${cell.employeeName} / ${cell.label}` : ''}
      footer={null}
      className="payroll-no-print"
      destroyOnClose
    >
      {cell && (
        <div>
          {thread && (
            <Space size={8} style={{ marginBottom: 4 }}>
              {isOpen ? (
                <>
                  <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                    ລໍຖ້າຢືນຢັນ
                  </Tag>
                  <Button size="small" icon={<CheckOutlined />} loading={savingStatus} onClick={() => onSetStatus('resolved')}>
                    ຢືນຢັນ
                  </Button>
                </>
              ) : (
                <>
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    ✓ ຢືນຢັນແລ້ວ · {thread.resolvedByName} · {dayjs(thread.resolvedAt).format('DD/MM/YYYY HH:mm')}
                  </Tag>
                  <Button size="small" type="link" loading={savingStatus} onClick={() => onSetStatus('open')}>
                    ເປີດຄືນ
                  </Button>
                </>
              )}
            </Space>
          )}
          <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
            {!thread && <Typography.Text type="secondary">ຍັງບໍ່ມີຄອມເມັ້ນ</Typography.Text>}
            {thread?.messages.map((m, i) => (
              <div
                key={m.id}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  ...(i > 0 && { marginLeft: 16, paddingLeft: 10, borderLeft: '2px solid #f0f0f0' }),
                }}
              >
                <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 2 }}>
                  {i > 0 && '↳ '}
                  {m.authorName} · {dayjs(m.createdAt).format('DD/MM/YYYY HH:mm')}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </div>
            ))}
          </div>
          <Input.TextArea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={thread ? 'ພິມຕອບ...' : 'ພິມຄອມເມັ້ນ...'}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {thread && !isOpen && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ຖ້າຕອບ, ຄອມເມັ້ນນີ້ຈະກັບໄປ ລໍຖ້າຢືນຢັນ ອີກ
            </Typography.Text>
          )}
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <Button type="primary" loading={posting} disabled={!text} onClick={send}>
              ສົ່ງ
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export const PayrollSummaryPage: React.FC = () => (
  <List title="ສະຫຼຸບເງິນເດືອນ" breadcrumb={false}>
    <PayrollSummaryGrid />
  </List>
);
