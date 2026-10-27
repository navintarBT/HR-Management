import { useEffect, useMemo, useRef, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import {
  useList,
  useCustom,
  useGetIdentity,
  useCreate,
  useUpdate,
  useDelete,
  useInvalidate,
  useNotification,
  useNavigation,
} from '@refinedev/core';
import { Table, Typography, Space, Button, Modal, Form, TimePicker, DatePicker, Select, Input, Popconfirm } from 'antd';
import { LeftOutlined, RightOutlined, CalendarOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type {
  AttendanceDaily,
  Employee,
  Shift,
  Identity,
  Department,
  Position,
  ShiftCategory,
  Leave,
  ScheduledShiftChange,
  ScheduledPositionSwap,
  ShiftChangeLogEntry,
  RestDayChangePlan,
  RestDayScheduleRow,
} from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { API_URL, axiosInstance } from '../../providers/axios';
import { ScheduleCoversGrid } from './covers';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { preferredOverride } from '../../utils/dayOverride';
import { groupLogsByEmployee, shiftOnDate } from '../../utils/shiftHistory';
import {
  groupRestRowsByEmployee,
  restDaysOn,
  firstMondayOfMonthAfter,
  upcomingMondays,
  mondayOptionLabel,
  effectiveRestrictedRestDays,
} from '../../utils/restDays';

// One action in the cell menu — a full-width button with a title and a one-line hint.
const ChoiceButton: React.FC<{ title: string; description: string; onClick: () => void; disabled?: boolean }> = ({
  title,
  description,
  onClick,
  disabled,
}) => (
  <Button block disabled={disabled} onClick={onClick} style={{ height: 'auto', padding: '10px 12px', textAlign: 'left' }}>
    <div>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'normal' }}>{description}</div>
    </div>
  </Button>
);

type Cell =
  | { kind: 'unset' }
  | { kind: 'rest'; isOverride: boolean; overrideId?: string; isHoliday?: boolean; holidayName?: string }
  | { kind: 'work'; start: string; end: string; isOverride: boolean; overrideId?: string; coveringFor?: Employee }
  | { kind: 'substituted' }
  | { kind: 'leave' }
  | { kind: 'swapped' };

function idOf(value: { _id: string } | string | null | undefined) {
  return value && typeof value === 'object' ? value._id : value;
}

function categoryLabel(category: ShiftCategory | string | undefined | null): string {
  if (!category || typeof category === 'string') return '-';
  return category.name ? `${category.name} (${category.startTime}-${category.endTime})` : `${category.startTime}-${category.endTime}`;
}

// The start-date choice for someone with no rest day yet: as soon as the
// week allows, worked out by the server from the days picked.
const SOONEST = 'soonest';

// Why the soonest day is the day it is (restDaySchedule.js
// effectiveDateForChange): from tomorrow while this week's rest is still
// ahead, otherwise from next Monday. A Monday picked needs no reason.
const REST_CHANGE_REASON: Partial<Record<RestDayChangePlan['reason'], string>> = {
  thisWeek: 'ອາທິດນີ້ຍັງບໍ່ທັນໄດ້ພັກ ຈຶ່ງເລີ່ມໄດ້ແຕ່ມື້ອື່ນ',
  restedThisWeek: 'ອາທິດນີ້ພັກແລ້ວ ຈຶ່ງເລີ່ມອາທິດໜ້າ',
  newDayPassed: 'ອາທິດນີ້ບໍ່ເຫຼືອວັນພັກໃໝ່ໃຫ້ພັກແລ້ວ ຈຶ່ງເລີ່ມອາທິດໜ້າ',
};
const restChangeReason = (plan: RestDayChangePlan) => REST_CHANGE_REASON[plan.reason];

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

// Monday first, the way the week is counted for rest days.
const restDaysLabel = (days: number[]) =>
  days.length
    ? [...days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_OPTIONS[d].label)
        .join(', ')
    : 'ບໍ່ມີວັນພັກປະຈຳ';

// A linked category is a live reference (unlike Shift.category, a one-time
// prefill) — editing the category's time later shows up here immediately for
// every employee that references it. Falls back to a manually-set fixed time
// for an employee with no matching category.
function resolveDefaultTime(employee: Employee): { start: string; end: string } | null {
  const category = employee.defaultShiftCategory;
  if (category && typeof category === 'object') {
    return { start: category.startTime, end: category.endTime };
  }
  if (employee.defaultShiftStart && employee.defaultShiftEnd) {
    return { start: employee.defaultShiftStart, end: employee.defaultShiftEnd };
  }
  return null;
}

// isSubstituted (AttendanceDaily.status === 'substituted') always wins — once
// marked, the queued Shift is deleted as part of that action (see
// attendanceActions.js's mark-substituted), so there's nothing left in
// `override` to check by that point anyway. An approved leave comes next,
// ahead of any Shift override — it's this table's ultimate source of truth
// for "is this person actually coming in," so it should show even if a
// stale/conflicting Shift row says otherwise underneath.
// `regularTime` is the regular shift in force on dateKey (see regularTimeOn in
// the grid below) — a past day keeps the shift it really had, not today's —
// and `restDays` the recurring rest days in force that day (restDaysFor).
function computeCell(
  restDays: number[],
  dateKey: string,
  override: Shift | undefined,
  isSubstituted: boolean,
  isOnLeave: boolean,
  regularTime: { start: string; end: string } | null
): Cell {
  if (isSubstituted) return { kind: 'substituted' };
  if (isOnLeave) return { kind: 'leave' };
  if (override) {
    if (override.status === 'rest') {
      const holiday = override.holiday;
      const isHoliday = !!(holiday && typeof holiday === 'object');
      return { kind: 'rest', isOverride: true, overrideId: override._id, isHoliday, holidayName: isHoliday ? holiday.name : undefined };
    }
    // Auto-created when a position swap leaves this employee with no shift at
    // all on the transition day itself (see positionSwap.js) — distinct from
    // 'rest' so it doesn't count as a personal day off for leave purposes.
    if (override.status === 'swapped') return { kind: 'swapped' };
    const coveringFor = override.coveringFor && typeof override.coveringFor === 'object' ? override.coveringFor : undefined;
    return { kind: 'work', start: override.startTime!, end: override.endTime!, isOverride: true, overrideId: override._id, coveringFor };
  }
  const dow = dayjs(dateKey).day();
  if (restDays.includes(dow)) return { kind: 'rest', isOverride: false };
  if (regularTime) return { kind: 'work', start: regularTime.start, end: regularTime.end, isOverride: false };
  return { kind: 'unset' };
}

const CELL_STYLE: Record<Cell['kind'], React.CSSProperties> = {
  unset: { background: 'var(--app-surface-bg)', border: '1px dashed var(--app-border-color, #d9d9d9)' },
  rest: { background: '#f9f0ff' },
  work: { background: 'transparent' },
  substituted: { background: '#e6fffb' },
  leave: { background: '#fffbe6' },
  swapped: { background: '#fff0f6' },
};

