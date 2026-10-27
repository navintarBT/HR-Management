import { useMemo, useState, type CSSProperties } from 'react';
import { useSelect } from '@refinedev/antd';
import { useList, useCustom, useCreate, useDelete, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Statistic, Card, Select, Modal, Form, DatePicker, TimePicker, Segmented, Grid } from 'antd';
import { LeftOutlined, RightOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Leave, Position, RestDayScheduleRow, Shift, ShiftChangeLogEntry } from '../../types';
import { API_URL } from '../../providers/axios';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { groupRestRowsByEmployee, restDaysOn } from '../../utils/restDays';
import { preferredOverride } from '../../utils/dayOverride';
import { groupLogsByEmployee, shiftOnDate, regularShiftHours } from '../../utils/shiftHistory';

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
// signature lines — holding the weekly roster: this page's own columns and
// the seven weekdays, no dates.
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
// Every print column except the seven weekdays (ລ/ດ 22 + ລະຫັດ 42 + ຊື່ 110 +
// ຕຳແໜ່ງ 70 + ກະ 62 + ມີຄົນແທນ 52 + ໄປແທນ 40 + ຊມ.ແທນ 44) — the weekdays
// split what's left of the page width.
const PRINT_FIXED_COLS_WIDTH_PX = 22 + 42 + 110 + 70 + 62 + 52 + 40 + 44;
const PRINT_DAY_COL_WIDTH_PX = (PRINT_PAGE_WIDTH_PX - PRINT_FIXED_COLS_WIDTH_PX) / 7;
// Day-cell colours in print, and the legend above the table.
const PRINT_TONE = {
  rest: { bg: '#d9d9d9', text: '#434343' },
  covering: { bg: '#f9f0ff', text: '#531dab' },
  coveredBy: { bg: '#f6ffed', text: '#237804' },
};
const PRINT_LEGEND: { label: string; tone: keyof typeof PRINT_TONE; text: string }[] = [
  { label: 'ພ', tone: 'rest', text: 'ພັກ' },
  { label: 'ແທນ', tone: 'covering', text: 'ໄປເຮັດແທນຄົນອື່ນ' },
  { label: 'ແທນໂດຍ', tone: 'coveredBy', text: 'ມີຄົນມາແທນ (×ຈຳນວນຄັ້ງໃນເດືອນ)' },
];
const printToneStyle = (value: number, tone: keyof typeof PRINT_TONE) =>
  value > 0 ? { background: PRINT_TONE[tone].bg, color: PRINT_TONE[tone].text, fontWeight: 600 } : undefined;


// 'month': one column per date. 'week': the same month by weekday, with no
// dates — who rests which day, and the covers as a standing weekly roster.
type CoverView = 'month' | 'week';
// Monday first, the way the week is counted everywhere else.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Someone's own day, worked out the way ຕາຕະລາງວັນພັກ does it (monthly.tsx
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
// The same on the weekly roster: covers grouped when the same people at the
// same time repeat on that weekday, with how many times this month.
type WeekdayCover = { key: string; shift: Shift; count: number };
type WeekdayInfo = { resting: boolean; covering: WeekdayCover[]; coveredBy: WeekdayCover[] };

const OFF_STYLE: Record<'rest' | 'leave', CSSProperties> = {
  rest: { background: 'rgba(128, 128, 128, 0.12)' },
  leave: { background: '#fffbe6' },
};

function groupRepeats(shifts: Shift[], keyOf: (s: Shift) => string): WeekdayCover[] {
  const list: WeekdayCover[] = [];
  for (const s of shifts) {
    const key = keyOf(s);
    const same = list.find((c) => c.key === key);
    if (same) same.count += 1;
    else list.push({ key, shift: s, count: 1 });
  }
  return list.sort((a, b) => (a.shift.startTime ?? '').localeCompare(b.shift.startTime ?? ''));
}

