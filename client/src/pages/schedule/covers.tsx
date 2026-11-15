import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSelect } from '@refinedev/antd';
import { useList, useCustom, useCreate, useDelete, useInvalidate, useNotification, useGetIdentity } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Statistic, Card, Select, Modal, Form, DatePicker, TimePicker, Segmented, Grid, Tooltip, Alert } from 'antd';
import { LeftOutlined, RightOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined, LinkOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Identity, Leave, Position, RestDayScheduleRow, Shift, ShiftChangeLogEntry } from '../../types';
import { API_URL } from '../../providers/axios';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { groupRestRowsByEmployee, restDaysOn, upcomingMondays, effectiveRestrictedRestDays } from '../../utils/restDays';
import { createPlanDraft, PlannedCell, RestDayPlanBar, useRestDayPlanSchedule } from './restDayPlanShared';
import { RecurringRestDialog } from './recurringRestDialog';
import { preferredOverride } from '../../utils/dayOverride';
import { groupLogsByEmployee, shiftOnDate, regularShiftHours } from '../../utils/shiftHistory';
import { followsIrregularRule } from '../../utils/substituteRule';
import { PrintPickerModal, positionsNote, usePrintJob } from '../../components/PrintPicker';

function idOf(value: { _id: string } | string | null | undefined) {
  if (!value) return undefined;
  return typeof value === 'object' ? value._id : value;
}