// Just the calendar grid itself, no page chrome — MonthlySchedulePage below
// wraps this (and ScheduleCoversGrid) in one List with a dropdown to switch
// between them, so this needs to stay a bare fragment rather than its own List.
export const MonthlyScheduleGrid: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isManager = identity?.role === 'admin' || identity?.role === 'manager';

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const daysInMonth = monthStart.daysInMonth();
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, 'day')), [monthStart, daysInMonth]);
  const monthStartKey = monthStart.format('YYYY-MM-DD');
  const monthEndKey = monthStart.endOf('month').format('YYYY-MM-DD');
  const todayKey = dayjs().format('YYYY-MM-DD');

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status_in', operator: 'eq', value: 'active,resigned' }],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [shiftCategoryFilter, setShiftCategoryFilter] = useState<string>();

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
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
  const { selectProps: shiftCategorySelect } = useSelect<ShiftCategory>({
    resource: 'shift-categories',
    optionLabel: (item) => (item.name ? `${item.name} (${item.startTime}-${item.endTime})` : `${item.startTime}-${item.endTime}`),
    optionValue: '_id',
    pagination: { pageSize: 100, mode: 'server' },
  });

  const employees = useMemo(() => {
    const filtered = allEmployees.filter((e) => {
      if (search) {
        const q = search.trim().toLowerCase();
        const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.toLowerCase();
        const code = (e.employeeCode ?? '').toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (departmentFilter && idOf(e.department) !== departmentFilter) return false;
      if (positionFilter && idOf(e.position) !== positionFilter) return false;
      if (shiftCategoryFilter && idOf(e.defaultShiftCategory) !== shiftCategoryFilter) return false;
      return true;
    });
    // Only while filtering by department — a department usually spans
    // several positions, so grouping by position here keeps everyone in the
    // same one together instead of staying interleaved in plain employeeCode
    // order. No filter active still sorts by employeeCode only, as before.
    if (!departmentFilter) return filtered;
    const positionNameById = new Map(allPositions.map((p) => [p._id, p.name]));
    return [...filtered].sort((a, b) => {
      const posA = positionNameById.get(idOf(a.position) ?? '') ?? '';
      const posB = positionNameById.get(idOf(b.position) ?? '') ?? '';
      return posA.localeCompare(posB) || (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '');
    });
  }, [allEmployees, allPositions, search, departmentFilter, positionFilter, shiftCategoryFilter]);

  // Sized off the employee ceiling: each company holiday day alone adds a
  // ພັກ row for everyone, so a fixed 3000 ran out in a month with many.
  const { data: shiftsData, isLoading: shiftsLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: monthStartKey },
      { field: 'date', operator: 'lte', value: monthEndKey },
    ],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE * 31 },
  });
  const shifts = shiftsData?.data ?? [];

  // A 'cancelled' row isn't a rest-day decision, so it never counts here.
  // When someone has more than one row on a date, the same one wins as on
  // every other page and in the absence sweep (utils/dayOverride.ts) — this
  // used to be whichever row happened to come last.
  const overrideByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of shifts) {
      const key = `${idOf(s.employee)}_${s.date}`;
      const preferred = preferredOverride(map[key], s);
      if (preferred) map[key] = preferred;
    }
    return map;
  }, [shifts]);

  // Regular-shift changes from the start of this month on — a past day keeps
  // the regular shift it really had (models/ShiftChangeLog.js), not today's.
  const { data: shiftLogsData } = useCustom<ShiftChangeLogEntry[]>({
    url: `${API_URL}/shift-change-logs`,
    method: 'get',
    config: { query: { after: monthStartKey } },
  });
  const shiftLogsByEmployee = useMemo(() => groupLogsByEmployee(shiftLogsData?.data), [shiftLogsData?.data]);
  const regularTimeOn = (emp: Employee, dateKey: string) => {
    const historical = shiftOnDate(shiftLogsByEmployee.get(emp._id), dateKey);
    if (!historical) return resolveDefaultTime(emp);
    return historical.startTime && historical.endTime ? { start: historical.startTime, end: historical.endTime } : null;
  };

  // Recurring rest days as they stood on each day of this month — a change
  // applies only from the day it takes effect (utils/restDays.ts).
  const { data: restScheduleData, refetch: refetchRestSchedule } = useCustom<RestDayScheduleRow[]>({
    url: `${API_URL}/rest-day-history/schedule`,
    method: 'get',
    config: { query: { from: monthStartKey, to: monthEndKey } },
  });
  const restRowsByEmployee = useMemo(() => groupRestRowsByEmployee(restScheduleData?.data), [restScheduleData?.data]);
  const restDaysFor = (emp: Employee, dateKey: string) => restDaysOn(restRowsByEmployee.get(emp._id), emp.defaultRestDay, dateKey);
  // The day a change takes effect this month, marked on that cell.
  const restChangeByEmpDate = useMemo(() => {
    const map: Record<string, RestDayScheduleRow> = {};
    for (const row of restScheduleData?.data ?? []) {
      if (row.effectiveDate < monthStartKey || row.effectiveDate > monthEndKey) continue;
      const key = `${row.employee}_${row.effectiveDate}`;
      if (!map[key] || map[key].createdAt < row.createdAt) map[key] = row;
    }
    return map;
  }, [restScheduleData?.data, monthStartKey, monthEndKey]);

  // So a day marked "ມາແທນ" from ປະຫວັດການສະແກນ (or from this page's own modal)
  // shows up here too, instead of just reverting to blank once its queued
  // Shift is gone. Only those rows — the whole month's records used to be
  // fetched for this and were cut off at 5000.
  const { data: attendanceDailyData } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: monthStartKey },
      { field: 'date', operator: 'lte', value: monthEndKey },
      { field: 'status', operator: 'eq', value: 'substituted' },
    ],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE * 31 },
  });
  const substitutedByEmpDate = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const d of attendanceDailyData?.data ?? []) {
      if (!d.employee || d.status !== 'substituted') continue;
      map[`${idOf(typeof d.employee === 'object' ? d.employee._id : d.employee)}_${d.date}`] = true;
    }
    return map;
  }, [attendanceDailyData?.data]);

  // A position's restrictedRestDays exists to stop a discretionary rest-day
  // swap away from a day that needs staffing — it isn't meant to also block
  // marking a date "rest" when the employee is already out on approved leave
  // that day regardless (nothing about the restriction changes the fact that
  // they're not coming in). Only leaves overlapping this month — fetching
  // every leave ever filed would silently lose the newest ones once there
  // were more than the page size.
  const { data: approvedLeavesData } = useList<Leave>({
    resource: 'leaves',
    filters: [
      { field: 'status', operator: 'eq', value: 'approved' },
      { field: 'from', operator: 'eq', value: monthStartKey },
      { field: 'to', operator: 'eq', value: monthEndKey },
    ],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE * 31, mode: 'server' },
  });
  const approvedLeaveRangesByEmployee = useMemo(() => {
    const map: Record<string, { start: Dayjs; end: Dayjs }[]> = {};
    for (const l of approvedLeavesData?.data ?? []) {
      const empId = idOf(l.employee);
      if (!empId) continue;
      (map[empId] ??= []).push({ start: dayjs(l.startDate), end: dayjs(l.endDate) });
    }
    return map;
  }, [approvedLeavesData?.data]);
  const hasApprovedLeaveOn = (employeeId: string, dateKey: string) => {
    const date = dayjs(dateKey);
    return !!approvedLeaveRangesByEmployee[employeeId]?.some((r) => !date.isBefore(r.start, 'day') && !date.isAfter(r.end, 'day'));
  };

  // ຍ້າຍກະລ່ວງໜ້າ — a standing change to one employee's own default shift,
  // scheduled ahead (see ScheduledShiftChange/scheduledShiftChange.js). Fetched
  // unfiltered like the position-swap schedule list (useCustom, not useList —
  // this route returns a plain array, not a paginated X-Total-Count response).
  const { data: shiftChangesData, refetch: refetchShiftChanges } = useCustom<ScheduledShiftChange[]>({
    url: `${API_URL}/scheduled-shift-changes`,
    method: 'get',
    queryOptions: { enabled: isManager },
  });
  const pendingShiftChangeByEmpDate = useMemo(() => {
    const map: Record<string, ScheduledShiftChange> = {};
    for (const c of shiftChangesData?.data ?? []) {
      if (c.status !== 'pending') continue;
      map[`${idOf(c.employee)}_${c.effectiveDate}`] = c;
    }
    return map;
  }, [shiftChangesData?.data]);

  // ສະຫຼັບຕຳແໜ່ງ — a pending ScheduledPositionSwap doesn't touch anyone's
  // position/shift until its own effectiveDate arrives (see positionSwap.js),
  // so there's nothing in Employee/Shift data to reflect yet. This is purely
  // a heads-up overlay on the day it WILL happen, not a preview of the result
  // — the cell underneath keeps showing today's real, unchanged schedule.
  const { data: positionSwapsData } = useCustom<ScheduledPositionSwap[]>({
    url: `${API_URL}/position-swaps`,
    method: 'get',
    queryOptions: { enabled: isManager },
  });
  const pendingSwapByPositionDate = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of positionSwapsData?.data ?? []) {
      if (s.status !== 'pending') continue;
      const nameA = typeof s.positionA === 'object' ? s.positionA?.name : undefined;
      const nameB = typeof s.positionB === 'object' ? s.positionB?.name : undefined;
      const idA = idOf(s.positionA);
      const idB = idOf(s.positionB);
      if (idA) map[`${idA}_${s.effectiveDate}`] = nameB ?? 'ຕຳແໜ່ງອື່ນ';
      if (idB) map[`${idB}_${s.effectiveDate}`] = nameA ?? 'ຕຳແໜ່ງອື່ນ';
    }
    return map;
  }, [positionSwapsData?.data]);

  const [editing, setEditing] = useState<{ employee: Employee; dateKey: string } | null>(null);
  const editingOverride = editing ? overrideByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : undefined;
  const editingIsSubstituted = editing ? !!substitutedByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : false;
  const editingIsOnLeave = editing ? hasApprovedLeaveOn(editing.employee._id, editing.dateKey) : false;
  const editingCell = editing
    ? computeCell(
        restDaysFor(editing.employee, editing.dateKey),
        editing.dateKey,
        editingOverride,
        editingIsSubstituted,
        editingIsOnLeave,
        regularTimeOn(editing.employee, editing.dateKey)
      )
    : null;
  const editingPendingShiftChange = editing ? pendingShiftChangeByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : undefined;

  const [timeForm] = Form.useForm();
  useEffect(() => {
    if (!editing || !editingCell) return;
    timeForm.setFieldsValue({
      time: editingCell.kind === 'work' ? [dayjs(editingCell.start, 'HH:mm'), dayjs(editingCell.end, 'HH:mm')] : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const { mutate: createShift, isLoading: creating } = useCreate();
  const { mutate: updateShift, isLoading: updating } = useUpdate();
  const { mutate: deleteShift, isLoading: deleting } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const saving = creating || updating || deleting;

  // A recurring weekly rest day — set once here and it applies to every
  // matching weekday automatically, with no per-day clicking and no Shift
  // rows. A change never rewrites days already past: it starts on the Monday
  // picked (by default the first Monday of the next month, as HR plans each
  // month ahead), so every week rests on one pattern — or, for someone with
  // no rest day yet, as soon as the week allows. The server checks that
  // (routes/restDayHistory.js), and the dialog shows it, with any change
  // still waiting to take effect, before anything is saved.
  const [recurringRestFor, setRecurringRestFor] = useState<Employee | null>(null);
  // Changes not in effect yet, earliest first; null while loading.
  const [waitingRestChanges, setWaitingRestChanges] = useState<RestDayChangePlan['pending'] | null>(null);
  // No recurring rest day today — offered the soonest day besides Mondays.
  const [restSetup, setRestSetup] = useState(false);
  // The Monday it starts (YYYY-MM-DD), or SOONEST; null until loaded.
  const [restStart, setRestStart] = useState<string | null>(null);
  // The days picked in the dialog; null until the waiting changes are in.
  const [recurringRestDay, setRecurringRestDay] = useState<number[] | null>(null);
  // Once days are picked by hand, moving the start date keeps them.
  const [restDaysTouched, setRestDaysTouched] = useState(false);
  const [restPlan, setRestPlan] = useState<{ days: number[]; start: string; plan?: RestDayChangePlan; error?: string } | null>(null);
  const [restReload, setRestReload] = useState(0);
  const [savingRestDay, setSavingRestDay] = useState(false);

  // What's set for the start date picked: the waiting change on or before it
  // (for SOONEST, the first one waiting — someone with no rest day yet has
  // only their setup to correct), else what applies today. The picker starts
  // there, so nothing changes until a day is actually picked.
  const restDaysSetFor = (start: string | null, waiting = waitingRestChanges) => {
    const from = !start ? todayKey : start === SOONEST ? waiting?.[0]?.effectiveDate ?? todayKey : start;
    const inForce = (waiting ?? []).filter((c) => c.effectiveDate <= from);
    return inForce.length ? inForce[inForce.length - 1].newRestDay : recurringRestFor?.defaultRestDay ?? [];
  };
  const plannedRestDays = useMemo(() => restDaysSetFor(restStart), [recurringRestFor, waitingRestChanges, restStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whose dialog the last load was for — a reload after cancelling a waiting
  // change keeps the date picked; opening the dialog starts afresh.
  const restLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recurringRestFor) {
      restLoadedFor.current = null;
      return;
    }
    let stale = false;
    setWaitingRestChanges(null);
    setRecurringRestDay(null);
    setRestPlan(null);
    // What's waiting doesn't depend on the days asked about, and asking about
    // none can't trip over the position's ຂໍ້ຈຳກັດວັນພັກ.
    axiosInstance
      .post<RestDayChangePlan>(`${API_URL}/rest-day-history/preview`, { employee: recurringRestFor._id, restDays: [] })
      .then(({ data }) => {
        if (stale) return;
        const waiting = [...data.replaces, ...data.pending].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
        // Fresh, it starts from HR's usual Monday (or the soonest day, for a setup).
        const reloading = restLoadedFor.current === recurringRestFor._id && restStart;
        restLoadedFor.current = recurringRestFor._id;
        const start = reloading ? restStart : data.setup ? SOONEST : data.defaultStart;
        setWaitingRestChanges(waiting);
        setRestSetup(data.setup);
        setRestStart(start);
        setRestDaysTouched(false);
        setRecurringRestDay(restDaysSetFor(start, waiting));
      })
      .catch((err) => {
        if (stale) return;
        setWaitingRestChanges([]);
        setRestSetup(false);
        setRestStart(firstMondayOfMonthAfter(dayjs()).format('YYYY-MM-DD'));
        setRecurringRestDay(recurringRestFor.defaultRestDay ?? []);
        notify?.({ type: 'error', message: err?.response?.data?.message || 'ໂຫຼດການປ່ຽນວັນພັກບໍ່ສຳເລັດ' });
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringRestFor, restReload]);

  const pickRestStart = (start: string) => {
    setRestStart(start);
    if (!restDaysTouched) setRecurringRestDay(restDaysSetFor(start));
  };
  const pickRestDays = (days: number[]) => {
    setRestDaysTouched(true);
    setRecurringRestDay(days);
  };

  // What saving the picked days from the picked date would do, asked again
  // whenever either changes.
  useEffect(() => {
    if (!recurringRestFor || !recurringRestDay || !restStart || sameDays(recurringRestDay, plannedRestDays)) return;
    let stale = false;
    const days = recurringRestDay;
    const start = restStart;
    axiosInstance
      .post<RestDayChangePlan>(`${API_URL}/rest-day-history/preview`, {
        employee: recurringRestFor._id,
        restDays: days,
        effectiveDate: start === SOONEST ? undefined : start,
      })
      .then(({ data }) => {
        if (!stale) setRestPlan({ days, start, plan: data });
      })
      .catch((err) => {
        if (!stale) setRestPlan({ days, start, error: err?.response?.data?.message || 'ກວດການປ່ຽນວັນພັກບໍ່ສຳເລັດ' });
      });
    return () => {
      stale = true;
    };
  }, [recurringRestFor, recurringRestDay, restStart, plannedRestDays]);

  const restDayChanged = !!recurringRestDay && !sameDays(recurringRestDay, plannedRestDays);
  // Only the answer for the days and date picked right now — an older one is
  // still on its way out while the next is asked.
  const currentRestPlan =
    restDayChanged && restPlan && restPlan.start === restStart && sameDays(restPlan.days, recurringRestDay!) ? restPlan : null;
  // A pick that lands on what's already in force that day only cancels the
  // waiting change(s) it replaces — with none, there's nothing to save.
  const canSaveRestDay = !!currentRestPlan?.plan && !(currentRestPlan.plan.unchanged && !currentRestPlan.plan.replaces.length);
  const shownRestPlan = currentRestPlan?.plan;
  const clearingRestDay = restDayChanged && recurringRestDay!.length === 0;

  const restStartOptions = useMemo(
    () => [
      ...(restSetup ? [{ value: SOONEST, label: 'ໄວທີ່ສຸດ — ຍັງບໍ່ມີວັນພັກປະຈຳ' }] : []),
      ...upcomingMondays(dayjs()).map((monday) => ({ value: monday.format('YYYY-MM-DD'), label: mondayOptionLabel(monday) })),
    ],
    [restSetup]
  );

  const restrictedDaysForRecurring = effectiveRestrictedRestDays(recurringRestFor);
  const weekdayOptionsForRecurringRest = useMemo(
    () => WEEKDAY_OPTIONS.map((opt) => ({ ...opt, disabled: restrictedDaysForRecurring.includes(opt.value) })),
    [restrictedDaysForRecurring]
  );

  const afterRestDayChange = () => {
    refetchRestSchedule();
    invalidate({ resource: 'employees', invalidates: ['list'] });
    invalidate({ resource: 'leaves', invalidates: ['list'] });
  };

  // Queued shifts on a new rest day are listed in the dialog itself
  // (plan.conflicts), so saving needs no second confirm.
  const saveRecurringRest = async () => {
    if (!recurringRestFor || !recurringRestDay || !restStart || !canSaveRestDay) return;
    setSavingRestDay(true);
    try {
      const { data } = await axiosInstance.post<RestDayChangePlan>(`${API_URL}/rest-day-history`, {
        employee: recurringRestFor._id,
        restDays: recurringRestDay,
        effectiveDate: restStart === SOONEST ? undefined : restStart,
      });
      notify?.({
        type: 'success',
        message: data.unchanged ? 'ຍົກເລີກການປ່ຽນທີ່ລໍຖ້າແລ້ວ' : `ບັນທຶກສຳເລັດ — ມີຜົນແຕ່ ${dayjs(data.effectiveDate).format('DD/MM/YYYY')}`,
      });
      setRecurringRestFor(null);
      afterRestDayChange();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSavingRestDay(false);
    }
  };

  // Only a change that hasn't taken effect yet can be cancelled — one in
  // effect is changed by picking new days instead.
  const cancelWaitingRestChange = async (id: string) => {
    try {
      await axiosInstance.delete(`${API_URL}/rest-day-history/${id}`);
      notify?.({ type: 'success', message: 'ຍົກເລີກການປ່ຽນວັນພັກທີ່ລໍຖ້າແລ້ວ' });
      afterRestDayChange();
      setRestReload((n) => n + 1);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    }
  };

  const [choice, setChoice] = useState<'rest' | 'time' | 'cover' | 'editCover' | 'substitute' | 'shiftChange' | null>(null);
  useEffect(() => {
    setChoice(null);
  }, [editing?.employee._id, editing?.dateKey]);

  const closeModal = () => {
    setEditing(null);
    setChoice(null);
  };
  const onSaved = (message = 'ບັນທຶກສຳເລັດ') => {
    notify?.({ type: 'success', message });
    closeModal();
  };

  const personLabel = (emp?: Employee) => `${emp?.employeeCode ?? ''} ${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
  const shortDate = (dateKey: string) => dayjs(dateKey).format('DD/MM/YYYY');

  // ຍ້າຍກະລ່ວງໜ້າ — opened from the 4th cell-menu option. The clicked cell's
  // own date doubles as the effective date by default (editable, in case the
  // wrong day was clicked), so there's no separate "which day" step.
  const [shiftChangeDate, setShiftChangeDate] = useState<Dayjs | null>(null);
  const [shiftChangeCategory, setShiftChangeCategory] = useState<string | undefined>(undefined);
  const [creatingNewCategory, setCreatingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryTime, setNewCategoryTime] = useState<[Dayjs, Dayjs] | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [schedulingShiftChange, setSchedulingShiftChange] = useState(false);

  const openShiftChange = () => {
    if (!editing) return;
    setChoice('shiftChange');
    setShiftChangeDate(dayjs(editing.dateKey));
    setShiftChangeCategory(undefined);
    setCreatingNewCategory(false);
    setNewCategoryName('');
    setNewCategoryTime(null);
  };

  const createCategoryThenUse = async () => {
    if (!newCategoryTime) return;
    setCreatingCategory(true);
    try {
      const [start, end] = newCategoryTime;
      const res = await axiosInstance.post(`${API_URL}/shift-categories`, {
        name: newCategoryName.trim() || undefined,
        startTime: start.format('HH:mm'),
        endTime: end.format('HH:mm'),
      });
      setShiftChangeCategory(res.data._id);
      setCreatingNewCategory(false);
      setNewCategoryName('');
      setNewCategoryTime(null);
      invalidate({ resource: 'shift-categories', invalidates: ['list'] });
      notify?.({ type: 'success', message: 'ສ້າງກະໃໝ່ແລ້ວ' });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ສ້າງກະໃໝ່ບໍ່ສຳເລັດ' });
    } finally {
      setCreatingCategory(false);
    }
  };

  const submitShiftChange = async () => {
    if (!editing || !shiftChangeCategory || !shiftChangeDate) return;
    setSchedulingShiftChange(true);
    try {
      await axiosInstance.post(`${API_URL}/scheduled-shift-changes`, {
        employee: editing.employee._id,
        newShiftCategory: shiftChangeCategory,
        effectiveDate: shiftChangeDate.format('YYYY-MM-DD'),
      });
      notify?.({ type: 'success', message: `ຕັ້ງການຍ້າຍກະລ່ວງໜ້າແລ້ວ — ມີຜົນວັນທີ ${shiftChangeDate.format('DD/MM/YYYY')}` });
      closeModal();
      invalidate({ resource: 'shifts', invalidates: ['list'] });
      refetchShiftChanges();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ' });
    } finally {
      setSchedulingShiftChange(false);
    }
  };

  const cancelShiftChange = async (id: string) => {
    try {
      await axiosInstance.patch(`${API_URL}/scheduled-shift-changes/${id}`, { status: 'cancelled' });
      notify?.({ type: 'success', message: 'ຍົກເລີກການຍ້າຍກະລ່ວງໜ້າແລ້ວ' });
      closeModal();
      invalidate({ resource: 'shifts', invalidates: ['list'] });
      refetchShiftChanges();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    }
  };

  // A rest day can be silently moved to a fallback weekday by the server when
  // the position forbids the picked one — say so, instead of reporting the
  // original date as if it were saved as-is.
  const upsertOverride = (values: Record<string, unknown>, successMessage: string) => {
    const onDone = (res: { data?: unknown }) => {
      const savedDate = (res?.data as { date?: string } | undefined)?.date;
      const requestedDate = values.date as string | undefined;
      const moved = !!savedDate && !!requestedDate && savedDate !== requestedDate;
      onSaved(moved ? `${successMessage} — ລະບົບເລື່ອນໄປວັນ ${shortDate(savedDate!)} ເນື່ອງຈາກຂໍ້ຈຳກັດວັນພັກຂອງຕຳແໜ່ງ` : successMessage);
    };
    if (editingOverride) {
      updateShift({ resource: 'shifts', id: editingOverride._id, values }, { onSuccess: onDone });
    } else {
      createShift({ resource: 'shifts', values }, { onSuccess: onDone });
    }
  };

  const handleSetRest = () => {
    if (!editing) return;
    upsertOverride(
      { employee: editing.employee._id, date: editing.dateKey, status: 'rest' },
      `ຕັ້ງ ${personLabel(editing.employee)} ເປັນວັນພັກ ວັນທີ ${shortDate(editing.dateKey)}`
    );
  };

  const editingCovered =
    editingOverride && typeof editingOverride.coveringFor === 'object' && editingOverride.coveringFor ? editingOverride.coveringFor : undefined;

  const restrictedDaysForEditing = effectiveRestrictedRestDays(editing?.employee);
  const isEditingDateRestDayBlocked =
    !!editing &&
    restrictedDaysForEditing.includes(dayjs(editing.dateKey).day()) &&
    !hasApprovedLeaveOn(editing.employee._id, editing.dateKey);

  const handleSaveTime = () => {
    if (!editing) return;
    const time = timeForm.getFieldValue('time') as [Dayjs, Dayjs] | undefined;
    if (!time) return;
    const startTime = time[0].format('HH:mm');
    const endTime = time[1].format('HH:mm');
    upsertOverride(
      {
        employee: editing.employee._id,
        position: idOf(editing.employee.position),
        date: editing.dateKey,
        status: 'scheduled',
        startTime,
        endTime,
      },
      `ກຳນົດເວລາພິເສດ ${startTime}-${endTime} ໃຫ້ ${personLabel(editing.employee)} ວັນທີ ${shortDate(editing.dateKey)}`
    );
  };

  // ເຮັດແທນຄົນອື່ນ — the editing employee is the one actually working; the picked
  // person is the one being covered. Position comes from the covered person,
  // since that's the job being done.
  const [coverForm] = Form.useForm();
  const [coverDept, setCoverDept] = useState<string>();
  const [coverPos, setCoverPos] = useState<string>();
  const coverDeptOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      if (e.department && typeof e.department === 'object') map.set(e.department._id, e.department.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);
  const coverPosOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      if (coverDept && idOf(e.department) !== coverDept) continue;
      if (e.position && typeof e.position === 'object') map.set(e.position._id, e.position.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees, coverDept]);
  const coverTargetOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => e._id !== editing?.employee._id)
        .filter((e) => (!coverDept || idOf(e.department) === coverDept) && (!coverPos || idOf(e.position) === coverPos))
        .map((e) => ({ value: e._id, label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() })),
    [allEmployees, coverDept, coverPos, editing]
  );

  const handleCover = (values: { coveredEmployee: string; time: [Dayjs, Dayjs] }) => {
    if (!editing) return;
    const covered = allEmployees.find((e) => e._id === values.coveredEmployee);
    const coveredPositionId = idOf(covered?.position);
    if (!coveredPositionId) {
      notify?.({ type: 'error', message: 'ຜູ້ຖືກແທນຍັງບໍ່ມີຕຳແໜ່ງ ກະລຸນາຕັ້ງຕຳແໜ່ງໃຫ້ກ່ອນ' });
      return;
    }
    createShift(
      {
        resource: 'shifts',
        values: {
          employee: editing.employee._id,
          coveringFor: values.coveredEmployee,
          position: coveredPositionId,
          date: editing.dateKey,
          startTime: values.time[0].format('HH:mm'),
          endTime: values.time[1].format('HH:mm'),
          status: 'scheduled',
        },
      },
      {
        onSuccess: () => {
          coverForm.resetFields();
          setCoverDept(undefined);
          setCoverPos(undefined);
          onSaved(
            `ບັນທຶກແລ້ວ: ${personLabel(editing.employee)} ໄປເຮັດແທນ ${personLabel(covered)} ວັນ${shortDate(editing.dateKey)} ເວລາ ${values.time[0].format('HH:mm')}-${values.time[1].format('HH:mm')}`
          );
        },
      }
    );
  };

  // The covered person's own time for that day — their queued time if they have
  // one, otherwise their default shift — so the cover form starts from a real
  // schedule instead of an empty picker.
  const defaultTimeFor = (emp: Employee, dateKey: string): [Dayjs, Dayjs] | undefined => {
    const queued = overrideByEmpDate[`${emp._id}_${dateKey}`];
    if (queued?.status === 'scheduled' && queued.startTime && queued.endTime) {
      return [dayjs(`${dateKey}T${queued.startTime}`), dayjs(`${dateKey}T${queued.endTime}`)];
    }
    const regular = regularTimeOn(emp, dateKey);
    return regular ? [dayjs(`${dateKey}T${regular.start}`), dayjs(`${dateKey}T${regular.end}`)] : undefined;
  };

  const fillCoverTime = (coveredId: string) => {
    if (!editing) return;
    const covered = allEmployees.find((e) => e._id === coveredId);
    const time = covered ? defaultTimeFor(covered, editing.dateKey) : undefined;
    if (time) coverForm.setFieldValue('time', time);
  };

  const [editCoverForm] = Form.useForm();
  useEffect(() => {
    if (choice === 'editCover' && editingOverride?.startTime && editingOverride?.endTime && editing) {
      editCoverForm.setFieldsValue({
        time: [dayjs(`${editing.dateKey}T${editingOverride.startTime}`), dayjs(`${editing.dateKey}T${editingOverride.endTime}`)],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  const handleEditCover = (values: { time: [Dayjs, Dayjs] }) => {
    if (!editingOverride || !editing) return;
    const startTime = values.time[0].format('HH:mm');
    const endTime = values.time[1].format('HH:mm');
    updateShift(
      { resource: 'shifts', id: editingOverride._id, values: { startTime, endTime } },
      {
        onSuccess: () =>
          onSaved(`ແກ້ໄຂເວລາໄປເຮັດແທນ ${startTime}-${endTime} ໃຫ້ ${personLabel(editing.employee)} ວັນທີ ${shortDate(editing.dateKey)} ແລ້ວ`),
      }
    );
  };

  const handleRevert = () => {
    if (!editingOverride || !editing) return;
    deleteShift(
      { resource: 'shifts', id: editingOverride._id },
      { onSuccess: () => onSaved(`ຄືນຄ່າປົກກະຕິແລ້ວ ${personLabel(editing.employee)} ວັນທີ ${shortDate(editing.dateKey)}`) }
    );
  };

  // Only offered on employees/positions flagged for it (see ຕັ້ງຄ່າມາບໍ່ປົກກະຕິ)
  // — someone else covers the shift instead, so this employee never scans.
  // Triggered here on the schedule since that's where a queued shift already
  // is; the result then just shows up on ປະຫວັດການສະແກນ (attendance) as usual.
  const canSubstitute =
    !!editing &&
    (editing.employee.allowsSubstituteStatus ??
      (typeof editing.employee.position === 'object' ? editing.employee.position?.allowsSubstituteStatus : false)) === true;
  const [submittingSubstitute, setSubmittingSubstitute] = useState(false);

  const handleSubstitute = async () => {
    if (!editing) return;
    setSubmittingSubstitute(true);
    try {
      await axiosInstance.post(`${API_URL}/attendance/mark-substituted`, {
        employeeId: editing.employee._id,
        date: editing.dateKey,
      });
      invalidate({ resource: 'shifts', invalidates: ['list'] });
      invalidate({ resource: 'attendance-daily', invalidates: ['list'] });
      onSaved(`ໝາຍວ່າມີຄົນມາແທນ ${personLabel(editing.employee)} ວັນທີ ${shortDate(editing.dateKey)} ແລ້ວ`);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSubmittingSubstitute(false);
    }
  };

  // Reverts back to blank — there's no raw scan to recompute from, unlike a
  // manual-fix correction, so this is a straight delete rather than a re-derive.
  const handleCancelSubstitute = async () => {
    if (!editing) return;
    setSubmittingSubstitute(true);
    try {
      await axiosInstance.post(`${API_URL}/attendance/cancel-substituted`, {
        employeeId: editing.employee._id,
        date: editing.dateKey,
      });
      invalidate({ resource: 'attendance-daily', invalidates: ['list'] });
      onSaved();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    } finally {
      setSubmittingSubstitute(false);
    }
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space>
            <Button icon={<LeftOutlined />} onClick={() => setMonthStart(monthStart.subtract(1, 'month'))} />
            <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
            <Button icon={<RightOutlined />} onClick={() => setMonthStart(dayjs().startOf('month'))}>
              ເດືອນນີ້
            </Button>
            <Button icon={<RightOutlined />} onClick={() => setMonthStart(monthStart.add(1, 'month'))} />
          </Space>
          <Space wrap>
            <Input.Search
              placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
              allowClear
              style={{ width: 220 }}
              prefix={<SearchOutlined />}
              onSearch={(v) => setSearch(v)}
              onChange={(e) => !e.target.value && setSearch('')}
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
              }}
            />
            <Select
              {...positionSelect}
              options={positionOptionsForDepartment}
              placeholder="ກອງຕາມຕຳແໜ່ງ"
              allowClear
              style={{ width: 180 }}
              value={positionFilter}
              onChange={(v: any) => setPositionFilter(v)}
            />
            <Select
              {...shiftCategorySelect}
              placeholder="ກອງຕາມໝວດໝູ່ກະ"
              allowClear
              style={{ width: 200 }}
              value={shiftCategoryFilter}
              onChange={(v: any) => setShiftCategoryFilter(v)}
            />
          </Space>
          <Space size={16} wrap>
            <Space size={6}>
              <span style={{ width: 14, height: 14, background: '#f9f0ff', display: 'inline-block', borderRadius: 2 }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ວັນພັກ
              </Typography.Text>
            </Space>
            <Space size={6}>
              <span style={{ width: 14, height: 14, borderLeft: '3px solid #d46b08', display: 'inline-block' }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ແກ້ໄຂພິເສດ (ບໍ່ຄືປົກກະຕິ)
              </Typography.Text>
            </Space>
            <Space size={6}>
              <span
                style={{ width: 14, height: 14, background: 'var(--app-surface-bg)', border: '1px dashed #d9d9d9', display: 'inline-block' }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ຍັງບໍ່ຕັ້ງຄ່າປົກກະຕິ
              </Typography.Text>
            </Space>
            <Space size={6}>
              <span style={{ width: 14, height: 14, background: '#e6fffb', display: 'inline-block', borderRadius: 2 }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ມາແທນ
              </Typography.Text>
            </Space>
          </Space>
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || shiftsLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
      >
        <Table.Column title="ລະຫັດ" fixed="left" width={90} dataIndex="employeeCode" />
        <Table.Column
          title="ໂມງວຽກ"
          fixed="left"
          width={110}
          render={(_, emp: Employee) => {
            const defaultTime = resolveDefaultTime(emp);
            return (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {defaultTime ? `${defaultTime.start}-${defaultTime.end}` : 'ຍັງບໍ່ຕັ້ງ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ພະແນກ"
          fixed="left"
          width={110}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          fixed="left"
          width={130}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          fixed="left"
          width={165}
          render={(_, emp: Employee) => (
            <Space size={4}>
              <span>
                {emp.firstName} {emp.lastName}
              </span>
              {isManager && (
                <Button
                  size="small"
                  type="text"
                  icon={<CalendarOutlined />}
                  title="ຕັ້ງວັນພັກປະຈຳອາທິດ"
                  onClick={() => setRecurringRestFor(emp)}
                />
              )}
            </Space>
          )}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('D')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {day.format('ddd')}
                  </Typography.Text>
                </div>
              }
              width={72}
              render={(_, emp: Employee) => {
                const override = overrideByEmpDate[`${emp._id}_${dateKey}`];
                const isSubstituted = !!substitutedByEmpDate[`${emp._id}_${dateKey}`];
                const isOnLeave = hasApprovedLeaveOn(emp._id, dateKey);
                const cell = computeCell(restDaysFor(emp, dateKey), dateKey, override, isSubstituted, isOnLeave, regularTimeOn(emp, dateKey));
                const isOverride = (cell.kind === 'rest' || cell.kind === 'work') && cell.isOverride;
                // Auto-created by a position swap (see positionSwap.js) — an
                // admin editing this by hand could put the employee back on a
                // shift the swap-day logic deliberately left them without,
                // undermining the whole reason it exists. Locked, same as a
                // read-only cell for a non-manager.
                const isLocked = cell.kind === 'swapped';
                const clickable = isManager && !isLocked;
                // Heads-up only — the cell's own content above is untouched,
                // since nothing actually changes until effectiveDate arrives.
                const pendingSwapWith = pendingSwapByPositionDate[`${idOf(emp.position)}_${dateKey}`];
                const restChange = restChangeByEmpDate[`${emp._id}_${dateKey}`];
                const coveringFor = cell.kind === 'work' ? cell.coveringFor : undefined;
                const coverDetail =
                  cell.kind === 'work' && cell.coveringFor
                    ? `ໄປເຮັດແທນ ${personLabel(cell.coveringFor)} (${typeof cell.coveringFor.department === 'object' ? cell.coveringFor.department?.name ?? '-' : '-'} / ${typeof cell.coveringFor.position === 'object' ? cell.coveringFor.position?.name ?? '-' : '-'}) — ${cell.start}-${cell.end}`
                    : undefined;
                return (
                  <div
                    onClick={() => clickable && setEditing({ employee: emp, dateKey })}
                    title={
                      isLocked
                        ? 'ສ້າງໂດຍລະບົບຕອນສະຫຼັບຕຳແໜ່ງ — ແກ້ໄຂຢູ່ນີ້ບໍ່ໄດ້'
                        : coverDetail
                          ? coverDetail
                          : pendingSwapWith
                            ? `ມື້ສະຫຼັບຕຳແໜ່ງ — ຈະສະຫຼັບກັບ "${pendingSwapWith}" ມື້ນີ້`
                            : restChange
                              ? `ວັນພັກປະຈຳເປັນ ${restDaysLabel(restChange.newRestDay)} ແຕ່ມື້ນີ້${restChange.effectiveDate > todayKey ? ' (ລໍຖ້າມີຜົນ)' : ''}`
                              : undefined
                    }
                    style={{
                      ...CELL_STYLE[cell.kind],
                      borderLeft: isOverride ? '3px solid #d46b08' : CELL_STYLE[cell.kind].borderLeft,
                      outline: pendingSwapWith ? '2px dashed #9254de' : undefined,
                      outlineOffset: pendingSwapWith ? -2 : undefined,
                      cursor: clickable ? 'pointer' : 'default',
                      minHeight: 40,
                      padding: '4px 6px',
                      textAlign: 'center',
                      fontSize: 11,
                      lineHeight: 1.3,
                      borderRadius: 2,
                    }}
                  >
                    {cell.kind === 'unset' && <span style={{ color: '#bfbfbf' }}>-</span>}
                    {cell.kind === 'rest' && (
                      <span style={{ color: '#722ed1' }} title={cell.holidayName}>
                        {cell.isHoliday ? 'ຮ້ານປິດ' : 'ພັກ'}
                      </span>
                    )}
                    {cell.kind === 'work' && (
                      <>
                        {cell.start}
                        <br />
                        {cell.end}
                        {coveringFor && <div style={{ fontSize: 9, color: '#08979c', fontWeight: 600 }}>ໄປແທນ</div>}
                      </>
                    )}
                    {cell.kind === 'substituted' && <span style={{ color: '#08979c' }}>ມາແທນ</span>}
                    {cell.kind === 'leave' && <span style={{ color: '#d48806' }}>ລາ</span>}
                    {cell.kind === 'swapped' && <span style={{ color: '#c41d7f' }}>ສະຫຼັບກະ</span>}
                    {pendingSwapWith && (
                      <div style={{ fontSize: 9, color: '#9254de', fontWeight: 600 }}>ສະຫຼັບ</div>
                    )}
                    {restChange && <div style={{ fontSize: 9, color: '#722ed1', fontWeight: 600 }}>ປ່ຽນວັນພັກ</div>}
                  </div>
                );
              }}
            />
          );
        })}
      </Table>

      <Modal
        title={editing ? `${editing.employee.firstName} ${editing.employee.lastName} — ${dayjs(editing.dateKey).format('DD MMMM YYYY')}` : ''}
        open={!!editing}
        onCancel={closeModal}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {editingCell?.kind === 'rest' &&
              `ປັດຈຸບັນ: ${editingCell.isHoliday ? `ຮ້ານປິດ (${editingCell.holidayName})` : 'ພັກ'}${editingCell.isOverride ? ' (ແກ້ໄຂພິເສດ)' : ' (ຄ່າປົກກະຕິ)'}`}
            {editingCell?.kind === 'work' &&
              `ປັດຈຸບັນ: ${editingCell.start}-${editingCell.end}${editingCell.isOverride ? ' (ແກ້ໄຂພິເສດ)' : ' (ຄ່າປົກກະຕິ)'}`}
            {editingCell?.kind === 'unset' && 'ປັດຈຸບັນ: ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ'}
            {editingCell?.kind === 'substituted' && 'ປັດຈຸບັນ: ມີຄົນອື່ນມາແທນ'}
            {editingCell?.kind === 'leave' && 'ປັດຈຸບັນ: ລາ (ມີໃບລາອະນຸມັດແລ້ວຄຸມມື້ນີ້)'}
            {editingCovered && `ປັດຈຸບັນ: ໄປເຮັດແທນ ${personLabel(editingCovered)} (${editingOverride?.startTime}-${editingOverride?.endTime})`}
          </Typography.Text>

          {choice === null ? (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <ChoiceButton
                title="ຕັ້ງເປັນວັນພັກ"
                description={
                  editingCovered
                    ? 'ມື້ນີ້ມີການໄປເຮັດແທນຢູ່ ຕ້ອງຄືນຄ່າປົກກະຕິກ່ອນ'
                    : isEditingDateRestDayBlocked
                      ? 'ຕຳແໜ່ງນີ້ຫ້າມພັກມື້ນີ້'
                      : 'ຕັ້ງມື້ນີ້ເປັນວັນພັກຂອງຄົນນີ້'
                }
                disabled={!!editingCovered || isEditingDateRestDayBlocked}
                onClick={() => setChoice('rest')}
              />
              <ChoiceButton
                title="ກຳນົດເວລາພິເສດໃຫ້ຕົວເອງ"
                description={
                  editingCovered
                    ? 'ມື້ນີ້ກຳລັງໄປເຮັດແທນຄົນອື່ນຢູ່ ຕ້ອງລຶບການເຮັດແທນກ່ອນ ຈຶ່ງຈະກຳນົດເວລາເອງໄດ້'
                    : 'ຕັ້ງເວລາເຂົ້າ-ອອກສະເພາະມື້ນີ້ ແທນເວລາປົກກະຕິ'
                }
                disabled={!!editingCovered}
                onClick={() => setChoice('time')}
              />
              <ChoiceButton
                title="ຍ້າຍກະລ່ວງໜ້າ"
                description={
                  editingCovered
                    ? 'ມື້ນີ້ກຳລັງໄປເຮັດແທນຄົນອື່ນຢູ່ ຕ້ອງລຶບການເຮັດແທນກ່ອນ'
                    : editingCell?.kind === 'leave'
                      ? 'ມື້ນີ້ລາ ບໍ່ສາມາດຕັ້ງຈຸດເລີ່ມຕົ້ນກະໃໝ່ທີ່ມື້ນີ້ໄດ້'
                      : editingCell?.kind === 'substituted'
                        ? 'ມື້ນີ້ມີຄົນມາແທນ ບໍ່ສາມາດຕັ້ງຈຸດເລີ່ມຕົ້ນກະໃໝ່ທີ່ມື້ນີ້ໄດ້'
                        : editingOverride
                          ? 'ມື້ນີ້ມີຕາຕະລາງພິເສດຢູ່ແລ້ວ ຕ້ອງຄືນຄ່າປົກກະຕິກ່ອນ'
                          : 'ປ່ຽນກະປະຈຳຂອງຄົນນີ້ ໂດຍເລີ່ມນັບຈາກວັນທີ່ເລືອກເປັນຕົ້ນໄປ'
                }
                disabled={!!editingCovered || editingCell?.kind === 'leave' || editingCell?.kind === 'substituted' || !!editingOverride}
                onClick={openShiftChange}
              />
              {editingCovered ? (
                <ChoiceButton
                  title="ແກ້ໄຂເວລາໄປເຮັດແທນ"
                  description={`ປັດຈຸບັນ ${editingOverride?.startTime}-${editingOverride?.endTime} ແທນ ${personLabel(editingCovered)}`}
                  onClick={() => setChoice('editCover')}
                />
              ) : canSubstitute ? (
                <ChoiceButton
                  title={editingCell?.kind === 'substituted' ? 'ຍົກເລີກການມີຄົນມາແທນ' : 'ມີຄົນມາເຮັດແທນໃຫ້'}
                  description="ຄົນນີ້ບໍ່ໄດ້ມາເອງ ມື້ນີ້ຈະບໍ່ຖືກນັບເປັນຂາດວຽກ"
                  onClick={() => setChoice('substitute')}
                />
              ) : (
                <ChoiceButton
                  title="ໄປເຮັດແທນຄົນອື່ນ"
                  description={
                    editingOverride && !editingCovered
                      ? 'ມື້ນີ້ມີການຕັ້ງຄ່າພິເສດຢູ່ແລ້ວ ຕ້ອງຄືນຄ່າປົກກະຕິກ່ອນ ຈຶ່ງຈະໄປເຮັດແທນໄດ້'
                      : editingCovered
                        ? 'ມື້ນີ້ກຳລັງໄປເຮັດແທນຄົນອື່ນຢູ່ແລ້ວ'
                        : 'ຄົນນີ້ຈະໄປເຮັດວຽກແທນຄົນທີ່ເລືອກໃນມື້ນີ້'
                  }
                  disabled={!!editingCovered || (!!editingOverride && !editingCovered)}
                  onClick={() => setChoice('cover')}
                />
              )}
              {editingOverride && (
                <Button type="link" onClick={handleRevert} loading={saving} style={{ paddingLeft: 0 }}>
                  ຄືນຄ່າປົກກະຕິ
                </Button>
              )}
              {editingPendingShiftChange && (
                <Popconfirm
                  title="ຍົກເລີກການຍ້າຍກະລ່ວງໜ້ານີ້?"
                  description="ວັນທີ່ນີ້ຈະເລີກເປັນຈຸດເລີ່ມຕົ້ນຂອງກະໃໝ່ ແລະ ກະເກົ່າຈະກັບມາເໝືອນເດີມ"
                  okText="ຍົກເລີກ"
                  cancelText="ບໍ່"
                  onConfirm={() => cancelShiftChange(editingPendingShiftChange._id)}
                >
                  <Button type="link" danger style={{ paddingLeft: 0 }}>
                    ຍົກເລີກການຍ້າຍກະລ່ວງໜ້ານີ້ (ໄປ {categoryLabel(editingPendingShiftChange.newShiftCategory)})
                  </Button>
                </Popconfirm>
              )}
            </Space>
          ) : (
            <div>
              <Button type="link" icon={<LeftOutlined />} onClick={() => setChoice(null)} style={{ paddingLeft: 0, marginBottom: 8 }}>
                ກັບໄປເມນູ
              </Button>

              {choice === 'rest' && editing && (
                <Space direction="vertical">
                  <Typography.Text>
                    ຕັ້ງ {personLabel(editing.employee)} ເປັນວັນພັກ ວັນທີ {shortDate(editing.dateKey)}
                  </Typography.Text>
                  <Button type="primary" onClick={handleSetRest} loading={saving} disabled={isEditingDateRestDayBlocked}>
                    ຢືນຢັນວັນພັກ
                  </Button>
                </Space>
              )}

              {choice === 'time' && (
                <Form form={timeForm} layout="inline">
                  <Form.Item name="time">
                    <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} />
                  </Form.Item>
                  <Button type="primary" onClick={handleSaveTime} loading={saving}>
                    ບັນທຶກເວລາພິເສດ
                  </Button>
                </Form>
              )}

              {choice === 'shiftChange' && editing && (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Typography.Text>
                    ຍ້າຍກະລ່ວງໜ້າໃຫ້ {personLabel(editing.employee)} — ມີຜົນນັບແຕ່ວັນທີ່ເລືອກລຸ່ມນີ້ເປັນຕົ້ນໄປ
                  </Typography.Text>
                  <DatePicker
                    format="DD/MM/YYYY"
                    value={shiftChangeDate}
                    onChange={(v) => setShiftChangeDate(v)}
                    style={{ width: '100%' }}
                    allowClear={false}
                  />
                  {!creatingNewCategory ? (
                    <>
                      <Select
                        {...shiftCategorySelect}
                        placeholder="ເລືອກກະທີ່ມີ"
                        style={{ width: '100%' }}
                        value={shiftChangeCategory}
                        onChange={(v: any) => setShiftChangeCategory(v)}
                      />
                      <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setCreatingNewCategory(true)}>
                        + ສ້າງກະໃໝ່
                      </Button>
                    </>
                  ) : (
                    <div style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: 12, width: '100%' }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                        ສ້າງກະໃໝ່
                      </Typography.Text>
                      <Input
                        placeholder="ຊື່ໝວດໝູ່ (ບໍ່ບັງຄັບ)"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        style={{ marginBottom: 8 }}
                      />
                      <TimePicker.RangePicker
                        format="HH:mm"
                        minuteStep={15}
                        order={false}
                        style={{ width: '100%', marginBottom: 8 }}
                        value={newCategoryTime}
                        onChange={(v) => setNewCategoryTime(v as [Dayjs, Dayjs] | null)}
                      />
                      <Space>
                        <Button type="primary" size="small" loading={creatingCategory} disabled={!newCategoryTime} onClick={createCategoryThenUse}>
                          ສ້າງ ແລະ ເລືອກໃຊ້
                        </Button>
                        <Button size="small" onClick={() => setCreatingNewCategory(false)}>
                          ຍົກເລີກ, ເລືອກຈາກລາຍການ
                        </Button>
                      </Space>
                    </div>
                  )}
                  <Button
                    type="primary"
                    onClick={submitShiftChange}
                    loading={schedulingShiftChange}
                    disabled={creatingNewCategory || !shiftChangeCategory || !shiftChangeDate}
                  >
                    ຢືນຢັນຍ້າຍກະລ່ວງໜ້າ
                  </Button>
                </Space>
              )}

              {choice === 'cover' && (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space wrap>
                    <Select
                      allowClear
                      placeholder="ພະແນກ (ຜູ້ຖືກແທນ)"
                      style={{ width: 170 }}
                      value={coverDept}
                      options={coverDeptOptions}
                      onChange={(v) => {
                        setCoverDept(v);
                        setCoverPos(undefined);
                        coverForm.setFieldValue('coveredEmployee', undefined);
                      }}
                    />
                    <Select
                      allowClear
                      placeholder="ຕຳແໜ່ງ (ຜູ້ຖືກແທນ)"
                      style={{ width: 190 }}
                      value={coverPos}
                      options={coverPosOptions}
                      onChange={(v) => {
                        setCoverPos(v);
                        coverForm.setFieldValue('coveredEmployee', undefined);
                      }}
                    />
                  </Space>
                  <Form form={coverForm} layout="inline" onFinish={handleCover}>
                    <Form.Item name="coveredEmployee" rules={[{ required: true, message: 'ເລືອກຜູ້ຖືກແທນ' }]}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="ຜູ້ຖືກແທນ"
                        style={{ width: 260 }}
                        options={coverTargetOptions}
                        onChange={fillCoverTime}
                      />
                    </Form.Item>
                    <Form.Item name="time" rules={[{ required: true, message: 'ເລືອກເວລາ' }]}>
                      <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={creating}>
                      ບັນທຶກການໄປເຮັດແທນ
                    </Button>
                  </Form>
                </Space>
              )}

              {choice === 'editCover' && editingOverride && (
                <Form form={editCoverForm} layout="inline" onFinish={handleEditCover}>
                  <Form.Item name="time" rules={[{ required: true, message: 'ເລືອກເວລາ' }]}>
                    <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={updating}>
                    ບັນທຶກເວລາໃໝ່
                  </Button>
                </Form>
              )}

              {choice === 'substitute' &&
                (editingCell?.kind === 'substituted' ? (
                  <Popconfirm
                    title="ຍົກເລີກການມີຄົນມາແທນ?"
                    description="ຈະກັບໄປວ່າງເປົ່າຄືເດີມ — ຕ້ອງໄປຈັດຄິວ ຫຼື ຕັ້ງວັນພັກໃຫ້ໃໝ່ຖ້າຕ້ອງການ"
                    okText="ຍົກເລີກ"
                    cancelText="ບໍ່"
                    onConfirm={handleCancelSubstitute}
                  >
                    <Button danger loading={submittingSubstitute}>
                      ຍົກເລີກການມີຄົນມາແທນ
                    </Button>
                  </Popconfirm>
                ) : (
                  <Popconfirm
                    title="ໝາຍວ່າມີຄົນມາແທນ?"
                    description="ຈະບໍ່ຖືກຄິດເປັນວັນຂາດວຽກ, ແລະຄິວທີ່ຈັດໄວ້ໃນມື້ນີ້ (ຖ້າມີ) ຈະຖືກລຶບອອກໃຫ້ອັດຕະໂນມັດ"
                    okText="ຢືນຢັນ"
                    cancelText="ບໍ່"
                    onConfirm={handleSubstitute}
                  >
                    <Button type="primary" loading={submittingSubstitute}>
                      ຢືນຢັນວ່າມີຄົນມາແທນ
                    </Button>
                  </Popconfirm>
                ))}
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title={recurringRestFor ? `ຕັ້ງວັນພັກປະຈຳອາທິດ — ${recurringRestFor.firstName} ${recurringRestFor.lastName}` : ''}
        open={!!recurringRestFor}
        onOk={saveRecurringRest}
        onCancel={() => setRecurringRestFor(null)}
        confirmLoading={savingRestDay}
        okText={clearingRestDay ? 'ຢືນຢັນຍົກເລີກວັນພັກປະຈຳ' : 'ບັນທຶກ'}
        okButtonProps={{ disabled: !canSaveRestDay, danger: clearingRestDay }}
        cancelText="ປິດ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ເລືອກວັນໃນອາທິດທີ່ຄົນນີ້ພັກປະຈຳ (ເລືອກໄດ້ຫຼາຍວັນ) — ລະບົບຈະຕັ້ງເປັນວັນພັກໃຫ້ທຸກວັນນັ້ນອັດຕະໂນມັດ ນັບແຕ່ວັນທີ່ມີຜົນເປັນຕົ້ນໄປ ໂດຍບໍ່ຕ້ອງກົດເລືອກທີລະວັນ — ມື້ທີ່ຜ່ານມາແລ້ວຍັງຄືເກົ່າ
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          ວັນພັກປະຈຸບັນ: <Typography.Text strong>{restDaysLabel(recurringRestFor?.defaultRestDay ?? [])}</Typography.Text>
        </Typography.Paragraph>
        {!!waitingRestChanges?.length && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f9f0ff', borderRadius: 6 }}>
            <Typography.Text strong>ລໍຖ້າມີຜົນ</Typography.Text>
            {waitingRestChanges.map((c) => (
              <div key={c._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                <span>
                  ແຕ່ {dayjs(c.effectiveDate).format('dddd DD/MM/YYYY')}: {restDaysLabel(c.newRestDay)}
                </span>
                <Popconfirm
                  title="ຍົກເລີກການປ່ຽນນີ້?"
                  okText="ຍົກເລີກການປ່ຽນ"
                  cancelText="ບໍ່"
                  onConfirm={() => cancelWaitingRestChange(c._id)}
                >
                  <Button size="small" type="link" danger>
                    ຍົກເລີກ
                  </Button>
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <Typography.Text>ເລີ່ມມີຜົນແຕ່</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            options={restStartOptions}
            loading={!restStart}
            disabled={!restStart}
            value={restStart ?? undefined}
            onChange={(v: string) => pickRestStart(v)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {restSetup
              ? 'ຍັງບໍ່ມີວັນພັກປະຈຳ ຈຶ່ງເລີ່ມໄດ້ໄວທີ່ສຸດ ຫຼື ວັນຈັນທີ່ເລືອກ'
              : 'ເລີ່ມວັນຈັນ — ແຕ່ລະອາທິດຈຶ່ງພັກຕາມແບບດຽວກັນທັງອາທິດ ບໍ່ມີອາທິດທີ່ພັກ 2 ເທື່ອ'}
          </Typography.Text>
        </div>
        <Typography.Text>ວັນພັກ</Typography.Text>
        <Select
          mode="multiple"
          style={{ width: '100%', marginTop: 4 }}
          options={weekdayOptionsForRecurringRest}
          placeholder="ບໍ່ມີວັນພັກປະຈຳ"
          loading={!recurringRestDay}
          disabled={!recurringRestDay}
          value={recurringRestDay ?? []}
          onChange={(v) => pickRestDays(v)}
        />
        {restrictedDaysForRecurring.length > 0 && (
          <Typography.Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
            ຕຳແໜ່ງນີ້ຫ້າມພັກ: {restrictedDaysForRecurring.map((d: number) => WEEKDAY_OPTIONS[d].label).join(', ')}
          </Typography.Paragraph>
        )}
        {restDayChanged && (
          <div style={{ marginTop: 12, padding: '8px 12px', border: '1px solid var(--app-border-color, #d9d9d9)', borderRadius: 6 }}>
            {!currentRestPlan && <Typography.Text type="secondary">ກຳລັງກວດ…</Typography.Text>}
            {currentRestPlan?.error && <Typography.Text type="danger">{currentRestPlan.error}</Typography.Text>}
            {shownRestPlan && (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {shownRestPlan.unchanged ? (
                  <Typography.Text type={shownRestPlan.replaces.length ? undefined : 'secondary'}>
                    {shownRestPlan.replaces.length
                      ? `ຈະຍົກເລີກການປ່ຽນທີ່ລໍຖ້າຢູ່ — ວັນພັກຍັງເປັນ ${restDaysLabel(shownRestPlan.restDays)} ຄືເກົ່າ`
                      : 'ບໍ່ມີຫຍັງປ່ຽນ — ວັນພັກເປັນແບບນີ້ຢູ່ແລ້ວ'}
                  </Typography.Text>
                ) : (
                  <>
                    <div>
                      {shownRestPlan.restDays.length ? `ພັກ ${restDaysLabel(shownRestPlan.restDays)}` : 'ຍົກເລີກວັນພັກປະຈຳ'} ມີຜົນແຕ່{' '}
                      <Typography.Text strong>{dayjs(shownRestPlan.effectiveDate).format('dddd DD/MM/YYYY')}</Typography.Text>
                      {restChangeReason(shownRestPlan) && (
                        <div>
                          <Typography.Text type="secondary">{restChangeReason(shownRestPlan)}</Typography.Text>
                        </div>
                      )}
                    </div>
                    {shownRestPlan.redirected && (
                      <Typography.Text type="warning">
                        ຕຳແໜ່ງນີ້ຫ້າມພັກບາງວັນທີ່ເລືອກ — ຈະບັນທຶກເປັນ: {restDaysLabel(shownRestPlan.restDays)}
                      </Typography.Text>
                    )}
                    {shownRestPlan.replaces.length > 0 && (
                      <Typography.Text type="secondary">
                        ແທນການປ່ຽນທີ່ລໍຖ້າຢູ່:{' '}
                        {shownRestPlan.replaces
                          .map((r) => `${restDaysLabel(r.newRestDay)} ແຕ່ ${dayjs(r.effectiveDate).format('DD/MM/YYYY')}`)
                          .join('; ')}
                      </Typography.Text>
                    )}
                    {shownRestPlan.conflicts.length > 0 && (
                      <div>
                        <Typography.Text type="warning">ມື້ຕໍ່ໄປນີ້ມີຄິວເຮັດວຽກຈັດໄວ້ແລ້ວ ຈະບໍ່ໄດ້ພັກຈົນກວ່າຈະລຶບຄິວອອກ:</Typography.Text>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                          {shownRestPlan.conflicts.map((c) => (
                            <li key={c.date}>
                              {dayjs(c.date).format('dddd DD/MM/YYYY')}
                              {c.startTime && c.endTime ? ` (${c.startTime}-${c.endTime})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {clearingRestDay && (
                      <Typography.Text type="danger">ຫຼັງຈາກນັ້ນຈະບໍ່ມີວັນພັກປະຈຳອາທິດອີກ — ຕ້ອງໄປຕັ້ງວັນພັກເອງທີລະວັນຖ້າຕ້ອງການ</Typography.Text>
                    )}
                  </>
                )}
                {canSaveRestDay && shownRestPlan.leavesAffected > 0 && (
                  <Typography.Text type="secondary">ໃບລາ {shownRestPlan.leavesAffected} ໃບ ຈະຖືກຄິດມື້ລາໃໝ່ຕາມວັນພັກໃໝ່</Typography.Text>
                )}
              </Space>
            )}
          </div>
        )}
        {/* Clearing the picker by hand works too — this is the findable way,
            and either way saving asks again with a red button. */}
        {plannedRestDays.length > 0 && !!recurringRestDay?.length && (
          <Button danger style={{ marginTop: 12 }} onClick={() => pickRestDays([])}>
            ຍົກເລີກວັນພັກປະຈຳ
          </Button>
        )}
      </Modal>
    </>
  );
};