// ການເຮັດແທນ — an overview of a department or position for the month: everyone
// in it, one row each, with the days they're off (rest or leave) and who
// covers them, and the covers they do for others. A day off can be handed to
// someone from right there (ຫາຄົນແທນ) — every employee is offered, each with
// what their own day looks like, and HR picks. The weekly roster shows the
// same month by weekday with no dates, to read only. Covers are also created
// from ຕາຕະລາງວັນພັກ (click a day → ໄປເຮັດແທນຄົນອື່ນ) or with ມອບໝາຍການເຮັດແທນ.
export const ScheduleCoversGrid: React.FC = () => {
  const [view, setView] = useState<CoverView>('month');
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const rangeStart = monthStart;
  const dayCount = monthStart.daysInMonth();
  const rangeEnd = rangeStart.add(dayCount - 1, 'day');
  const rangeDays = useMemo(() => Array.from({ length: monthStart.daysInMonth() }, (_, i) => monthStart.add(i, 'day')), [monthStart]);
  const periodText = 'ໃນເດືອນນີ້';
  const startKey = rangeStart.format('YYYY-MM-DD');
  const endKey = rangeEnd.format('YYYY-MM-DD');
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

  // What each day is for each person — the same sources ຕາຕະລາງວັນພັກ reads.
  const { data: restScheduleData } = useCustom<RestDayScheduleRow[]>({
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

  // Same choices as ສະຫຼຸບເງິນເດືອນ's ກອງຕາມບຸກຄົນ — narrowed by the other two.
  const personOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => (!departmentFilter || idOf(e.department) === departmentFilter) && (!positionFilter || idOf(e.position) === positionFilter))
        .map((e) => ({ label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(), value: e._id })),
    [allEmployees, departmentFilter, positionFilter]
  );

  // Everyone in the department / position / person picked, grouped by position.
  const rows = useMemo(
    () =>
      allEmployees
        .filter(
          (e) =>
            (!departmentFilter || idOf(e.department) === departmentFilter) &&
            (!positionFilter || idOf(e.position) === positionFilter) &&
            (!personFilter || e._id === personFilter)
        )
        .sort((a, b) => positionOf(a).localeCompare(positionOf(b)) || (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '')),
    [allEmployees, departmentFilter, positionFilter, personFilter]
  );

  const dayInfo = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const emp of rows) {
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
  }, [rows, rangeDays, shiftIndex, leaveRanges, restRowsByEmployee, shiftLogsByEmployee]);
  const infoOn = (emp: Employee, dateKey: string) =>
    dayInfo.get(`${emp._id}_${dateKey}`) ?? { status: { kind: 'unset' } as DayStatus, covering: [], coveredBy: [] };

  // The weekly roster — each person's rest day as it stands today, and this
  // month's covers by weekday.
  const weekInfo = useMemo(() => {
    const map = new Map<string, WeekdayInfo>();
    for (const emp of rows) {
      for (const dow of WEEK_ORDER) {
        const days = rangeDays.filter((d) => d.day() === dow).map((d) => `${emp._id}_${d.format('YYYY-MM-DD')}`);
        map.set(`${emp._id}_${dow}`, {
          resting: (emp.defaultRestDay ?? []).includes(dow),
          covering: groupRepeats(
            days.flatMap((k) => shiftIndex.covering.get(k) ?? []),
            (s) => `${idOf(s.coveringFor as Employee)}_${idOf(s.position as Position)}_${s.startTime}_${s.endTime}`
          ),
          coveredBy: groupRepeats(
            days.flatMap((k) => shiftIndex.coveredBy.get(k) ?? []),
            (s) => `${idOf(s.employee as Employee)}_${s.startTime}_${s.endTime}`
          ),
        });
      }
    }
    return map;
  }, [rows, rangeDays, shiftIndex]);
  const weekInfoOf = (emp: Employee, dow: number) => weekInfo.get(`${emp._id}_${dow}`) ?? { resting: false, covering: [], coveredBy: [] };

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
    return `${base} ປະຈໍາເດືອນ ${monthStart.format('MMMM YYYY')}`;
  })();
  const printTotalColumns = 5 + 7 + 3;

  const { mutate: deleteShift } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
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
  const assignTime = (() => {
    if (!assignFor) return undefined;
    const time = regularTimeOn(assignFor.employee, assignFor.dateKey);
    return time ? [dayjs(`${assignFor.dateKey}T${time.start}`), dayjs(`${assignFor.dateKey}T${time.end}`)] : undefined;
  })();
  const assignOptions = useMemo(() => {
    if (!assignFor) return [];
    return allEmployees
      .filter((e) => e._id !== assignFor.employee._id)
      .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? ''))
      .map((e) => {
        const covering = shiftIndex.covering.get(`${e._id}_${assignFor.dateKey}`) ?? [];
        return {
          value: e._id,
          label: `${e.employeeCode ?? ''} ${fullName(e)}`.trim(),
          position: positionOf(e),
          day: [
            dayStatusLabel(statusOn(e, assignFor.dateKey)),
            ...covering.map((s) => `ແທນ ${codeOf(s.coveringFor as Employee)} ${s.startTime}-${s.endTime}`),
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
      () => setAssignFor(null)
    );
  };

  // ມອບໝາຍການເຮັດແທນ — the same, with the coverer, date and covered person all
  // picked by hand; mirrors ຕາຕະລາງວັນພັກ's own "ໄປເຮັດແທນຄົນອື່ນ" flow
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
    const time = covered ? regularTimeOn(covered, date.format('YYYY-MM-DD')) : null;
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
  const offStyle = (status: DayStatus) => (status.kind === 'rest' || status.kind === 'leave' ? { style: OFF_STYLE[status.kind] } : {});

  const dateCell = (emp: Employee, dateKey: string) => {
    const info = infoOn(emp, dateKey);
    const off = isOff(info.status);
    if (!off && !info.covering.length && !info.coveredBy.length) return <span style={{ color: '#bfbfbf' }}>-</span>;
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {off && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{dayStatusLabel(info.status)}</div>}
        {info.coveredBy.map((s) => coveredByLine(s, s._id))}
        {off && (
          <Button size="small" type="link" icon={<PlusOutlined />} style={{ padding: 0, height: 'auto' }} onClick={() => setAssignFor({ employee: emp, dateKey })}>
            ຫາຄົນແທນ
          </Button>
        )}
        {info.covering.map((s) => coverCard(s, s._id))}
      </Space>
    );
  };

  const weekdayCell = (emp: Employee, dow: number) => {
    const info = weekInfoOf(emp, dow);
    if (!info.resting && !info.covering.length && !info.coveredBy.length) return <span style={{ color: '#bfbfbf' }}>-</span>;
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {info.resting && <div style={{ color: '#8c8c8c', fontSize: 12 }}>ພັກ</div>}
        {info.coveredBy.map((c) => coveredByLine(c.shift, c.key, c.count))}
        {info.covering.map((c) => coverCard(c.shift, c.key, c.count))}
      </Space>
    );
  };

  // Header line for each column: how many in the group are off, and how many
  // of them have someone covering.
  const dateSummary = (dateKey: string) => {
    let off = 0;
    let covered = 0;
    for (const emp of rows) {
      const info = infoOn(emp, dateKey);
      if (!isOff(info.status)) continue;
      off += 1;
      if (info.coveredBy.length) covered += 1;
    }
    return { off, covered };
  };
  const restingOnWeekday = (dow: number) => rows.filter((emp) => weekInfoOf(emp, dow).resting).length;

  // A person's totals for the month, along the right of the printed roster.
  const rosterTotalsOf = (emp: Employee) => {
    let covered = 0;
    let covering = 0;
    let hours = 0;
    for (const dow of WEEK_ORDER) {
      const info = weekInfoOf(emp, dow);
      for (const c of info.coveredBy) covered += c.count;
      for (const c of info.covering) {
        covering += c.count;
        hours += c.count * hoursBetween(c.shift.startTime, c.shift.endTime);
      }
    }
    return { covered, covering, hours };
  };

  return (
    <div>
      <style>{`
        .covers-print-only { display: none; }
        .covers-print-table { display: none; }
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
          <Segmented
            value={view}
            onChange={(v) => setView(v as CoverView)}
            options={[
              { label: 'ລາຍເດືອນ', value: 'month' },
              { label: 'ລາຍອາທິດ', value: 'week' },
            ]}
          />
          <Button icon={<LeftOutlined />} onClick={() => setMonthStart(monthStart.subtract(1, 'month'))} />
          <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
          <Button icon={<RightOutlined />} onClick={() => setMonthStart(dayjs().startOf('month'))}>
            ເດືອນນີ້
          </Button>
          <Button icon={<RightOutlined />} onClick={() => setMonthStart(monthStart.add(1, 'month'))} />
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            ມອບໝາຍການເຮັດແທນ
          </Button>
          {view === 'week' && (
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              ພິມ
            </Button>
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
        {view === 'week'
          ? 'ວັນພັກຂອງແຕ່ລະຄົນຕາມທີ່ເປັນຢູ່ຕອນນີ້ ແລະ ການເຮັດແທນຂອງເດືອນນີ້ ຈັດຕາມວັນໃນອາທິດ — ແທນຄົນດຽວກັນ ເວລາດຽວກັນ ລວມເປັນລາຍການດຽວ (×ຈຳນວນຄັ້ງໃນເດືອນ). ມອບໝາຍຄົນແທນໄດ້ໃນແບບລາຍເດືອນ'
          : 'ທຸກຄົນໃນພະແນກ / ຕຳແໜ່ງທີ່ເລືອກ — ມື້ພັກ ແລະ ມື້ລາ ຂອງແຕ່ລະຄົນ ແລະ ໃຜແທນ. ກົດ "ຫາຄົນແທນ" ໃນມື້ນັ້ນ ເພື່ອມອບໝາຍ'}
      </Typography.Paragraph>

      {/* Only the weekly roster prints. */}
      {view === 'week' && (
        <>
          <div className="covers-print-only" style={{ flexWrap: 'wrap', gap: 12, fontSize: 9, marginBottom: 4 }}>
            {PRINT_LEGEND.map((item) => (
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
              <col style={{ width: 22 }} />
              <col style={{ width: 42 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 62 }} />
              {WEEK_ORDER.map((dow) => (
                <col key={dow} style={{ width: PRINT_DAY_COL_WIDTH_PX }} />
              ))}
              <col style={{ width: 52 }} />
              <col style={{ width: 40 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                {/* Spans the whole header row so it repeats on every printed page
                    with the column headers below it, as on ສະຫຼຸບເງິນເດືອນ. */}
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
                <th style={PRINT_TH}>ຕຳແໜ່ງ</th>
                <th style={PRINT_TH}>ກະ</th>
                {WEEK_ORDER.map((dow) => (
                  <th key={dow} style={{ ...PRINT_TH, lineHeight: 1.15 }}>
                    <div>{WEEKDAY_OPTIONS[dow].label}</div>
                    <div style={{ fontWeight: 400, fontSize: 7, color: '#8c8c8c' }}>ພັກ {restingOnWeekday(dow)} ຄົນ</div>
                  </th>
                ))}
                <th style={{ ...PRINT_TH, ...printToneStyle(1, 'coveredBy') }}>ມີຄົນແທນ</th>
                <th style={{ ...PRINT_TH, ...printToneStyle(1, 'covering') }}>ໄປແທນ</th>
                <th style={PRINT_TH}>ຊມ.ແທນ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((emp, idx) => {
                const totals = rosterTotalsOf(emp);
                return (
                  <tr key={emp._id}>
                    <td style={PRINT_TD}>{idx + 1}</td>
                    <td style={PRINT_TD}>{emp.employeeCode || '-'}</td>
                    <td style={{ ...PRINT_TD, textAlign: 'left' }}>{`${emp.firstName ?? ''} ${emp.lastName ?? ''}`}</td>
                    <td style={{ ...PRINT_TD, textAlign: 'left' }}>{positionOf(emp)}</td>
                    <td style={PRINT_TD}>{regularShiftHours(emp) ?? '-'}</td>
                    {WEEK_ORDER.map((dow) => {
                      const info = weekInfoOf(emp, dow);
                      const tone = info.resting ? PRINT_TONE.rest : info.covering.length ? PRINT_TONE.covering : undefined;
                      return (
                        <td
                          key={dow}
                          style={{ ...PRINT_TD, whiteSpace: 'normal', verticalAlign: 'top', textAlign: 'left', fontSize: 8, lineHeight: 1.25, background: tone?.bg, color: tone?.text }}
                        >
                          {info.resting && <div style={{ fontWeight: 700, textAlign: 'center' }}>ພ</div>}
                          {info.coveredBy.map((c) => (
                            <div key={c.key} style={{ color: PRINT_TONE.coveredBy.text }}>
                              ແທນໂດຍ {codeOf(c.shift.employee as Employee)} {firstNameOf(c.shift.employee as Employee)} {c.shift.startTime}-{c.shift.endTime} ×{c.count}
                            </div>
                          ))}
                          {info.covering.map((c) => (
                            <div key={c.key} style={{ color: PRINT_TONE.covering.text }}>
                              ແທນ {codeOf(c.shift.coveringFor as Employee)} {firstNameOf(c.shift.coveringFor as Employee)} {c.shift.startTime}-{c.shift.endTime} ×{c.count}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                    <td style={{ ...PRINT_TD, ...printToneStyle(totals.covered, 'coveredBy') }}>{totals.covered}</td>
                    <td style={{ ...PRINT_TD, ...printToneStyle(totals.covering, 'covering') }}>{totals.covering}</td>
                    <td style={PRINT_TD}>{Number(totals.hours.toFixed(2))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="covers-print-only" style={{ justifyContent: 'space-between', marginTop: 64, padding: '0 24px' }}>
            {['ຜູ້ຮັບຜິດຊອບ', 'ຜູ້ທວດສອບ', 'ຜູ້ທວດສອບ'].map((label, i) => (
              <div key={i} style={{ textAlign: 'center', width: 220 }}>
                <div style={{ height: 48 }} />
                <div style={{ borderTop: '1px solid #000' }} />
                <Typography.Title level={4} style={{ marginTop: 4, marginBottom: 0 }}>
                  {label}
                </Typography.Title>
              </div>
            ))}
          </div>
        </>
      )}

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
        {view === 'week'
          ? WEEK_ORDER.map((dow) => (
              <Table.Column
                key={`dow-${dow}`}
                width={150}
                title={
                  <div style={{ textAlign: 'center' }}>
                    <div>{WEEKDAY_OPTIONS[dow].label}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      ພັກ {restingOnWeekday(dow)} ຄົນ
                    </Typography.Text>
                  </div>
                }
                onCell={(emp: Employee) => (weekInfoOf(emp, dow).resting ? { style: OFF_STYLE.rest } : {})}
                render={(_, emp: Employee) => weekdayCell(emp, dow)}
              />
            ))
          : rangeDays.map((day) => {
              const dateKey = day.format('YYYY-MM-DD');
              const summary = dateSummary(dateKey);
              return (
                <Table.Column
                  key={dateKey}
                  width={150}
                  title={
                    <div style={{ textAlign: 'center' }}>
                      <div>{day.format('D')}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {day.format('ddd')}
                      </Typography.Text>
                      {summary.off > 0 && (
                        <div style={{ fontSize: 11, fontWeight: 400, color: summary.covered < summary.off ? '#d46b08' : '#389e0d' }}>
                          ພັກ/ລາ {summary.off} · ແທນ {summary.covered}
                        </div>
                      )}
                    </div>
                  }
                  onCell={(emp: Employee) => offStyle(infoOn(emp, dateKey).status)}
                  render={(_, emp: Employee) => dateCell(emp, dateKey)}
                />
              );
            })}
      </Table>

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
              {dayjs(assignFor.dateKey).format('dddd DD/MM/YYYY')} · {dayStatusLabel(infoOn(assignFor.employee, assignFor.dateKey).status)} ·{' '}
              {positionOf(assignFor.employee)}
            </Typography.Paragraph>
            {infoOn(assignFor.employee, assignFor.dateKey).coveredBy.length > 0 && (
              <Typography.Paragraph type="secondary">
                ມີຄົນແທນແລ້ວ:{' '}
                {infoOn(assignFor.employee, assignFor.dateKey)
                  .coveredBy.map((s) => `${codeOf(s.employee as Employee)} ${fullName(s.employee as Employee)} ${s.startTime}-${s.endTime}`)
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
              <Form.Item name="time" label="ເວລາ" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
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
    </div>
  );
};