function fullName(emp?: Employee | string | null) {
  if (!emp || typeof emp !== 'object') return '-';
  return `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || '-';
}

function codeOf(emp?: Employee | string | null) {
  return emp && typeof emp === 'object' ? emp.employeeCode ?? '' : '';
}

function deptOf(emp?: Employee | string | null) {
  const dept = emp && typeof emp === 'object' ? emp.department : undefined;
  return dept && typeof dept === 'object' ? dept.name : '-';
}

function positionOf(emp?: Employee | string | null) {
  const position = emp && typeof emp === 'object' ? emp.position : undefined;
  return position && typeof position === 'object' ? position.name : '-';
}

// Monday first, the way the week is counted for rest days.
function restDaysLabel(days: number[]) {
  return days.length
    ? [...days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_OPTIONS[d].label)
        .join(', ')
    : 'ບໍ່ມີ';
}

const shiftLabel = (emp: Employee) => regularShiftHours(emp) ?? 'ຍັງບໍ່ມີກະ';

function firstNameOf(emp?: Employee | string | null) {
  return emp && typeof emp === 'object' ? emp.firstName ?? '' : '';
}

// Overnight-aware, same convention as a shift's own start/end.
function hoursBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

// The print is ສະຫຼຸບເງິນເດືອນ's (payroll-summary/index.tsx) layout as is —
// the page, the header row, the column-header colours, the legend and the
// signature lines — the same for both views: this page's own columns, then the
// seven weekdays of the weekly roster, or the dates picked in the month view.
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
// Every print column before the days: ລ/ດ, ລະຫັດ, ຊື່, ຕຳແໜ່ງ, ກະ. The days split
// what's left of the page width.
const PRINT_FIXED_COLS = [22, 42, 160, 126, 92];
const PRINT_FIXED_COLS_WIDTH_PX = PRINT_FIXED_COLS.reduce((sum, width) => sum + width, 0);
// The most dates the month view prints: more and each day is too narrow to read.
const MAX_PRINT_DAYS = 14;
// Day-cell colours in print, and the legend above the table.
const PRINT_TONE = {
  rest: { bg: '#d9d9d9', text: '#434343' },
  leave: { bg: '#fffbe6', text: '#ad6800' },
  covering: { bg: '#f9f0ff', text: '#531dab' },
  coveredBy: { bg: '#f6ffed', text: '#237804' },
};
type PrintLegendItem = { label: string; tone: keyof typeof PRINT_TONE; text: string };
const PRINT_LEGEND_DATES: PrintLegendItem[] = [
  { label: 'ພ', tone: 'rest', text: 'ພັກ' },
  { label: 'ລາ', tone: 'leave', text: 'ລາ' },
  { label: 'ແທນ', tone: 'covering', text: 'ໄປເຮັດແທນຄົນອື່ນ' },
  { label: 'ແທນໂດຍ', tone: 'coveredBy', text: 'ມີຄົນມາແທນ' },
];
// One printed day column: its header and what each person's cell holds.
type PrintDay = { key: string; header: ReactNode; cell: (emp: Employee) => { tone?: { bg: string; text: string }; lines: ReactNode } };


// 'month': one column per date of the month (or of the dates picked). 'week':
// one dated week picked from a dropdown, the same day cells (since 15/11/2026;
// it used to be the month by weekday, read-only).
type CoverView = 'month' | 'week';
// ວາງແຜນວັນພັກ (the `planner` mode): one week at a time, back to the first week
// there is anything to look at (the system went live in October 2026).
const FIRST_WEEK = '2026-09-28';
const weekLabel = (monday: Dayjs) => `ຈັນ ${monday.format('DD/MM')} – ອາທິດ ${monday.add(6, 'day').format('DD/MM/YYYY')}`;
const sameRest = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

// Someone's own day, worked out the way ຕັ້ງຄ່າແຜນວຽກ does it (monthly.tsx
// computeCell): approved leave first, then a one-off day off / blank swap day /
// queued shift, then the recurring rest day in force, then the regular shift.
// The covers they do for others aren't part of it — those show as cards.
type DayStatus =
  | { kind: 'leave' }
  | { kind: 'rest'; holidayName?: string }
  | { kind: 'swapped' }
  | { kind: 'work'; start: string; end: string }
  | { kind: 'unset' };

function dayStatusLabel(status: DayStatus) {
  switch (status.kind) {
    case 'leave':
      return 'ລາ';
    case 'rest':
      return status.holidayName ? `ພັກ (${status.holidayName})` : 'ພັກ';
    case 'swapped':
      return 'ບໍ່ມີກະ';
    case 'work':
      return `ເຮັດວຽກ ${status.start}-${status.end}`;
    default:
      return 'ຍັງບໍ່ມີເວລາເຂົ້າວຽກ';
  }
}

// Someone off that day (rest or leave) — the days that may need covering.
const isOff = (status: DayStatus) => status.kind === 'rest' || status.kind === 'leave';

// One person's day in the month grid: their own day, the covers they do, and
// who covers them.
type DayInfo = { status: DayStatus; covering: Shift[]; coveredBy: Shift[] };

const OFF_STYLE: Record<'rest' | 'leave', CSSProperties> = {
  rest: { background: 'rgba(128, 128, 128, 0.12)' },
  leave: { background: '#fffbe6' },
};
// A normal working day someone else is covering.
const COVERED_WORK_STYLE: CSSProperties = { background: 'rgba(22, 119, 255, 0.08)' };

// On every ordinary cell of the month, thousands with everyone showing, so a
// plain button: antd's Button and Tooltip there made drawing the table far slower.
const AddCoverButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" className="covers-add-work" aria-label="ຫາຄົນແທນ" title="ຫາຄົນແທນ" onClick={onClick} />
);

// ການເຮັດແທນ — an overview of a department or position for the month: everyone
// in it, one row each, with the days they're off (rest or leave) and who
// covers them, and the covers they do for others. Any day off or normal working
// day can be handed to someone from right there (ຫາຄົນແທນ) — every employee is
// offered, each with what their own day looks like, and HR picks. Someone who
// goes to cover leaves their own shift for that day and scans by the cover's
// time (attendanceProcessor's resolveExpectedShift), so their shift may need
// covering in turn: C covers B covers A. The weekly roster shows the same month
// by weekday with no dates, to read only. Covers are also created from
// ຕັ້ງຄ່າແຜນວຽກ (click a day → ໄປເຮັດແທນຄົນອື່ນ) or with ມອບໝາຍການເຮັດແທນ.
// `planner`: the ວາງແຜນວັນພັກ page (agreed 15/11/2026) — the same people, rest
// days and covers, one dated week picked from a dropdown, and on a coming week a
// click moves that person's recurring rest day (from that week's Monday). Past
// weeks and this one are only to look at. Without it, the ການເຮັດແທນ page as is.
export const ScheduleCoversGrid: React.FC<{ planner?: boolean }> = ({ planner = false }) => {
  const [view, setView] = useState<CoverView>('month');
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const thisMonday = useMemo(() => {
    const today = dayjs().startOf('day');
    return today.subtract((today.day() + 6) % 7, 'day');
  }, []);
  // ວາງແຜນວັນພັກ opens on the first week a rest-day move can start (next Monday);
  // ການເຮັດແທນ on this week.
  const [weekMonday, setWeekMonday] = useState(() => (planner ? upcomingMondays(dayjs())[0] : thisMonday).format('YYYY-MM-DD'));
  const plannableMondays = useMemo(() => new Set(upcomingMondays(dayjs()).map((m) => m.format('YYYY-MM-DD'))), []);
  const weekOptions = useMemo(() => {
    const past: Dayjs[] = [];
    for (let m = thisMonday; !m.isBefore(dayjs(FIRST_WEEK), 'day'); m = m.subtract(7, 'day')) past.push(m);
    return [
      {
        label: planner ? 'ອາທິດຂ້າງໜ້າ — ຍ້າຍວັນພັກໄດ້' : 'ອາທິດຂ້າງໜ້າ',
        options: upcomingMondays(dayjs()).map((m) => ({
          value: m.format('YYYY-MM-DD'),
          label: `${weekLabel(m)}${m.date() <= 7 ? ' · ຈັນທຳອິດຂອງເດືອນ' : ''}`,
        })),
      },
      {
        label: planner ? 'ອາທິດນີ້ ແລະ ທີ່ຜ່ານມາ — ເບິ່ງຢ່າງດຽວ' : 'ອາທິດນີ້ ແລະ ທີ່ຜ່ານມາ',
        options: past.map((m) => ({ value: m.format('YYYY-MM-DD'), label: `${weekLabel(m)}${m.isSame(thisMonday, 'day') ? ' (ອາທິດນີ້)' : ''}` })),
      },
    ];
  }, [thisMonday, planner]);
  // One dated week: ວາງແຜນວັນພັກ always, and ການເຮັດແທນ's ລາຍອາທິດ (agreed
  // 15/11/2026 — covers are assigned there day by day, like the month view).
  const datedWeek = planner || view === 'week';
  const editableWeek = planner && plannableMondays.has(weekMonday);
  // A week before this one, on ວາງແຜນວັນພັກ: history, only to look at.
  const pastWeek = planner && weekMonday < thisMonday.format('YYYY-MM-DD');
  // Dates picked in the month view, up to MAX_PRINT_DAYS and across a month end
  // if need be: the table shows just those, and they're what prints. The weekly
  // roster always reads the whole month.
  const [dayRange, setDayRange] = useState<[Dayjs, Dayjs] | null>(null);
  const usingRange = view === 'month' && !!dayRange;
  const rangeStart = datedWeek ? dayjs(weekMonday) : usingRange ? dayRange[0].startOf('day') : monthStart;
  const rangeEnd = datedWeek ? dayjs(weekMonday).add(6, 'day') : usingRange ? dayRange[1].startOf('day') : monthStart.endOf('month').startOf('day');
  const periodText = datedWeek ? 'ໃນອາທິດທີ່ເລືອກ' : usingRange ? 'ໃນຊ່ວງທີ່ເລືອກ' : 'ໃນເດືອນນີ້';
  const startKey = rangeStart.format('YYYY-MM-DD');
  const endKey = rangeEnd.format('YYYY-MM-DD');
  const rangeDays = useMemo(
    () => Array.from({ length: dayjs(endKey).diff(dayjs(startKey), 'day') + 1 }, (_, i) => dayjs(startKey).add(i, 'day')),
    [startKey, endKey]
  );
  const goToMonth = (month: Dayjs) => {
    setMonthStart(month.startOf('month'));
    setDayRange(null);
  };
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();
  // On a phone the toolbar wraps to several rows — pinned, it would take half
  // the screen, so there it scrolls away and only the column header stays.
  const pinToolbar = Grid.useBreakpoint().md !== false;

  // Every Shift row this month: the covers, and each person's own one-off
  // days (rest, blank swap day, queued shift).
  const { data: shiftsData, isLoading, refetch } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: startKey },
      { field: 'date', operator: 'lte', value: endKey },
    ],
    pagination: { pageSize: 5000 },
  });
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [personFilter, setPersonFilter] = useState<string>();
  // ພິມ: what's being printed when it isn't just what's on screen (PrintPicker).
  const [printPickerOpen, setPrintPickerOpen] = useState(false);
  const { job: printJob, print: printSections } = usePrintJob();

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

  const { data: allEmployeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
  });
  const allEmployees = useMemo(() => allEmployeesData?.data ?? [], [allEmployeesData?.data]);

  // What each day is for each person — the same sources ຕັ້ງຄ່າແຜນວຽກ reads.
  const { data: restScheduleData, refetch: refetchRestSchedule } = useCustom<RestDayScheduleRow[]>({
    url: `${API_URL}/rest-day-history/schedule`,
    method: 'get',
    config: { query: { from: startKey, to: endKey } },
  });
  const restRowsByEmployee = useMemo(() => groupRestRowsByEmployee(restScheduleData?.data), [restScheduleData?.data]);
  const { data: shiftLogsData } = useCustom<ShiftChangeLogEntry[]>({
    url: `${API_URL}/shift-change-logs`,
    method: 'get',
    config: { query: { after: startKey } },
  });
  const shiftLogsByEmployee = useMemo(() => groupLogsByEmployee(shiftLogsData?.data), [shiftLogsData?.data]);
  const { data: approvedLeavesData } = useList<Leave>({
    resource: 'leaves',
    filters: [
      { field: 'status', operator: 'eq', value: 'approved' },
      { field: 'from', operator: 'eq', value: startKey },
      { field: 'to', operator: 'eq', value: endKey },
    ],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE * 31, mode: 'server' },
  });
  const leaveRanges = useMemo(() => {
    const map = new Map<string, { start: string; end: string }[]>();
    for (const l of approvedLeavesData?.data ?? []) {
      const empId = idOf(l.employee as Employee);
      if (!empId) continue;
      map.set(empId, [...(map.get(empId) ?? []), { start: dayjs(l.startDate).format('YYYY-MM-DD'), end: dayjs(l.endDate).format('YYYY-MM-DD') }]);
    }
    return map;
  }, [approvedLeavesData?.data]);

  // `${employee}_${date}` → the covers they do / the covers of them / their own one-off day.
  const shiftIndex = useMemo(() => {
    const covering = new Map<string, Shift[]>();
    const coveredBy = new Map<string, Shift[]>();
    const own = new Map<string, Shift>();
    const push = (map: Map<string, Shift[]>, key: string, s: Shift) => map.set(key, [...(map.get(key) ?? []), s]);
    for (const s of shiftsData?.data ?? []) {
      const empId = idOf(s.employee as Employee);
      if (!empId) continue;
      if (s.status === 'scheduled' && s.coveringFor) {
        push(covering, `${empId}_${s.date}`, s);
        const coveredId = idOf(s.coveringFor as Employee);
        if (coveredId) push(coveredBy, `${coveredId}_${s.date}`, s);
        continue;
      }
      const key = `${empId}_${s.date}`;
      const picked = preferredOverride(own.get(key), s);
      if (picked) own.set(key, picked);
    }
    const byTime = (a: Shift, b: Shift) => (a.startTime ?? '').localeCompare(b.startTime ?? '');
    for (const list of covering.values()) list.sort(byTime);
    for (const list of coveredBy.values()) list.sort(byTime);
    return { covering, coveredBy, own };
  }, [shiftsData?.data]);

  // Their regular shift on dateKey — a past day keeps the one they had then.
  const regularTimeOn = (emp: Employee, dateKey: string): { start: string; end: string } | null => {
    const historical = shiftOnDate(shiftLogsByEmployee.get(emp._id), dateKey);
    if (historical) return historical.startTime && historical.endTime ? { start: historical.startTime, end: historical.endTime } : null;
    const category = emp.defaultShiftCategory;
    if (category && typeof category === 'object') return { start: category.startTime, end: category.endTime };
    if (emp.defaultShiftStart && emp.defaultShiftEnd) return { start: emp.defaultShiftStart, end: emp.defaultShiftEnd };
    return null;
  };

  const statusOn = (emp: Employee, dateKey: string): DayStatus => {
    if (emp.hireDate && dateKey < dayjs(emp.hireDate).format('YYYY-MM-DD')) return { kind: 'unset' };
    if (leaveRanges.get(emp._id)?.some((r) => r.start <= dateKey && dateKey <= r.end)) return { kind: 'leave' };
    const own = shiftIndex.own.get(`${emp._id}_${dateKey}`);
    if (own?.status === 'rest') {
      const holiday = own.holiday && typeof own.holiday === 'object' ? own.holiday : undefined;
      return { kind: 'rest', holidayName: holiday?.name };
    }
    if (own?.status === 'swapped') return { kind: 'swapped' };
    if (own?.status === 'scheduled') return { kind: 'work', start: own.startTime ?? '', end: own.endTime ?? '' };
    if (restDaysOn(restRowsByEmployee.get(emp._id), emp.defaultRestDay, dateKey).includes(dayjs(dateKey).day())) return { kind: 'rest' };
    const time = regularTimeOn(emp, dateKey);
    return time ? { kind: 'work', ...time } : { kind: 'unset' };
  };

  // What a cover of this person takes on: their own shift that day — a one-off
  // time if they have one, never a cover they're doing themselves (those aren't
  // in statusOn) — or on a day off, the regular shift they'd have worked.
  const ownTimeOn = (emp: Employee, dateKey: string) => {
    const status = statusOn(emp, dateKey);
    return status.kind === 'work' ? { start: status.start, end: status.end } : regularTimeOn(emp, dateKey);
  };

  // Same choices as ສະຫຼຸບເງິນເດືອນ's ກອງຕາມບຸກຄົນ — narrowed by the other two.
  const personOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => (!departmentFilter || idOf(e.department) === departmentFilter) && (!positionFilter || idOf(e.position) === positionFilter))
        .map((e) => ({ label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(), value: e._id })),
    [allEmployees, departmentFilter, positionFilter]
  );

  // Everyone, grouped by position — and those in the department / position /
  // person picked.
  const sortedEmployees = useMemo(
    () => [...allEmployees].sort((a, b) => positionOf(a).localeCompare(positionOf(b)) || (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '')),
    [allEmployees]
  );
  const rows = useMemo(
    () =>
      sortedEmployees.filter(
        (e) =>
          (!departmentFilter || idOf(e.department) === departmentFilter) &&
          (!positionFilter || idOf(e.position) === positionFilter) &&
          (!personFilter || e._id === personFilter)
      ),
    [sortedEmployees, departmentFilter, positionFilter, personFilter]
  );
  // Whose days are worked out: those shown — or everyone while ພິມ prints
  // departments beyond them.
  const infoRows = printJob ? sortedEmployees : rows;

  const dayInfo = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const emp of infoRows) {
      for (const day of rangeDays) {
        const key = `${emp._id}_${day.format('YYYY-MM-DD')}`;
        map.set(key, {
          status: statusOn(emp, day.format('YYYY-MM-DD')),
          covering: shiftIndex.covering.get(key) ?? [],
          coveredBy: shiftIndex.coveredBy.get(key) ?? [],
        });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoRows, rangeDays, shiftIndex, leaveRanges, restRowsByEmployee, shiftLogsByEmployee]);
  const infoOn = (emp: Employee, dateKey: string) =>
    dayInfo.get(`${emp._id}_${dateKey}`) ?? { status: { kind: 'unset' } as DayStatus, covering: [], coveredBy: [] };

  // The line of covers someone's day is part of, first to last: C covers B
  // covers A gives [C, B, A]. Only worth spelling out from two covers on — one
  // cover reads plainly from the lines in the cell. Follows the first cover each
  // way when someone has several, and stops at anyone already in the line.
  const coverChain = (emp: Employee, dateKey: string): Employee[] | null => {
    const seen = new Set([emp._id]);
    const walk = (index: Map<string, Shift[]>, personOf: (s: Shift) => Employee | string | null | undefined) => {
      const line: Employee[] = [];
      let cursor = emp._id;
      for (;;) {
        const shift = index.get(`${cursor}_${dateKey}`)?.[0];
        const next = shift ? personOf(shift) : null;
        if (!next || typeof next !== 'object' || seen.has(next._id)) return line;
        seen.add(next._id);
        line.push(next);
        cursor = next._id;
      }
    };
    const before = walk(shiftIndex.coveredBy, (s) => s.employee as Employee).reverse();
    const after = walk(shiftIndex.covering, (s) => s.coveringFor as Employee);
    const chain = [...before, emp, ...after];
    return chain.length >= 3 ? chain : null;
  };
  // Two people covering each other that day.
  const swappedWith = (emp: Employee, dateKey: string): Employee | null => {
    const coveredBy = shiftIndex.coveredBy.get(`${emp._id}_${dateKey}`) ?? [];
    const covering = shiftIndex.covering.get(`${emp._id}_${dateKey}`) ?? [];
    for (const s of coveredBy) {
      const other = s.employee;
      if (other && typeof other === 'object' && covering.some((c) => idOf(c.coveringFor as Employee) === other._id)) return other;
    }
    return null;
  };

  // This month's covers involving anyone shown — doing it or covered — for the totals.
  const covers = useMemo(() => {
    const shown = new Set(rows.map((e) => e._id));
    return (shiftsData?.data ?? []).filter(
      (s) =>
        s.status === 'scheduled' &&
        !!s.coveringFor &&
        (shown.has(idOf(s.employee as Employee) ?? '') || shown.has(idOf(s.coveringFor as Employee) ?? ''))
    );
  }, [shiftsData?.data, rows]);
  const totalHours = covers.reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);

  const selectedDepartment = allDepartments.find((d) => d._id === departmentFilter);
  const selectedPosition = allPositions.find((p) => p._id === positionFilter);
  const selectedPerson = allEmployees.find((e) => e._id === personFilter);
  const printPeriod = datedWeek
    ? `ອາທິດ ${rangeStart.format('DD/MM/YYYY')} - ${rangeEnd.format('DD/MM/YYYY')}`
    : usingRange
      ? `ວັນທີ ${rangeStart.format('DD/MM/YYYY')} - ${rangeEnd.format('DD/MM/YYYY')}`
      : `ປະຈໍາເດືອນ ${monthStart.format('MMMM YYYY')}`;
  // Worded the way ສະຫຼຸບເງິນເດືອນ words its own.
  const printTitle = (() => {
    let base = 'ຕາຕະລາງການເຮັດແທນ';
    if (!selectedDepartment && !selectedPosition && !selectedPerson) {
      base += 'ທັງໝົດ';
    } else {
      if (selectedDepartment) base += selectedDepartment.name;
      if (selectedPosition) base += selectedPosition.name;
      if (selectedPerson) base += `${selectedPerson.firstName ?? ''} ${selectedPerson.lastName ?? ''}`;
    }
    return `${base} ${printPeriod}`;
  })();

  const { mutate: deleteShift } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  // ---- ວາງແຜນວັນພັກ (planner mode). On a coming week each day pressed moves that
  // person's rest day to it (Ctrl adds another, pressing a rest day takes it
  // off); saved for good from that week's Monday — every week rests on one
  // pattern — after the same check as before (restDayPlanShared.tsx). The picks
  // live in planDraft, so a click redraws that person's row, not the table.
  const { data: identity } = useGetIdentity<Identity>();
  const canPlan = planner && (identity?.role === 'admin' || identity?.role === 'manager');
  const [planDraft] = useState(createPlanDraft);
  const plan = useRestDayPlanSchedule(editableWeek ? weekMonday : null);
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    planDraft.setMonday(editableWeek ? weekMonday : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableWeek, weekMonday]);
  useEffect(() => {
    planDraft.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.rowsByEmployee]);
  const employeeById = useMemo(() => new Map(allEmployees.map((e) => [e._id, e])), [allEmployees]);
  // Another week with picks not saved yet: asked first, they don't carry over.
  const changeWeek = (monday: string) => {
    const unsaved = Object.keys(planDraft.all()).length;
    if (!unsaved) {
      setWeekMonday(monday);
      return;
    }
    Modal.confirm({
      title: `ຖິ້ມການແກ້ໄຂ ${unsaved} ຄົນທີ່ຍັງບໍ່ໄດ້ບັນທຶກ?`,
      okText: 'ຖິ້ມ ແລະ ປ່ຽນອາທິດ',
      cancelText: 'ບໍ່',
      onOk: () => {
        planDraft.clear();
        setWeekMonday(monday);
      },
    });
  };
  const afterRestChange = (effectiveDate?: string) => {
    // Saved from 📅: show the week it starts on.
    if (planner && effectiveDate) {
      const d = dayjs(effectiveDate);
      const monday = d.subtract((d.day() + 6) % 7, 'day').format('YYYY-MM-DD');
      if (monday !== weekMonday) changeWeek(monday);
    }
    refetchRestSchedule();
    invalidate({ resource: 'employees', invalidates: ['list'] });
    invalidate({ resource: 'leaves', invalidates: ['list'] });
  };
  const afterPlanSaved = () => {
    plan.refetch();
    afterRestChange();
    planDraft.clear();
  };
  // A move always starts on a coming Monday: pressed on this week, the page
  // goes to the first week it can start on and makes the same move there, once
  // that week's rest days are in. Earlier weeks are history and take no clicks.
  const firstPlannableMonday = useMemo(() => upcomingMondays(dayjs())[0].format('YYYY-MM-DD'), []);
  const [carriedPick, setCarriedPick] = useState<{ emp: Employee; dow: number; adding: boolean } | null>(null);
  useEffect(() => {
    if (!carriedPick || weekMonday !== firstPlannableMonday || plan.isLoading || !plan.rowsByEmployee) return;
    const { emp, dow, adding } = carriedPick;
    setCarriedPick(null);
    togglePlanDay(emp, dow, adding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedPick, weekMonday, plan.isLoading, plan.rowsByEmployee]);
  const togglePlanDay = (emp: Employee, dow: number, adding: boolean) => {
    if (!canPlan || emp.status !== 'active' || pastWeek) return;
    if (!editableWeek) {
      notify?.({
        type: 'success',
        message: `ການຍ້າຍວັນພັກມີຜົນແຕ່ວັນຈັນ — ໄປອາທິດ ${dayjs(firstPlannableMonday).format('DD/MM')} – ${dayjs(firstPlannableMonday).add(6, 'day').format('DD/MM/YYYY')} ໃຫ້ແລ້ວ`,
      });
      setCarriedPick({ emp, dow, adding });
      setWeekMonday(firstPlannableMonday);
      return;
    }
    if (planRef.current.isLoading) return;
    const planned = planRef.current.plannedOf(emp);
    const current = planDraft.get(emp._id) ?? planned;
    if (!current.includes(dow) && effectiveRestrictedRestDays(emp).includes(dow)) {
      notify?.({ type: 'error', message: `ຕຳແໜ່ງນີ້ຫ້າມພັກ${WEEKDAY_OPTIONS[dow].label}` });
      return;
    }
    const next = current.includes(dow) ? current.filter((d) => d !== dow) : adding ? [...current, dow] : [dow];
    planDraft.set(emp._id, sameRest(next, planned) ? undefined : next);
  };
  // One day on ວາງແຜນວັນພັກ: rest (as picked, on a coming week) or leave or the
  // shift, and the covers that day — who they cover and who covers them.
  const planCell = (emp: Employee, dateKey: string, picked: number[] | undefined) => {
    const info = infoOn(emp, dateKey);
    const dow = dayjs(dateKey).day();
    const planned = editableWeek ? planRef.current.plannedOf(emp) : [];
    // On a coming week the regular rest day is the one being planned; a day off
    // set for that date alone (or the shop closed) stays off either way.
    const own = shiftIndex.own.get(`${emp._id}_${dateKey}`);
    const restingRecurring = editableWeek ? (picked ?? planned).includes(dow) : false;
    const resting = editableWeek ? restingRecurring || own?.status === 'rest' : info.status.kind === 'rest';
    const onLeave = info.status.kind === 'leave';
    // A regular rest day moved away is a working day again: their shift that day.
    const work = info.status.kind === 'work' ? info.status : !resting && info.status.kind === 'rest' ? regularTimeOn(emp, dateKey) : null;
    const changed = editableWeek && !!picked && picked.includes(dow) !== planned.includes(dow);
    const clickable = planner && canPlan && emp.status === 'active' && !pastWeek;
    const blocked = clickable && editableWeek && !restingRecurring && effectiveRestrictedRestDays(emp).includes(dow);
    return (
      <div
        className="rest-plan-cell"
        onClick={(event) => togglePlanDay(emp, dow, event.ctrlKey || event.metaKey)}
        title={blocked ? `ຕຳແໜ່ງນີ້ຫ້າມພັກ${WEEKDAY_OPTIONS[dow].label}` : undefined}
        style={{
          minHeight: 44,
          padding: '4px',
          borderRadius: 4,
          cursor: !clickable ? 'default' : blocked ? 'not-allowed' : 'pointer',
          background: resting ? OFF_STYLE.rest.background : onLeave ? OFF_STYLE.leave.background : undefined,
          outline: changed ? '2px dashed #1677ff' : undefined,
          outlineOffset: -2,
        }}
      >
        <div style={{ textAlign: 'center', fontSize: 12 }}>
          {resting ? (
            <span style={{ color: '#722ed1', fontWeight: 600 }}>{info.status.kind === 'rest' && info.status.holidayName ? 'ຮ້ານປິດ' : 'ພັກ'}</span>
          ) : onLeave ? (
            <span style={{ color: '#ad6800', fontWeight: 600 }}>ລາ</span>
          ) : work ? (
            <span style={{ color: '#8c8c8c' }}>
              {work.start}-{work.end}
            </span>
          ) : info.status.kind === 'swapped' ? (
            <span style={{ color: '#c41d7f' }}>ສະຫຼັບກະ</span>
          ) : (
            <span style={{ color: '#bfbfbf' }}>-</span>
          )}
          {changed && <div style={{ fontSize: 10, color: '#1677ff', fontWeight: 600 }}>{restingRecurring ? 'ຈະພັກ' : 'ຈະເຮັດວຽກ'}</div>}
        </div>
        {info.covering.map((s) => (
          <div key={s._id} style={{ fontSize: 11, color: '#531dab', lineHeight: 1.3 }}>
            ແທນ {codeOf(s.coveringFor as Employee)} {firstNameOf(s.coveringFor as Employee)} {s.startTime}-{s.endTime}
          </div>
        ))}
        {info.coveredBy.map((s) => (
          <div key={s._id} style={{ fontSize: 11, color: '#237804', lineHeight: 1.3 }}>
            ແທນໂດຍ {codeOf(s.employee as Employee)} {firstNameOf(s.employee as Employee)}
          </div>
        ))}
      </div>
    );
  };
  // ຕັ້ງວັນພັກປະຈຳອາທິດ for one person (📅 by the name, planner mode).
  const [recurringRestFor, setRecurringRestFor] = useState<Employee | null>(null);
  const { mutate: createShift, isLoading: creatingCover } = useCreate();

  const afterCoverChange = () => {
    invalidate({ resource: 'shifts', invalidates: ['list'] });
    refetch();
  };
  const removeCover = (id: string) => {
    deleteShift(
      { resource: 'shifts', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          afterCoverChange();
        },
      }
    );
  };
  const saveCover = (values: Record<string, unknown>, onDone: () => void) =>
    createShift(
      { resource: 'shifts', values: { ...values, status: 'scheduled' } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກການເຮັດແທນແລ້ວ' });
          afterCoverChange();
          onDone();
        },
        onError: (err: any) => {
          notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
        },
      }
    );

  // ຫາຄົນແທນ — someone's day off, handed to whoever HR picks. Every employee
  // is listed with their own day so the choice is HR's; the time starts from
  // the shift the person off would have worked.
  const [assignFor, setAssignFor] = useState<{ employee: Employee; dateKey: string } | null>(null);
  const [assignForm] = Form.useForm();
  const assignCovererId = Form.useWatch('coverer', assignForm);
  // The picked coverer's own shift that day, which they'd be leaving.
  const assignCovererShift = (() => {
    if (!assignFor || !assignCovererId) return null;
    const coverer = allEmployees.find((e) => e._id === assignCovererId);
    const status = coverer ? statusOn(coverer, assignFor.dateKey) : null;
    return status?.kind === 'work' ? status : null;
  })();
  const [modalApi, modalContext] = Modal.useModal();
  // Whoever just went to cover has left their own shift empty — offered the
  // next link of the chain straight away, unless someone's already on it.
  const offerNextCover = (covererId: string, dateKey: string) => {
    const coverer = allEmployees.find((e) => e._id === covererId);
    if (!coverer) return;
    const status = statusOn(coverer, dateKey);
    if (status.kind !== 'work' || shiftIndex.coveredBy.get(`${covererId}_${dateKey}`)?.length) return;
    modalApi.confirm({
      title: `ກະ ${status.start}-${status.end} ຂອງ ${codeOf(coverer)} ${fullName(coverer)} ຫວ່າງແລ້ວ`,
      content: 'ຄົນນີ້ໄປເຮັດແທນ ກະຂອງຕົນເອງໃນມື້ນີ້ຈຶ່ງບໍ່ມີຄົນເຮັດ — ຕ້ອງການຫາຄົນແທນກະນີ້ຕໍ່ບໍ?',
      okText: 'ຫາຄົນແທນຕໍ່',
      cancelText: 'ບໍ່ຕ້ອງ',
      onOk: () => setAssignFor({ employee: coverer, dateKey }),
    });
  };
  const assignTime = (() => {
    if (!assignFor) return undefined;
    const time = ownTimeOn(assignFor.employee, assignFor.dateKey);
    return time ? [dayjs(`${assignFor.dateKey}T${time.start}`), dayjs(`${assignFor.dateKey}T${time.end}`)] : undefined;
  })();
  const assignOptions = useMemo(() => {
    if (!assignFor) return [];
    return allEmployees
      .filter((e) => e._id !== assignFor.employee._id)
      .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? ''))
      .map((e) => {
        const covering = shiftIndex.covering.get(`${e._id}_${assignFor.dateKey}`) ?? [];
        // One cover a day for ordinary staff — someone who already covers
        // that day, or has a set shift of their own then, can't be picked
        // (the server refuses it too). ມາບໍ່ປົກກະຕິ people can take several.
        const busy =
          (covering.length > 0 || shiftIndex.own.get(`${e._id}_${assignFor.dateKey}`)?.status === 'scheduled') && !followsIrregularRule(e);
        return {
          value: e._id,
          label: `${e.employeeCode ?? ''} ${fullName(e)}`.trim(),
          position: positionOf(e),
          disabled: busy,
          day: [
            dayStatusLabel(statusOn(e, assignFor.dateKey)),
            ...covering.map((s) => `ແທນ ${codeOf(s.coveringFor as Employee)} ${s.startTime}-${s.endTime}`),
            ...(busy ? ['ມີວຽກໃນມື້ນີ້ແລ້ວ — ມອບເພີ່ມບໍ່ໄດ້'] : []),
          ].join(' · '),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignFor, allEmployees, shiftIndex, leaveRanges, restRowsByEmployee, shiftLogsByEmployee]);
  const submitAssign = async () => {
    if (!assignFor) return;
    const values = await assignForm.validateFields();
    const positionId = idOf(assignFor.employee.position);
    if (!positionId) {
      notify?.({ type: 'error', message: 'ຜູ້ຖືກແທນຍັງບໍ່ມີຕຳແໜ່ງ ກະລຸນາຕັ້ງຕຳແໜ່ງໃຫ້ກ່ອນ' });
      return;
    }
    saveCover(
      {
        employee: values.coverer,
        coveringFor: assignFor.employee._id,
        position: positionId,
        date: assignFor.dateKey,
        startTime: (values.time as [Dayjs, Dayjs])[0].format('HH:mm'),
        endTime: (values.time as [Dayjs, Dayjs])[1].format('HH:mm'),
      },
      () => {
        const { dateKey } = assignFor;
        setAssignFor(null);
        offerNextCover(values.coverer, dateKey);
      }
    );
  };

  // ມອບໝາຍການເຮັດແທນ — the same, with the coverer, date and covered person all
  // picked by hand; mirrors ຕັ້ງຄ່າແຜນວຽກ's own "ໄປເຮັດແທນຄົນອື່ນ" flow
  // (monthly.tsx's handleCover).
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const createCoverer = Form.useWatch('coverer', createForm);
  const createCoverDept = Form.useWatch('coverDept', createForm);
  const createCoverPos = Form.useWatch('coverPos', createForm);

  const createDeptOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      if (e.department && typeof e.department === 'object') map.set(e.department._id, e.department.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);
  const createPosOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      if (createCoverDept && idOf(e.department) !== createCoverDept) continue;
      if (e.position && typeof e.position === 'object') map.set(e.position._id, e.position.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees, createCoverDept]);
  const createTargetOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => e._id !== createCoverer)
        .filter((e) => (!createCoverDept || idOf(e.department) === createCoverDept) && (!createCoverPos || idOf(e.position) === createCoverPos))
        .map((e) => ({ value: e._id, label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() })),
    [allEmployees, createCoverDept, createCoverPos, createCoverer]
  );
  const covererOptions = useMemo(
    () => allEmployees.map((e) => ({ value: e._id, label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() })),
    [allEmployees]
  );
  const fillCoverTime = (coveredId: string) => {
    const date = createForm.getFieldValue('date') as Dayjs | undefined;
    if (!date) return;
    const covered = allEmployees.find((e) => e._id === coveredId);
    const time = covered ? ownTimeOn(covered, date.format('YYYY-MM-DD')) : null;
    if (time) createForm.setFieldValue('time', [dayjs(`${date.format('YYYY-MM-DD')}T${time.start}`), dayjs(`${date.format('YYYY-MM-DD')}T${time.end}`)]);
  };
  const submitCreateCover = async () => {
    const values = await createForm.validateFields();
    const covered = allEmployees.find((e) => e._id === values.coveredEmployee);
    const coveredPositionId = idOf(covered?.position);
    if (!coveredPositionId) {
      notify?.({ type: 'error', message: 'ຜູ້ຖືກແທນຍັງບໍ່ມີຕຳແໜ່ງ ກະລຸນາຕັ້ງຕຳແໜ່ງໃຫ້ກ່ອນ' });
      return;
    }
    saveCover(
      {
        employee: values.coverer,
        coveringFor: values.coveredEmployee,
        position: coveredPositionId,
        date: (values.date as Dayjs).format('YYYY-MM-DD'),
        startTime: (values.time as [Dayjs, Dayjs])[0].format('HH:mm'),
        endTime: (values.time as [Dayjs, Dayjs])[1].format('HH:mm'),
      },
      () => {
        setCreateOpen(false);
        createForm.resetFields();
        offerNextCover(values.coverer, (values.date as Dayjs).format('YYYY-MM-DD'));
      }
    );
  };

  // One cover this person does. On the weekly roster a card stands for every
  // date it happened on, so it says how many times instead of offering a delete.
  const coverCard = (s: Shift, key: string, count?: number) => (
    <div
      key={key}
      style={{
        borderLeft: '3px solid #722ed1',
        background: '#f9f0ff',
        borderRadius: 4,
        padding: '4px 6px',
        textAlign: 'left',
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        ແທນ {codeOf(s.coveringFor as Employee)} {fullName(s.coveringFor as Employee)}
      </div>
      <div style={{ color: '#595959' }}>
        {deptOf(s.coveringFor as Employee)} · {s.position && typeof s.position === 'object' ? s.position.name : '-'}
      </div>
      <div style={{ color: '#531dab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {s.startTime}-{s.endTime} ({hoursBetween(s.startTime, s.endTime)} ຊມ.)
        </span>
        {count === undefined ? (
          <Popconfirm title="ລຶບການເຮັດແທນນີ້?" onConfirm={() => removeCover(s._id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : (
          <span style={{ fontWeight: 600 }} title={`${count} ຄັ້ງໃນເດືອນນີ້`}>
            ×{count}
          </span>
        )}
      </div>
    </div>
  );
  // Who covers this person on a day off.
  const coveredByLine = (s: Shift, key: string, count?: number) => (
    <div key={key} style={{ fontSize: 12, color: '#237804', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
      <span>
        ແທນໂດຍ {codeOf(s.employee as Employee)} {fullName(s.employee as Employee)} · {s.startTime}-{s.endTime}
      </span>
      {count === undefined ? (
        <Popconfirm title="ລຶບການເຮັດແທນນີ້?" onConfirm={() => removeCover(s._id)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ) : (
        <span style={{ fontWeight: 600 }}>×{count}</span>
      )}
    </div>
  );
  const dayCellStyle = (info: DayInfo) => {
    if (info.status.kind === 'rest' || info.status.kind === 'leave') return { style: OFF_STYLE[info.status.kind] };
    return info.status.kind === 'work' && info.coveredBy.length ? { style: COVERED_WORK_STYLE } : {};
  };

  // Who covers whom along the line this day is part of — this person in bold.
  const chainLine = (emp: Employee, dateKey: string) => {
    const swapped = swappedWith(emp, dateKey);
    const chain = swapped ? [emp, swapped] : coverChain(emp, dateKey);
    if (!chain) return null;
    const separator = swapped ? ' ⇄ ' : ' → ';
    const names = chain.map((p) => `${codeOf(p)} ${fullName(p)}`.trim()).join(separator);
    return (
      <Tooltip title={swapped ? `ແທນກັນ: ${names}` : `ສາຍການແທນ (ຄົນທາງຊ້າຍໄປແທນຄົນຖັດໄປ): ${names}`}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textAlign: 'left' }}>
          <LinkOutlined />{' '}
          {chain.map((p, i) => (
            <span key={p._id}>
              {i > 0 && separator}
              <span style={p._id === emp._id ? { fontWeight: 700, color: '#434343' } : undefined}>{codeOf(p) || fullName(p)}</span>
            </span>
          ))}
        </div>
      </Tooltip>
    );
  };

  const dateCell = (emp: Employee, dateKey: string) => {
    const info = infoOn(emp, dateKey);
    const off = isOff(info.status);
    const working = info.status.kind === 'work';
    const openAssign = () => setAssignFor({ employee: emp, dateKey });
    if (!off && !info.covering.length && !info.coveredBy.length) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <span style={{ color: '#bfbfbf' }}>-</span>
          {working && <AddCoverButton onClick={openAssign} />}
        </div>
      );
    }
    // Off, or gone to cover someone with nobody on their own shift yet: someone
    // is needed, so the button stays visible. Otherwise it waits for the pointer.
    const needsCover = off || (working && info.covering.length > 0 && !info.coveredBy.length);
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {off && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{dayStatusLabel(info.status)}</div>}
        {info.status.kind === 'work' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
            <span
              style={{ color: '#8c8c8c', fontSize: 12, textDecoration: info.covering.length ? 'line-through' : undefined }}
              title={info.covering.length ? 'ມື້ນີ້ໄປເຮັດແທນ — ຕ້ອງສະແກນຕາມເວລາຂອງການແທນ ບໍ່ແມ່ນກະນີ້' : undefined}
            >
              ກະ {info.status.start}-{info.status.end}
            </span>
            {!needsCover && <AddCoverButton onClick={openAssign} />}
          </div>
        )}
        {info.coveredBy.map((s) => coveredByLine(s, s._id))}
        {needsCover && (
          <Button size="small" type="link" icon={<PlusOutlined />} style={{ padding: 0, height: 'auto' }} onClick={openAssign}>
            ຫາຄົນແທນ
          </Button>
        )}
        {info.covering.map((s) => coverCard(s, s._id))}
        {chainLine(emp, dateKey)}
      </Space>
    );
  };

  // Header lines for each column: how many in the group are off, how many of
  // them have someone covering, and how many normal working days are covered.
  const dateSummary = (dateKey: string, list: Employee[] = rows) => {
    let off = 0;
    let covered = 0;
    let workCovered = 0;
    for (const emp of list) {
      const info = infoOn(emp, dateKey);
      if (!isOff(info.status)) {
        if (info.status.kind === 'work' && info.coveredBy.length) workCovered += 1;
        continue;
      }
      off += 1;
      if (info.coveredBy.length) covered += 1;
    }
    return { off, covered, workCovered };
  };

  // The dialogs' state sits on this component, and with everyone showing this
  // table is thousands of cells: without this, every click in ຫາຄົນແທນ draws all
  // of it again and takes seconds. Lists what the cells show; the handlers they
  // call read no page state.
  const employeeTable = useMemo(
    () => (
      <Table<Employee>
        className="covers-no-print"
        dataSource={rows}
        rowKey="_id"
        loading={isLoading || employeesLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="small"
        sticky={{ offsetHeader: pinToolbar ? offsetHeader : stackTop }}
        locale={{ emptyText: 'ບໍ່ມີພະນັກງານໃນພະແນກ / ຕຳແໜ່ງນີ້' }}
      >
        <Table.Column
          title="ພະນັກງານ"
          fixed="left"
          width={200}
          render={(_, emp: Employee) => (
            <>
              <div style={{ fontWeight: 600 }}>
                {emp.employeeCode} {fullName(emp)}
                {canPlan && (
                  <Button
                    size="small"
                    type="text"
                    icon={<CalendarOutlined />}
                    title="ຕັ້ງວັນພັກປະຈຳອາທິດ"
                    aria-label="ຕັ້ງວັນພັກປະຈຳອາທິດ"
                    onClick={() => setRecurringRestFor(emp)}
                  />
                )}
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ກະ: {shiftLabel(emp)}
                </Typography.Text>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ວັນພັກ: {restDaysLabel(emp.defaultRestDay ?? [])}
                </Typography.Text>
              </div>
            </>
          )}
        />
        <Table.Column title="ພະແນກ" width={130} render={(_, emp: Employee) => deptOf(emp)} />
        <Table.Column title="ຕຳແໜ່ງ" width={130} render={(_, emp: Employee) => positionOf(emp)} />
        {rangeDays.map((day) => {
              const dateKey = day.format('YYYY-MM-DD');
              const summary = dateSummary(dateKey);
              return (
                <Table.Column
                  key={dateKey}
                  width={150}
                  title={
                    <div style={{ textAlign: 'center' }}>
                      <div>{datedWeek ? WEEKDAY_OPTIONS[day.day()].label : day.format('D')}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {datedWeek ? day.format('DD/MM') : day.format('ddd')}
                      </Typography.Text>
                      {summary.off > 0 && (
                        <div style={{ fontSize: 11, fontWeight: 400, color: summary.covered < summary.off ? '#d46b08' : '#389e0d' }}>
                          ພັກ/ລາ {summary.off} · ແທນ {summary.covered}
                        </div>
                      )}
                      {summary.workCovered > 0 && (
                        <div style={{ fontSize: 11, fontWeight: 400, color: '#0958d9' }}>ແທນມື້ປົກກະຕິ {summary.workCovered}</div>
                      )}
                    </div>
                  }
                  onCell={(emp: Employee) => (planner ? {} : dayCellStyle(infoOn(emp, dateKey)))}
                  render={(_, emp: Employee) =>
                    planner ? (
                      <PlannedCell draft={planDraft} employeeId={emp._id} render={(picked) => planCell(emp, dateKey, picked)} />
                    ) : (
                      dateCell(emp, dateKey)
                    )
                  }
                />
              );
            })}
      </Table>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, rows, rangeDays, dayInfo, shiftIndex, isLoading, employeesLoading, pinToolbar, offsetHeader, stackTop, planner, editableWeek, pastWeek, plan.rowsByEmployee, canPlan]
  );
  // New data draws it in the background, so ຫາຄົນແທນຕໍ່ right after saving doesn't
  // wait for the reload that the save set off.
  const shownTable = useDeferredValue(employeeTable);

  // The print's day columns: the weekly roster's seven weekdays, or the dates
  // picked in the month view. A whole month is too narrow to read, so the month
  // view prints only once dates are picked (null: nothing to print).
  const coverLine = (c: { shift: Shift; key: string; count?: number }, coveredBy: boolean) => (
    <div key={c.key} style={{ color: coveredBy ? PRINT_TONE.coveredBy.text : PRINT_TONE.covering.text }}>
      {coveredBy
        ? `ແທນໂດຍ ${codeOf(c.shift.employee as Employee)} ${firstNameOf(c.shift.employee as Employee)}`
        : `ແທນ ${codeOf(c.shift.coveringFor as Employee)} ${firstNameOf(c.shift.coveringFor as Employee)}`}{' '}
      {c.shift.startTime}-{c.shift.endTime}
      {c.count !== undefined && ` ×${c.count}`}
    </div>
  );
  // The columns for one printed table — its header counts are for the people in
  // it (`list`).
  const printDaysFor = (list: Employee[]): PrintDay[] | null =>
    datedWeek || usingRange
        ? rangeDays.map((day) => {
            const dateKey = day.format('YYYY-MM-DD');
            return {
              key: dateKey,
              header: (
                <>
                  <div>{day.format('DD/MM')}</div>
                  <div>{WEEKDAY_OPTIONS[day.day()].label}</div>
                  <div style={{ fontWeight: 400, fontSize: 7, color: '#8c8c8c' }}>ພັກ/ລາ {dateSummary(dateKey, list).off} ຄົນ</div>
                </>
              ),
              cell: (emp) => {
                const info = infoOn(emp, dateKey);
                const kind = info.status.kind;
                return {
                  tone: kind === 'rest' ? PRINT_TONE.rest : kind === 'leave' ? PRINT_TONE.leave : info.covering.length ? PRINT_TONE.covering : undefined,
                  lines: (
                    <>
                      {(kind === 'rest' || kind === 'leave') && (
                        <div style={{ fontWeight: 700, textAlign: 'center' }}>{kind === 'rest' ? 'ພ' : 'ລາ'}</div>
                      )}
                      {info.coveredBy.map((s2) => coverLine({ shift: s2, key: s2._id }, true))}
                      {info.covering.map((s2) => coverLine({ shift: s2, key: s2._id }, false))}
                    </>
                  ),
                };
              },
            };
          })
        : null;
  const printDays = printDaysFor(rows);
  // What prints: what's on screen, or each department picked in ພິມ.
  const printBlocks = printJob
    ? printJob.map((section) => {
        const list = sortedEmployees.filter((e) => section.employeeIds.has(e._id));
        return { key: section.key, title: `ຕາຕະລາງການເຮັດແທນ${section.departmentName}${positionsNote(section)} ${printPeriod}`, rows: list, days: printDaysFor(list) };
      })
    : [{ key: 'shown', title: printTitle, rows, days: printDays }];

  return (
    <div>
      {modalContext}
      <style>{`
        .covers-print-only { display: none; }
        .covers-print-table { display: none; }
        /* The ຫາຄົນແທນ on a normal working day: on every cell it would swamp
           the grid, so it shows with the pointer (or keyboard focus) — and
           faintly always where there's no pointer to hover with. */
        .covers-add-work { opacity: 0; transition: opacity 0.15s; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font-size: 16px; line-height: 1; cursor: pointer; }
        .covers-add-work::before { content: '+'; }
        .covers-add-work:hover { background: rgba(128, 128, 128, 0.2); }
        .ant-table-cell:hover .covers-add-work, .covers-add-work:focus-visible { opacity: 1; }
        @media (hover: none) { .covers-add-work { opacity: 0.5; } }
        @media print {
          @page { size: A4 landscape; margin: 5mm; }
          .covers-no-print { display: none !important; }
          .covers-print-only { display: flex !important; }
          .covers-print-table { display: table !important; }
          /* Chrome/Edge drop background colors on print by default — without
             this, the day colors and the header row tint would all print as
             plain white. */
          .covers-print-table, .covers-print-table *, .covers-print-only, .covers-print-only * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body:has(.covers-print-table) .ant-layout-header { display: none !important; }
          body:has(.covers-print-table) .ant-page-header-heading { display: none !important; }
          /* ສະຫຼຸບເງິນເດືອນ has no side menu at all (AppSider's HIDDEN_ON_PATHS);
             this page keeps it on screen, so the print drops it and the space
             held for it to match. */
          body:has(.covers-print-table) .ant-layout-has-sider > aside.ant-layout-sider,
          body:has(.covers-print-table) .ant-layout-has-sider > div:not(.ant-layout) { display: none !important; }
          /* The ພິມ dialog may still be closing when the print starts. */
          .ant-modal-root { display: none !important; }
        }
      `}</style>
      {/* Pinned with the date/weekday header below it (and the table's own
          sideways scrollbar), so a long list on a narrow screen can still be
          scrolled both ways without losing the columns. */}
      <div
        ref={toolbarRef}
        className="covers-no-print"
        style={{ position: pinToolbar ? 'sticky' : 'static', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}
      >
        <Space wrap>
          {planner ? (
            <>
              <Select className="covers-week" value={weekMonday} onChange={(v: string) => changeWeek(v)} options={weekOptions} style={{ width: 300 }} />
              {!editableWeek && (
                <Typography.Text type="secondary" className="covers-week-note">
                  {pastWeek ? 'ອາທິດທີ່ຜ່ານມາ — ເບິ່ງປະຫວັດໄດ້ຢ່າງດຽວ' : 'ອາທິດນີ້ — ກົດມື້ໃດ ຈະໄປຍ້າຍແຕ່ວັນຈັນໜ້າ'}
                </Typography.Text>
              )}
            </>
          ) : (
            <>
          <Segmented
            value={view}
            onChange={(v) => setView(v as CoverView)}
            options={[
              { label: 'ລາຍເດືອນ', value: 'month' },
              { label: 'ລາຍອາທິດ', value: 'week' },
            ]}
          />
          {view === 'week' ? (
            <Select className="covers-week" value={weekMonday} onChange={(v: string) => setWeekMonday(v)} options={weekOptions} style={{ width: 300 }} />
          ) : (
            <>
              <Button icon={<LeftOutlined />} onClick={() => goToMonth(monthStart.subtract(1, 'month'))} />
              <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
              <Button icon={<RightOutlined />} onClick={() => goToMonth(dayjs())}>
                ເດືອນນີ້
              </Button>
              <Button icon={<RightOutlined />} onClick={() => goToMonth(monthStart.add(1, 'month'))} />
            </>
          )}
          {view === 'month' && (
            <DatePicker.RangePicker
              className="covers-range"
              format="DD/MM/YYYY"
              placeholder={['ຈາກວັນທີ', 'ຫາວັນທີ']}
              value={dayRange}
              // Picking the second date: nothing more than MAX_PRINT_DAYS from the first.
              disabledDate={(current, info) => !!info?.from && Math.abs(current.startOf('day').diff(info.from.startOf('day'), 'day')) >= MAX_PRINT_DAYS}
              onChange={(dates) => {
                const picked = dates && dates[0] && dates[1] ? ([dates[0], dates[1]] as [Dayjs, Dayjs]) : null;
                // Typed dates don't go through disabledDate.
                if (picked && picked[1].startOf('day').diff(picked[0].startOf('day'), 'day') >= MAX_PRINT_DAYS) {
                  notify?.({ type: 'error', message: `ເລືອກໄດ້ບໍ່ເກີນ ${MAX_PRINT_DAYS} ວັນ` });
                  return;
                }
                setDayRange(picked);
                if (picked) setMonthStart(picked[0].startOf('month'));
              }}
            />
          )}
            </>
          )}
          <Select
            {...departmentSelect}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 180 }}
            value={departmentFilter}
            onChange={(v: any) => {
              setDepartmentFilter(v);
              const stillValid =
                !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some((d) => idOf(d) === v);
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
          {!planner && (
            <>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                ມອບໝາຍການເຮັດແທນ
              </Button>
              <Tooltip title={view === 'month' && !dayRange ? `ເລືອກຊ່ວງວັນທີ (ບໍ່ເກີນ ${MAX_PRINT_DAYS} ວັນ) ກ່ອນພິມ` : undefined}>
                <Button icon={<PrinterOutlined />} disabled={!printDays} onClick={() => setPrintPickerOpen(true)}>
                  ພິມ
                </Button>
              </Tooltip>
            </>
          )}
        </Space>
      </div>

      <Space size={16} wrap className="covers-no-print" style={{ marginBottom: 16 }}>
        <Card size="small">
          <Statistic title="ພະນັກງານ" value={rows.length} suffix="ຄົນ" />
        </Card>
        <Card size="small">
          <Statistic title={`ຈຳນວນການເຮັດແທນ${periodText}`} value={covers.length} />
        </Card>
        <Card size="small">
          <Statistic title="ລວມຊົ່ວໂມງເຮັດແທນ" value={totalHours} precision={2} suffix="ຊມ." />
        </Card>
      </Space>
      <Typography.Paragraph type="secondary" className="covers-no-print">
        {planner
          ? 'ວັນພັກ, ມື້ລາ ແລະ ການເຮັດແທນຂອງແຕ່ລະມື້ໃນອາທິດທີ່ເລືອກ. ກົດຊ່ອງວັນເພື່ອຍ້າຍວັນພັກໄປວັນນັ້ນ (ກົດ Ctrl ຄ້າງໄວ້: ເພີ່ມອີກວັນ · ກົດວັນພັກອີກເທື່ອ: ເອົາອອກ), ແລ້ວກົດ ກວດ ແລະ ບັນທຶກ — ການຍ້າຍມີຜົນແຕ່ວັນຈັນຂອງອາທິດທີ່ສະແດງ; ກົດໃນອາທິດນີ້ ຫຼື ທີ່ຜ່ານມາ ໜ້າຈໍຈະໄປອາທິດໜ້າໃຫ້ (ອາທິດທຳອິດທີ່ຍ້າຍໄດ້). 📅 ຂ້າງຊື່: ຕັ້ງວັນພັກປະຈຳຂອງຄົນນັ້ນ (ລວມທັງຄົນໃໝ່ທີ່ຍັງບໍ່ມີວັນພັກ)'
          : view === 'week'
          ? 'ອາທິດທີ່ເລືອກ — ທຸກຄົນໃນພະແນກ / ຕຳແໜ່ງທີ່ເລືອກ: ມື້ພັກ, ມື້ລາ ແລະ ມື້ເຮັດວຽກທີ່ມີຄົນແທນ. ກົດ "ຫາຄົນແທນ" ໃນມື້ນັ້ນ ເພື່ອມອບໝາຍ (ມື້ເຮັດວຽກປົກກະຕິ ເອົາເມົາສ໌ຊີ້ທີ່ຊ່ອງ). ຄົນທີ່ໄປແທນຕ້ອງສະແກນຕາມເວລາຂອງການແທນ'
          : 'ທຸກຄົນໃນພະແນກ / ຕຳແໜ່ງທີ່ເລືອກ — ມື້ພັກ, ມື້ລາ ແລະ ມື້ເຮັດວຽກທີ່ມີຄົນແທນ. ກົດ "ຫາຄົນແທນ" ໃນມື້ນັ້ນ ເພື່ອມອບໝາຍ (ມື້ເຮັດວຽກປົກກະຕິ ເອົາເມົາສ໌ຊີ້ທີ່ຊ່ອງ). ຄົນທີ່ໄປແທນຕ້ອງສະແກນຕາມເວລາຂອງການແທນ ບໍ່ແມ່ນກະປົກກະຕິຂອງຕົນເອງ'}
      </Typography.Paragraph>

      {/* The weekly roster prints, and the month view once dates are picked —
          what's on screen, or each department picked in ພິມ, each on new pages. */}
      {printBlocks.map((block, blockIndex) => {
        const blockDays = block.days;
        if (!blockDays) return null;
        return (
        <div key={block.key} className="covers-print-block" style={blockIndex ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
          <div className="covers-print-only" style={{ flexWrap: 'wrap', gap: 12, fontSize: 9, marginBottom: 4 }}>
            {PRINT_LEGEND_DATES.map((item) => (
              <span key={item.tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 12,
                    height: 12,
                    padding: '0 2px',
                    background: PRINT_TONE[item.tone].bg,
                    color: PRINT_TONE[item.tone].text,
                    border: '1px solid #999',
                    fontWeight: 700,
                    fontSize: 8,
                  }}
                >
                  {item.label}
                </span>
                {item.text}
              </span>
            ))}
          </div>

          <table className="covers-print-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 9 }}>
            <colgroup>
              {PRINT_FIXED_COLS.map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
              {blockDays.map((d) => (
                <col key={d.key} style={{ width: (PRINT_PAGE_WIDTH_PX - PRINT_FIXED_COLS_WIDTH_PX) / blockDays.length }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* Spans the whole header row so it repeats on every printed page
                    with the column headers below it, as on ສະຫຼຸບເງິນເດືອນ. */}
                <th colSpan={PRINT_FIXED_COLS.length + blockDays.length} style={{ border: '1px solid #999', borderBottom: '2px solid #A9761E', padding: '6px 10px', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
                    <div style={{ fontWeight: 700, letterSpacing: 1, minWidth: 90, textAlign: 'left' }}>ROMEO</div>
                    <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 13 }}>{block.title}</div>
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
                <th style={PRINT_TH}>ຕຳແໜ່ງ</th>
                <th style={PRINT_TH}>ກະ</th>
                {blockDays.map((d) => (
                  <th key={d.key} style={{ ...PRINT_TH, lineHeight: 1.15 }}>
                    {d.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((emp, idx) => (
                <tr key={emp._id}>
                  <td style={PRINT_TD}>{idx + 1}</td>
                  <td style={PRINT_TD}>{emp.employeeCode || '-'}</td>
                  <td style={{ ...PRINT_TD, textAlign: 'left' }}>{`${emp.firstName ?? ''} ${emp.lastName ?? ''}`}</td>
                  <td style={{ ...PRINT_TD, textAlign: 'left' }}>{positionOf(emp)}</td>
                  <td style={PRINT_TD}>{regularShiftHours(emp) ?? '-'}</td>
                  {blockDays.map((d) => {
                    const { tone, lines } = d.cell(emp);
                    return (
                      <td
                        key={d.key}
                        style={{ ...PRINT_TD, whiteSpace: 'normal', verticalAlign: 'top', textAlign: 'left', fontSize: 8, lineHeight: 1.25, background: tone?.bg, color: tone?.text }}
                      >
                        {lines}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="covers-print-only" style={{ justifyContent: 'space-between', marginTop: 64, padding: '0 24px' }}>
            {['ຜູ້ຮັບຜິດຊອບ', 'ຜູ້ກວດສອບ', 'ຜູ້ກວດສອບ'].map((label, i) => (
              <div key={i} style={{ textAlign: 'center', width: 220 }}>
                <div style={{ height: 48 }} />
                <div style={{ borderTop: '1px solid #000' }} />
                <Typography.Title level={4} style={{ marginTop: 4, marginBottom: 0 }}>
                  {label}
                </Typography.Title>
              </div>
            ))}
          </div>
        </div>
        );
      })}

      {shownTable}

      <PrintPickerModal
        open={printPickerOpen}
        onCancel={() => setPrintPickerOpen(false)}
        employees={allEmployees}
        initialDepartment={departmentFilter}
        initialPosition={positionFilter}
        currentLabel={selectedPerson ? `${selectedPerson.employeeCode ?? ''} ${fullName(selectedPerson)}`.trim() : undefined}
        onPrintCurrent={() => {
          setPrintPickerOpen(false);
          window.setTimeout(() => window.print(), 300);
        }}
        onPrint={(sections) => {
          setPrintPickerOpen(false);
          printSections(sections);
        }}
      />

      <Modal
        title={assignFor ? `ຫາຄົນແທນ — ${assignFor.employee.employeeCode ?? ''} ${fullName(assignFor.employee)}` : ''}
        open={!!assignFor}
        onCancel={() => setAssignFor(null)}
        onOk={submitAssign}
        confirmLoading={creatingCover}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        {assignFor && (
          <>
            <Typography.Paragraph>
              {dayjs(assignFor.dateKey).format('dddd DD/MM/YYYY')} · {dayStatusLabel(statusOn(assignFor.employee, assignFor.dateKey))} ·{' '}
              {positionOf(assignFor.employee)}
            </Typography.Paragraph>
            {(shiftIndex.coveredBy.get(`${assignFor.employee._id}_${assignFor.dateKey}`)?.length ?? 0) > 0 && (
              <Typography.Paragraph type="secondary">
                ມີຄົນແທນແລ້ວ:{' '}
                {(shiftIndex.coveredBy.get(`${assignFor.employee._id}_${assignFor.dateKey}`) ?? [])
                  .map((s) => `${codeOf(s.employee as Employee)} ${fullName(s.employee as Employee)} ${s.startTime}-${s.endTime}`)
                  .join(', ')}
              </Typography.Paragraph>
            )}
            <Form form={assignForm} layout="vertical" initialValues={{ time: assignTime }} preserve={false}>
              <Form.Item name="coverer" label="ຄົນແທນ" rules={[{ required: true, message: 'ກະລຸນາເລືອກຄົນແທນ' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="ເລືອກຄົນແທນ — ທຸກຄົນ ພ້ອມວຽກຂອງເຂົາໃນມື້ນັ້ນ"
                  options={assignOptions}
                  optionRender={(option) => (
                    <div>
                      <div>
                        {option.data.label}{' '}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {option.data.position}
                        </Typography.Text>
                      </div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{option.data.day}</div>
                    </div>
                  )}
                />
              </Form.Item>
              {assignCovererShift && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`ຄົນນີ້ມີກະ ${assignCovererShift.start}-${assignCovererShift.end} ໃນມື້ນີ້ — ຈະຍ້າຍມາເຮັດກະນີ້ແທນ ແລະ ຕ້ອງສະແກນຕາມເວລາດ້ານລຸ່ມ. ກະເດີມຈະຫວ່າງ`}
                />
              )}
              <Form.Item name="time" label="ເວລາ (ຄົນແທນຕ້ອງສະແກນຕາມເວລານີ້)" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
                <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} style={{ width: '100%' }} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
        title="ມອບໝາຍການເຮັດແທນ"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={submitCreateCover}
        confirmLoading={creatingCover}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="coverer" label="ຜູ້ເຮັດແທນ" rules={[{ required: true, message: 'ກະລຸນາເລືອກຜູ້ເຮັດແທນ' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="ເລືອກຜູ້ເຮັດແທນ"
              options={covererOptions}
              onChange={() => createForm.setFieldValue('coveredEmployee', undefined)}
            />
          </Form.Item>
          <Form.Item name="date" label="ວັນທີ່" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ່' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="coverDept" label="ພະແນກ (ຜູ້ຖືກແທນ)">
              <Select
                allowClear
                placeholder="ທຸກພະແນກ"
                style={{ width: 170 }}
                options={createDeptOptions}
                onChange={() => {
                  createForm.setFieldValue('coverPos', undefined);
                  createForm.setFieldValue('coveredEmployee', undefined);
                }}
              />
            </Form.Item>
            <Form.Item name="coverPos" label="ຕຳແໜ່ງ (ຜູ້ຖືກແທນ)">
              <Select
                allowClear
                placeholder="ທຸກຕຳແໜ່ງ"
                style={{ width: 190 }}
                options={createPosOptions}
                onChange={() => createForm.setFieldValue('coveredEmployee', undefined)}
              />
            </Form.Item>
          </Space>
          <Form.Item name="coveredEmployee" label="ຜູ້ຖືກແທນ" rules={[{ required: true, message: 'ກະລຸນາເລືອກຜູ້ຖືກແທນ' }]}>
            <Select showSearch optionFilterProp="label" placeholder="ຜູ້ຖືກແທນ" options={createTargetOptions} onChange={fillCoverTime} />
          </Form.Item>
          <Form.Item name="time" label="ເວລາ" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
      {editableWeek && canPlan && (
        <>
          <div style={{ height: 96 }} />
          <RestDayPlanBar
            draft={planDraft}
            start={weekMonday}
            employeeById={employeeById}
            plannedOf={plan.plannedOf}
            ready={!plan.isLoading}
            onSaved={afterPlanSaved}
          />
        </>
      )}
      {planner && <RecurringRestDialog employee={recurringRestFor} onClose={() => setRecurringRestFor(null)} onSaved={afterRestChange} />}
    </div>
  );
};