const SCHEDULE_VIEW_OPTIONS = [
  { value: 'monthly', label: 'ຕາຕະລາງວັນພັກ' },
  { value: 'covers', label: 'ການເຮັດແທນ — ລາຍລະອຽດ' },
];

// Combines ຕາຕະລາງວັນພັກ and ການເຮັດແທນ (previously two separate sidebar pages)
// behind one dropdown. Switching toggles visibility only (display:none), never
// unmounts either grid — swapping which one renders would tear the hidden one
// down and remount the other from scratch every time (refetching everything
// and rebuilding its whole table), which is exactly what made switching feel
// slow/stuck. ScheduleCoversGrid only mounts the first time it's actually
// selected (no point paying its fetch cost if nobody ever opens it), then
// stays mounted so every switch after that first one is instant either way.
export const MonthlySchedulePage: React.FC = () => {
  const [view, setView] = useState<'monthly' | 'covers'>('monthly');
  const [coversMounted, setCoversMounted] = useState(false);

  const handleViewChange = (v: 'monthly' | 'covers') => {
    setView(v);
    if (v === 'covers') setCoversMounted(true);
  };
  const { data: identity } = useGetIdentity<Identity>();
  const canPlanRestDays = identity?.role === 'admin' || identity?.role === 'manager';
  const { list: goToList } = useNavigation();

  return (
    <List
      title={view === 'monthly' ? 'ຕາຕະລາງວັນພັກ' : 'ການເຮັດແທນ — ລາຍລະອຽດ'}
      breadcrumb={false}
      headerButtons={
        <Space>
          {canPlanRestDays && view === 'monthly' && (
            <Button icon={<CalendarOutlined />} onClick={() => goToList('rest-day-plan')}>
              ວາງແຜນວັນພັກ
            </Button>
          )}
          <Select value={view} onChange={handleViewChange} options={SCHEDULE_VIEW_OPTIONS} style={{ minWidth: 220 }} />
        </Space>
      }
    >
      <div style={{ display: view === 'monthly' ? 'block' : 'none' }}>
        <MonthlyScheduleGrid />
      </div>
      {coversMounted && (
        <div style={{ display: view === 'covers' ? 'block' : 'none' }}>
          <ScheduleCoversGrid />
        </div>
      )}
    </List>
  );
};
