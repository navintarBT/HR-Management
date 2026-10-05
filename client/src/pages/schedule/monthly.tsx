import { useEffect, useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useGetIdentity, useCreate, useUpdate, useDelete, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Typography, Space, Button, Modal, Form, TimePicker, Select, Input, Popconfirm } from 'antd';
import { LeftOutlined, RightOutlined, CalendarOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { AttendanceDaily, Employee, Shift, Identity, Department, Position, ShiftCategory, Leave } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { API_URL, axiosInstance } from '../../providers/axios';

type Cell =
  | { kind: 'unset' }
  | { kind: 'rest'; isOverride: boolean; overrideId?: string; isHoliday?: boolean; holidayName?: string }
  | { kind: 'work'; start: string; end: string; isOverride: boolean; overrideId?: string }
  | { kind: 'substituted' }
  | { kind: 'leave' };

function idOf(value: { _id: string } | string | null | undefined) {
  return value && typeof value === 'object' ? value._id : value;
}

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
function computeCell(employee: Employee, dateKey: string, override?: Shift, isSubstituted?: boolean, isOnLeave?: boolean): Cell {
  if (isSubstituted) return { kind: 'substituted' };
  if (isOnLeave) return { kind: 'leave' };
  if (override) {
    if (override.status === 'rest') {
      const holiday = override.holiday;
      const isHoliday = !!(holiday && typeof holiday === 'object');
      return { kind: 'rest', isOverride: true, overrideId: override._id, isHoliday, holidayName: isHoliday ? holiday.name : undefined };
    }
    return { kind: 'work', start: override.startTime!, end: override.endTime!, isOverride: true, overrideId: override._id };
  }
  const dow = dayjs(dateKey).day();
  if (employee.defaultRestDay === dow) return { kind: 'rest', isOverride: false };
  const defaultTime = resolveDefaultTime(employee);
  if (defaultTime) return { kind: 'work', start: defaultTime.start, end: defaultTime.end, isOverride: false };
  return { kind: 'unset' };
}

const CELL_STYLE: Record<Cell['kind'], React.CSSProperties> = {
  unset: { background: 'var(--app-surface-bg)', border: '1px dashed var(--app-border-color, #d9d9d9)' },
  rest: { background: '#f9f0ff' },
  work: { background: 'transparent' },
  substituted: { background: '#e6fffb' },
  leave: { background: '#fffbe6' },
};

export const MonthlySchedulePage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isManager = identity?.role === 'admin' || identity?.role === 'manager';

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const daysInMonth = monthStart.daysInMonth();
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, 'day')), [monthStart, daysInMonth]);
  const monthStartKey = monthStart.format('YYYY-MM-DD');
  const monthEndKey = monthStart.endOf('month').format('YYYY-MM-DD');

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
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

  const employees = useMemo(
    () =>
      allEmployees.filter((e) => {
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
      }),
    [allEmployees, search, departmentFilter, positionFilter, shiftCategoryFilter]
  );

  const { data: shiftsData, isLoading: shiftsLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: monthStartKey },
      { field: 'date', operator: 'lte', value: monthEndKey },
    ],
    pagination: { pageSize: 3000 },
  });
  const shifts = shiftsData?.data ?? [];

  // Only 'scheduled'/'rest' shifts count as an override for this table — a
  // 'cancelled' one (from the position-based weekly schedule) isn't a rest-day
  // decision, so it's ignored here and the cell just falls back to the default.
  const overrideByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of shifts) {
      if (s.status === 'cancelled') continue;
      map[`${idOf(s.employee)}_${s.date}`] = s;
    }
    return map;
  }, [shifts]);

  // So a day marked "ມາແທນ" from ປະຫວັດການສະແກນ (or from this page's own modal)
  // shows up here too, instead of just reverting to blank once its queued
  // Shift is gone.
  const { data: attendanceDailyData } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: monthStartKey },
      { field: 'date', operator: 'lte', value: monthEndKey },
    ],
    pagination: { pageSize: 5000 },
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
  // they're not coming in). Fetched unfiltered by month, like other
  // client-side-filtered lists in this app — leave records are few per
  // employee either way.
  const { data: approvedLeavesData } = useList<Leave>({
    resource: 'leaves',
    filters: [{ field: 'status', operator: 'eq', value: 'approved' }],
    pagination: { pageSize: 2000, mode: 'server' },
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

  const [editing, setEditing] = useState<{ employee: Employee; dateKey: string } | null>(null);
  const editingOverride = editing ? overrideByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : undefined;
  const editingIsSubstituted = editing ? !!substitutedByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : false;
  const editingIsOnLeave = editing ? hasApprovedLeaveOn(editing.employee._id, editing.dateKey) : false;
  const editingCell = editing ? computeCell(editing.employee, editing.dateKey, editingOverride, editingIsSubstituted, editingIsOnLeave) : null;

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
  const { mutate: updateEmployee, isLoading: savingRestDay } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const saving = creating || updating || deleting;

  // A recurring weekly rest day (Employee.defaultRestDay) — set once here and
  // it applies to every matching weekday automatically, this month and every
  // month after, with no per-day clicking and no Shift rows created at all.
  const [recurringRestFor, setRecurringRestFor] = useState<Employee | null>(null);
  const [recurringRestDay, setRecurringRestDay] = useState<number>();

  const openRecurringRest = (emp: Employee) => {
    setRecurringRestFor(emp);
    setRecurringRestDay(emp.defaultRestDay ?? undefined);
  };

  const doSaveRecurringRest = () => {
    if (!recurringRestFor) return;
    updateEmployee(
      { resource: 'employees', id: recurringRestFor._id, values: { defaultRestDay: recurringRestDay ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
          setRecurringRestFor(null);
          invalidate({ resource: 'employees', invalidates: ['list'] });
        },
      }
    );
  };

  // A day-specific queue always wins over the weekly default (see computeCell),
  // so picking e.g. "rest every Friday" doesn't actually give a rest on a
  // Friday that already has a queued shift — warn about that up front, using
  // the days already loaded for the visible month, rather than let HR discover
  // it later by noticing a "resting" employee still shows up worked that day.
  const restDayConflicts = useMemo(() => {
    if (!recurringRestFor || recurringRestDay == null) return [];
    return days
      .filter((d) => d.day() === recurringRestDay)
      .map((d) => d.format('YYYY-MM-DD'))
      .filter((dateKey) => overrideByEmpDate[`${recurringRestFor._id}_${dateKey}`]?.status === 'scheduled');
  }, [recurringRestFor, recurringRestDay, days, overrideByEmpDate]);

  const restrictedDaysForRecurring =
    (recurringRestFor && typeof recurringRestFor.position === 'object' ? recurringRestFor.position?.restrictedRestDays : undefined) ?? [];
  const weekdayOptionsForRecurringRest = useMemo(
    () => WEEKDAY_OPTIONS.map((opt) => ({ ...opt, disabled: restrictedDaysForRecurring.includes(opt.value) })),
    [restrictedDaysForRecurring]
  );

  const saveRecurringRest = () => {
    if (!recurringRestFor) return;
    if (!restDayConflicts.length) {
      doSaveRecurringRest();
      return;
    }
    Modal.confirm({
      title: 'ພັກບໍ່ໄດ້ບາງວັນ ເພາະມີຄິວແລ້ວ',
      content: (
        <div>
          <p>ວັນທີ່ຕໍ່ໄປນີ້ຍັງມີຄິວຈັດໄວ້ຢູ່ ຈະບໍ່ໄດ້ພັກຈົນກວ່າຈະໄປລຶບຄິວອອກ:</p>
          <ul>
            {restDayConflicts.map((d) => (
              <li key={d}>{dayjs(d).format('DD/MM/YYYY')}</li>
            ))}
          </ul>
        </div>
      ),
      okText: 'ບັນທຶກຕໍ່',
      cancelText: 'ຍົກເລີກ',
      onOk: doSaveRecurringRest,
    });
  };

  // A separate, explicit action (with its own confirm step) rather than just
  // clearing the Select and saving — clearing a dropdown is an easy accidental
  // click that silently wipes someone's recurring rest day with no warning.
  const cancelRecurringRest = () => {
    if (!recurringRestFor) return;
    updateEmployee(
      { resource: 'employees', id: recurringRestFor._id, values: { defaultRestDay: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ຍົກເລີກວັນພັກປະຈຳສຳເລັດ' });
          setRecurringRestFor(null);
          invalidate({ resource: 'employees', invalidates: ['list'] });
        },
      }
    );
  };

  const closeModal = () => setEditing(null);
  const onSaved = () => {
    notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
    closeModal();
  };

  const upsertOverride = (values: Record<string, unknown>) => {
    if (editingOverride) {
      updateShift({ resource: 'shifts', id: editingOverride._id, values }, { onSuccess: onSaved });
    } else {
      createShift({ resource: 'shifts', values }, { onSuccess: onSaved });
    }
  };

  const handleSetRest = () => {
    if (!editing) return;
    upsertOverride({ employee: editing.employee._id, date: editing.dateKey, status: 'rest' });
  };

  const restrictedDaysForEditing =
    (editing && typeof editing.employee.position === 'object' ? editing.employee.position?.restrictedRestDays : undefined) ?? [];
  const isEditingDateRestDayBlocked =
    !!editing &&
    restrictedDaysForEditing.includes(dayjs(editing.dateKey).day()) &&
    !hasApprovedLeaveOn(editing.employee._id, editing.dateKey);

  const handleSaveTime = () => {
    if (!editing) return;
    const time = timeForm.getFieldValue('time') as [Dayjs, Dayjs] | undefined;
    if (!time) return;
    upsertOverride({
      employee: editing.employee._id,
      position: idOf(editing.employee.position),
      date: editing.dateKey,
      status: 'scheduled',
      startTime: time[0].format('HH:mm'),
      endTime: time[1].format('HH:mm'),
    });
  };

  const handleRevert = () => {
    if (!editingOverride) return;
    deleteShift({ resource: 'shifts', id: editingOverride._id }, { onSuccess: onSaved });
  };

  // Only offered on employees/positions flagged for it (see ຕັ້ງຄ່າກົດ "ມາແທນ")
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
      onSaved();
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
    <List title="ຕາຕະລາງວັນພັກ" breadcrumb={false}>
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
                  onClick={() => openRecurringRest(emp)}
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
                const cell = computeCell(emp, dateKey, override, isSubstituted, isOnLeave);
                const isOverride = (cell.kind === 'rest' || cell.kind === 'work') && cell.isOverride;
                return (
                  <div
                    onClick={() => isManager && setEditing({ employee: emp, dateKey })}
                    style={{
                      ...CELL_STYLE[cell.kind],
                      borderLeft: isOverride ? '3px solid #d46b08' : CELL_STYLE[cell.kind].borderLeft,
                      cursor: isManager ? 'pointer' : 'default',
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
                      </>
                    )}
                    {cell.kind === 'substituted' && <span style={{ color: '#08979c' }}>ມາແທນ</span>}
                    {cell.kind === 'leave' && <span style={{ color: '#d48806' }}>ລາ</span>}
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
            {editingCell?.kind === 'substituted' && 'ປັດຈຸບັນ: ມາແທນ (ມີຄົນອື່ນມາແທນ)'}
            {editingCell?.kind === 'leave' && 'ປັດຈຸບັນ: ລາ (ມີໃບລາອະນຸມັດແລ້ວຄຸມວັນນີ້)'}
          </Typography.Text>

          <Space wrap>
            <Button
              onClick={handleSetRest}
              loading={saving}
              disabled={isEditingDateRestDayBlocked}
              title={isEditingDateRestDayBlocked ? 'ຕຳແໜ່ງນີ້ຫ້າມພັກວັນນີ້' : undefined}
            >
              ຕັ້ງເປັນວັນພັກ
            </Button>
            {editingOverride && (
              <Button onClick={handleRevert} loading={saving}>
                ຄືນຄ່າປົກກະຕິ
              </Button>
            )}
            {canSubstitute && editingCell?.kind === 'substituted' && (
              <Popconfirm
                title="ຍົກເລີກ ມາແທນ?"
                description="ຈະກັບໄປວ່າງເປົ່າຄືເດີມ — ຕ້ອງໄປຈັດຄິວ ຫຼື ຕັ້ງວັນພັກໃຫ້ໃໝ່ຖ້າຕ້ອງການ"
                okText="ຍົກເລີກມາແທນ"
                cancelText="ບໍ່"
                onConfirm={handleCancelSubstitute}
              >
                <Button danger loading={submittingSubstitute}>
                  ຍົກເລີກ "ມາແທນ"
                </Button>
              </Popconfirm>
            )}
            {canSubstitute && editingCell?.kind !== 'substituted' && (
              <Popconfirm
                title="ຕັ້ງເປັນ ມາແທນ?"
                description="ໝາຍຄວາມວ່າມື້ນີ້ມີຄົນອື່ນມາແທນ — ຈະບໍ່ຖືກຄິດເປັນວັນຂາດວຽກ, ແລະຄິວທີ່ຈັດໄວ້ໃນມື້ນີ້ (ຖ້າມີ) ຈະຖືກລຶບອອກໃຫ້ອັດຕະໂນມັດ"
                okText="ຕັ້ງເປັນມາແທນ"
                cancelText="ບໍ່"
                onConfirm={handleSubstitute}
              >
                <Button loading={submittingSubstitute}>ຕັ້ງເປັນ "ມາແທນ" (ມີຄົນອື່ນມາແທນ)</Button>
              </Popconfirm>
            )}
          </Space>

          <Form form={timeForm} layout="inline">
            <Form.Item name="time" label="ຫຼືກຳນົດເວລາເອງ">
              <TimePicker.RangePicker format="HH:mm" minuteStep={15} />
            </Form.Item>
            <Button type="primary" onClick={handleSaveTime} loading={saving}>
              ບັນທຶກເວລາ
            </Button>
          </Form>
        </Space>
      </Modal>

      <Modal
        title={recurringRestFor ? `ຕັ້ງວັນພັກປະຈຳອາທິດ — ${recurringRestFor.firstName} ${recurringRestFor.lastName}` : ''}
        open={!!recurringRestFor}
        onOk={saveRecurringRest}
        onCancel={() => setRecurringRestFor(null)}
        confirmLoading={savingRestDay}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ເລືອກວັນໃນອາທິດທີ່ຄົນນີ້ພັກປະຈຳ — ລະບົບຈະຕັ້ງເປັນວັນພັກໃຫ້ທຸກວັນນັ້ນອັດຕະໂນມັດ ທັງເດືອນນີ້ ແລະ ທຸກເດືອນຕໍ່ໄປ ໂດຍບໍ່ຕ້ອງກົດເລືອກທີລະວັນ
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          options={weekdayOptionsForRecurringRest}
          placeholder="ບໍ່ມີວັນພັກປະຈຳ"
          value={recurringRestDay}
          onChange={(v) => setRecurringRestDay(v)}
        />
        {restrictedDaysForRecurring.length > 0 && (
          <Typography.Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
            ຕຳແໜ່ງນີ້ຫ້າມພັກ: {restrictedDaysForRecurring.map((d: number) => WEEKDAY_OPTIONS[d].label).join(', ')}
          </Typography.Paragraph>
        )}
        {recurringRestFor?.defaultRestDay != null && (
          <Popconfirm
            title={`ຍົກເລີກວັນພັກປະຈຳຂອງ ${recurringRestFor.firstName}?`}
            description="ຫຼັງຈາກນີ້ຈະບໍ່ມີວັນພັກປະຈຳອາທິດອີກ — ຕ້ອງໄປຕັ້ງວັນພັກເອງທີລະວັນຖ້າຕ້ອງການ"
            okText="ຍົກເລີກວັນພັກປະຈຳ"
            cancelText="ບໍ່"
            onConfirm={cancelRecurringRest}
          >
            <Button danger style={{ marginTop: 12 }} loading={savingRestDay}>
              ຍົກເລີກວັນພັກປະຈຳ
            </Button>
          </Popconfirm>
        )}
      </Modal>
    </List>
  );
};
