import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useCustom, useGetIdentity, useNotification } from '@refinedev/core';
import { Table, DatePicker, Button, Space, Typography, Modal, Form, TimePicker, Input, Select, Divider, Popconfirm } from 'antd';
import { LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceDaily, Department, Employee, Identity, Position, Shift, ScheduledPositionSwap } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';
import { lateLabel } from '../../utils/lateSeverity';

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// An unexcused absence (no leave covering the day) is worse when it lands on
// a day the employee's position isn't even allowed to schedule as a rest day
// (Position.restrictedRestDays, ตั้งค่ากฎตำแหน่ง) — the business specifically
// can't afford anyone missing that day, so it's flagged X3 instead of the
// ordinary X2.
function absentSeverity(emp: Employee, day: Dayjs): 'X2' | 'X3' {
  const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
  const dow = day.day();
  // The employee's own override (ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ) fully replaces the
  // position's noAbsenceDays/restrictedRestDays when set — same precedence
  // as the server's mergeRestDayRule in restDayRules.js.
  const noAbsenceDays = emp.noAbsenceDays?.length ? emp.noAbsenceDays : position?.noAbsenceDays ?? [];
  const noAbsenceSeverity = emp.noAbsenceSeverity ?? position?.noAbsenceSeverity;
  // An explicit ວັນຫ້າມຂາດ severity (ຕັ້ງຄ່າກົດຂອງຕຳແໜ່ງ) wins when set — it's
  // the more deliberately configured value, and the only way to reach X1.
  if (noAbsenceDays.includes(dow) && noAbsenceSeverity) return noAbsenceSeverity;
  const restrictedRestDays = emp.restrictedRestDays?.length ? emp.restrictedRestDays : position?.restrictedRestDays ?? [];
  return restrictedRestDays.includes(dow) ? 'X3' : 'X2';
}

const { RangePicker } = DatePicker;

// Background/text pair per AttendanceDaily.status, plus a "rest day" look-alike
// for days with no record at all that match the employee's recurring day off
// (ຕາຕະລາງວັນພັກ's defaultRestDay) — distinguishes "scheduled off" from a
// genuinely blank/unprocessed day, which otherwise both show as "-".
const CELL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  late: { bg: '#fff7e6', text: '#d46b08', label: 'ຊ້າ' },
  incomplete: { bg: '#f9f0ff', text: '#722ed1', label: 'ສະແກນຄັ້ງດຽວ' },
  absent: { bg: '#fff1f0', text: '#cf1322', label: 'ຂາດວຽກ' },
  leave: { bg: '#e6f4ff', text: '#1677ff', label: 'ລາ' },
  rest: { bg: '#f6ffed', text: '#389e0d', label: 'ພັກ' },
  substituted: { bg: '#e6fffb', text: '#08979c', label: 'ມາແທນ' },
  swapped: { bg: '#fff0f6', text: '#c41d7f', label: 'ສະຫຼັບກະ' },
};

// Same fallback order as the server's resolveExpectedStart: a day-specific
// queued Shift wins when one exists, otherwise the employee's own recurring
// default (a linked category is a live reference; a manually-set fixed time
// is the fallback for an employee with no matching category).
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

// Employee rows x day columns, each cell showing that day's first-to-last scan
// (AttendanceDaily.firstIn/lastOut already ARE the first/last raw scan of the
// day — see attendanceProcessor.recomputeDay — so no need to re-derive from
// AttendanceLog directly). Prev/this-month/next buttons jump a full calendar
// month at a time; the range picker next to them allows any custom span too
// (including one crossing a month boundary, e.g. the 23rd to the 3rd).
const AttendanceSummaryGrid: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isManager = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);

  const days = useMemo(() => {
    const count = range[1].startOf('day').diff(range[0].startOf('day'), 'day') + 1;
    return Array.from({ length: Math.max(count, 0) }, (_, i) => range[0].add(i, 'day'));
  }, [range]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');

  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status_in', operator: 'eq', value: 'active,resigned' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();

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
        return true;
      }),
    [allEmployees, search, departmentFilter, positionFilter]
  );

  const { data: dailyData, isLoading: dailyLoading, refetch: refetchDaily } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    pagination: { pageSize: 5000 },
  });
  const dailyRows = dailyData?.data ?? [];

  const byEmpDate = useMemo(() => {
    const map: Record<string, AttendanceDaily> = {};
    for (const d of dailyRows) {
      // A record whose employee was since deleted has nowhere to attribute it to — skip it.
      if (!d.employee) continue;
      const empId = typeof d.employee === 'object' ? d.employee._id : d.employee;
      map[`${empId}_${d.date}`] = d;
    }
    return map;
  }, [dailyRows]);

  // Real Shift overrides (a one-off personal rest day, or a company holiday)
  // don't create an AttendanceDaily row — nothing was scanned — so they need
  // their own lookup, checked before falling back to the weekly default.
  const { data: shiftsData } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'rest' },
    ],
    pagination: { pageSize: 5000 },
  });
  const restByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of shiftsData?.data ?? []) {
      if (!s.employee) continue;
      const empId = typeof s.employee === 'object' ? s.employee._id : s.employee;
      map[`${empId}_${s.date}`] = s;
    }
    return map;
  }, [shiftsData?.data]);

  // Queued shifts (bulk-scheduled, or a swap standing someone in for a
  // different position/time) — looked up so the edit modal can suggest the
  // right expected time without HR needing to go check the schedule separately.
  const { data: scheduledShiftsData } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'scheduled' },
    ],
    pagination: { pageSize: 5000 },
  });
  const scheduledByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of scheduledShiftsData?.data ?? []) {
      if (!s.employee) continue;
      const empId = typeof s.employee === 'object' ? s.employee._id : s.employee;
      map[`${empId}_${s.date}`] = s;
    }
    return map;
  }, [scheduledShiftsData?.data]);

  // Auto-created when a position swap leaves this employee with no shift at
  // all that one day (see positionSwap.js) — also produces no AttendanceDaily
  // row, so without this it would show as a bare "-" indistinguishable from
  // a genuinely blank/unprocessed day.
  const { data: swappedShiftsData } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
      { field: 'status', operator: 'eq', value: 'swapped' },
    ],
    pagination: { pageSize: 5000 },
  });
  const swappedByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of swappedShiftsData?.data ?? []) {
      if (!s.employee) continue;
      const empId = typeof s.employee === 'object' ? s.employee._id : s.employee;
      map[`${empId}_${s.date}`] = s;
    }
    return map;
  }, [swappedShiftsData?.data]);

  // ສະຫຼັບຕຳແໜ່ງ — a pending ScheduledPositionSwap doesn't touch anyone's
  // position/shift until its own effectiveDate arrives (see positionSwap.js),
  // so there's nothing in the attendance data to reflect yet. This is purely
  // a heads-up overlay on the day it WILL happen — same marker as ຕາຕະລາງວັນພັກ.
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

  // A day scheduled off has nothing to correct — "manual fix" is for a scan
  // that should have happened but didn't (or logged the wrong time). A real
  // queued shift always wins over the employee's recurring day off — that's
  // exactly what a swap/stand-in override means (being asked to come in on
  // what would otherwise be your day off), so it must never be treated as rest.
  const isRestDay = (emp: Employee, dateKey: string, day: Dayjs) => {
    if (scheduledByEmpDate[`${emp._id}_${dateKey}`]) return false;
    if (restByEmpDate[`${emp._id}_${dateKey}`]) return true;
    const row = byEmpDate[`${emp._id}_${dateKey}`];
    return !row && (emp.defaultRestDay ?? []).includes(day.day());
  };

  const [editing, setEditing] = useState<{ employee: Employee; dateKey: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const { open: notify } = useNotification();

  const openEdit = (emp: Employee, dateKey: string) => {
    const row = byEmpDate[`${emp._id}_${dateKey}`];
    const queued = scheduledByEmpDate[`${emp._id}_${dateKey}`];
    const expected = queued ? { start: queued.startTime, end: queued.endTime } : resolveDefaultTime(emp);

    form.setFieldsValue({
      checkIn: row?.firstIn ? dayjs(row.firstIn) : expected ? dayjs(`${dateKey}T${expected.start}`) : undefined,
      checkOut: row?.lastOut ? dayjs(row.lastOut) : expected ? dayjs(`${dateKey}T${expected.end}`) : undefined,
      note: undefined,
    });
    setDisciplineReason('');
    setEditing({ employee: emp, dateKey });
  };

  // Deliberately forcing status='absent' as discipline — separate from the
  // manual-fix form above (that one corrects what a scan actually recorded;
  // this one overrides it on purpose, with a required reason so it's clear
  // later why an otherwise-normal day reads "ຂາດວຽກ").
  const [disciplineReason, setDisciplineReason] = useState('');
  const [markingAbsent, setMarkingAbsent] = useState(false);
  const editingRow = editing ? byEmpDate[`${editing.employee._id}_${editing.dateKey}`] : undefined;
  const isDisciplinaryAbsent = !!editingRow?.disciplinaryNote;

  const submitMarkAbsent = async () => {
    if (!editing || !disciplineReason.trim()) return;
    setMarkingAbsent(true);
    try {
      await axiosInstance.post(`${API_URL}/attendance/mark-absent`, {
        employeeId: editing.employee._id,
        date: editing.dateKey,
        note: disciplineReason.trim(),
      });
      notify?.({ type: 'success', message: 'ບັນທຶກເປັນຂາດວຽກແລ້ວ' });
      setEditing(null);
      refetchDaily();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setMarkingAbsent(false);
    }
  };

  const cancelMarkAbsent = async () => {
    if (!editing) return;
    setMarkingAbsent(true);
    try {
      await axiosInstance.post(`${API_URL}/attendance/cancel-absent-override`, {
        employeeId: editing.employee._id,
        date: editing.dateKey,
      });
      notify?.({ type: 'success', message: 'ຍົກເລີກການລົງໂທດແລ້ວ' });
      setEditing(null);
      refetchDaily();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    } finally {
      setMarkingAbsent(false);
    }
  };

  const submitFix = async (values: any) => {
    if (!editing) return;
    setSubmitting(true);
    try {
      await axiosInstance.post(`${API_URL}/attendance/manual-fix`, {
        employeeId: editing.employee._id,
        date: editing.dateKey,
        checkIn: values.checkIn.format('HH:mm'),
        checkOut: values.checkOut ? values.checkOut.format('HH:mm') : undefined,
        note: values.note,
      });
      notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
      setEditing(null);
      refetchDaily();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk backfill for when the scanning system itself was down (power outage,
  // server down for days) — fills everyone in as if they worked their normal
  // shift across the whole range, so the absence sweep doesn't later read an
  // infrastructure failure as a wave of no-shows. Admin-only, separate from
  // the per-person/per-day "mark as absent" override above.
  const [outageOpen, setOutageOpen] = useState(false);
  const [outageRange, setOutageRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [outageReason, setOutageReason] = useState('');
  const [outageSubmitting, setOutageSubmitting] = useState(false);

  const submitOutageFill = async () => {
    if (!outageRange || !outageReason.trim()) return;
    setOutageSubmitting(true);
    try {
      const res = await axiosInstance.post(`${API_URL}/attendance/bulk-mark-present`, {
        startDate: outageRange[0].format('YYYY-MM-DD'),
        endDate: outageRange[1].format('YYYY-MM-DD'),
        note: outageReason.trim(),
      });
      notify?.({
        type: 'success',
        message: `ລົງເວລາແລ້ວ ${res.data.filledCount} ລາຍການ (ຂ້າມ ${res.data.skippedCount} ລາຍການ)`,
      });
      setOutageOpen(false);
      setOutageRange(null);
      setOutageReason('');
      refetchDaily();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ລົງເວລາບໍ່ສຳເລັດ' });
    } finally {
      setOutageSubmitting(false);
    }
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Button icon={<LeftOutlined />} onClick={() => goToMonth(range[0].subtract(1, 'month'))} />
            <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
            <Button icon={<RightOutlined />} onClick={() => goToMonth(range[0].add(1, 'month'))} />
            <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
            <RangePicker
              value={range}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              format="DD/MM/YYYY"
              allowClear={false}
            />
            {isAdmin && (
              <Button danger onClick={() => setOutageOpen(true)}>
                ລົງເວລາຍ້ອນຫຼັງ (ລະບົບສະແກນເສຍ)
              </Button>
            )}
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
          </Space>
          <Space wrap size={[14, 6]}>
            {[
              { color: '#8c8c8c', outline: true, label: 'ມາເຮັດວຽກ (ບໍ່ມີສີ)' },
              { color: CELL_STYLE.late.text, label: 'ຊ້າ / ຊ້າເກີນ X ນາທີ / ຊ້າເກີນ Y (3 ລະດັບ, ສີດຽວກັນ)' },
              { color: CELL_STYLE.incomplete.text, label: 'ສະແກນຄັ້ງດຽວ' },
              { color: CELL_STYLE.absent.text, label: 'ຂາດວຽກ (X2) = ວັນທຳມະດາ, (X3) = ວັນຫ້າມພັກຂອງຕຳແໜ່ງ, (X1-X3) = ວັນຫ້າມຂາດທີ່ຕັ້ງໄວ້ສະເພາະ' },
              { color: CELL_STYLE.leave.text, label: 'ລາ' },
              { color: CELL_STYLE.rest.text, label: 'ພັກ / ຮ້ານປິດ' },
              { color: CELL_STYLE.substituted.text, label: 'ມາແທນ' },
              { color: CELL_STYLE.swapped.text, label: 'ສະຫຼັບກະ (ບໍ່ມີກະຍ້ອນມື້ສະຫຼັບຕຳແໜ່ງ)' },
            ].map((item) => (
              <Space key={item.label} size={6}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: item.outline ? 'transparent' : item.color,
                    border: item.outline ? `2px solid ${item.color}` : 'none',
                  }}
                />
                <Typography.Text strong style={{ fontSize: 13, color: item.color }}>
                  {item.label}
                </Typography.Text>
              </Space>
            ))}
          </Space>
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || dailyLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
      >
        <Table.Column title="ລະຫັດພະນັກງານ" fixed="left" width={100} dataIndex="employeeCode" />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          fixed="left"
          width={160}
          render={(_, emp: Employee) => {
            const time = resolveDefaultTime(emp);
            return (
              <div>
                <div>{`${emp.firstName ?? ''} ${emp.lastName ?? ''}`}</div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {time ? `${time.start}-${time.end}` : '-'}
                </Typography.Text>
              </div>
            );
          }}
        />
        <Table.Column
          title="ພະແນກ"
          fixed="left"
          width={120}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          fixed="left"
          width={140}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('DD')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {day.format('ddd')}
                  </Typography.Text>
                  <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 'normal' }}>ເຂົ້າ | ອອກ</div>
                </div>
              }
              width={100}
              onCell={(emp: Employee) => {
                // A swapped-blank day has no expected shift either (see
                // positionSwap.js) — nothing for manual-fix to correct, same
                // reasoning as a rest day.
                const clickable = isManager && !isRestDay(emp, dateKey, day) && !swappedByEmpDate[`${emp._id}_${dateKey}`];
                const pendingSwapWith = pendingSwapByPositionDate[`${idOf(emp.position)}_${dateKey}`];
                const style: React.CSSProperties = {};
                if (clickable) style.cursor = 'pointer';
                if (pendingSwapWith) {
                  style.outline = '2px dashed #9254de';
                  style.outlineOffset = -2;
                }
                return {
                  ...(clickable ? { onClick: () => openEdit(emp, dateKey) } : {}),
                  style,
                  title: pendingSwapWith ? `ມື້ສະຫຼັບຕຳແໜ່ງ — ຈະສະຫຼັບກັບ "${pendingSwapWith}" ມື້ນີ້` : undefined,
                };
              }}
              render={(_, emp: Employee) => {
                const row = byEmpDate[`${emp._id}_${dateKey}`];
                // A lone late-arriving scan can land as lastOut with no
                // firstIn at all now (see attendanceProcessor.js's
                // shift-midpoint check) — show that one time too instead of
                // silently dropping it just because it's not firstIn.
                const timeText = (r: AttendanceDaily) =>
                  r.firstIn
                    ? `${dayjs(r.firstIn).format('HH:mm')}${r.lastOut ? `-${dayjs(r.lastOut).format('HH:mm')}` : ''}`
                    : r.lastOut
                      ? dayjs(r.lastOut).format('HH:mm')
                      : '';

                const style = row ? CELL_STYLE[row.status] : undefined;
                if (style) {
                  const time = timeText(row!);
                  const label =
                    row!.status === 'late'
                      ? lateLabel(row!.lateMinutes, row!.graceMinutes, row!.severeLateMinutes)
                      : row!.status === 'absent'
                        ? `${style.label} (${absentSeverity(emp, day)})${row!.disciplinaryNote ? ' ⚠' : ''}`
                        : `${style.label}${row!.autoFilledReason ? ' ↺' : ''}`;
                  const cellTitle = row!.disciplinaryNote
                    ? `ລົງໂທດ: ${row!.disciplinaryNote}`
                    : row!.autoFilledReason
                      ? `ລົງເວລາຍ້ອນຫຼັງ: ${row!.autoFilledReason}`
                      : undefined;
                  return (
                    <div
                      title={cellTitle}
                      style={{ background: style.bg, color: style.text, borderRadius: 4, padding: '2px 4px', textAlign: 'center', lineHeight: 1.3 }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 500 }}>{label}</div>
                      {time && <div style={{ fontSize: 11 }}>{time}</div>}
                    </div>
                  );
                }
                if (row?.firstIn) {
                  return <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{timeText(row)}</span>;
                }
                // No AttendanceDaily row at all — a real queued shift always
                // wins first (that's what a swap/stand-in override means, even
                // on what's otherwise this employee's day off), shown plain
                // since nothing has actually been scanned against it yet.
                // Otherwise check for a real "rest" Shift override (a company
                // holiday shows its occasion name; a personal one-off rest day
                // just shows "ພັກ"), then finally the recurring weekly day off.
                const queuedShift = scheduledByEmpDate[`${emp._id}_${dateKey}`];
                if (queuedShift) {
                  return (
                    <span style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'nowrap' }}>
                      {queuedShift.startTime}-{queuedShift.endTime}
                    </span>
                  );
                }
                const swappedShift = swappedByEmpDate[`${emp._id}_${dateKey}`];
                if (swappedShift) {
                  const swapped = CELL_STYLE.swapped;
                  return (
                    <div style={{ background: swapped.bg, color: swapped.text, borderRadius: 4, padding: '2px 4px', textAlign: 'center', fontSize: 11, fontWeight: 500 }}>
                      {swapped.label}
                    </div>
                  );
                }
                const restShift = restByEmpDate[`${emp._id}_${dateKey}`];
                if (restShift) {
                  const holiday = restShift.holiday;
                  const isHoliday = holiday && typeof holiday === 'object';
                  const rest = CELL_STYLE.rest;
                  return (
                    <div
                      title={isHoliday ? holiday.name : undefined}
                      style={{ background: rest.bg, color: rest.text, borderRadius: 4, padding: '2px 4px', textAlign: 'center', fontSize: 11, fontWeight: 500 }}
                    >
                      {isHoliday ? 'ຮ້ານປິດ' : rest.label}
                    </div>
                  );
                }
                if ((emp.defaultRestDay ?? []).includes(day.day())) {
                  const rest = CELL_STYLE.rest;
                  return (
                    <div style={{ background: rest.bg, color: rest.text, borderRadius: 4, padding: '2px 4px', textAlign: 'center', fontSize: 11, fontWeight: 500 }}>
                      {rest.label}
                    </div>
                  );
                }
                return <span style={{ color: '#bfbfbf' }}>-</span>;
              }}
            />
          );
        })}
      </Table>

      <Modal
        title={
          editing
            ? `ແກ້ໄຂການສະແກນ - ${editing.employee.firstName ?? ''} ${editing.employee.lastName ?? ''} (${dayjs(editing.dateKey).format('DD/MM/YYYY')})`
            : ''
        }
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={submitFix}>
          <Form.Item label="ເວລາເຂົ້າ" name="checkIn" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາເຂົ້າ' }]}>
            <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} />
          </Form.Item>
          <Form.Item label="ເວລາອອກ (ຖ້າມີ)" name="checkOut">
            <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} />
          </Form.Item>
          <Form.Item label="ໝາຍເຫດ / ຫຼັກຖານ" name="note">
            <Input.TextArea rows={2} placeholder="ເຫດຜົນ ຫຼື ຫຼັກຖານທີ່ພະນັກງານມີ" />
          </Form.Item>
        </Form>

        <Divider />

        {isDisciplinaryAbsent ? (
          <div>
            <Typography.Paragraph type="danger" strong style={{ marginBottom: 4 }}>
              ມື້ນີ້ຖືກບັນທຶກເປັນຂາດວຽກແບບລົງໂທດ
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              ເຫດຜົນ: {editingRow?.disciplinaryNote}
            </Typography.Paragraph>
            <Popconfirm
              title="ຍົກເລີກການລົງໂທດນີ້?"
              description="ມື້ນີ້ຈະກັບໄປວ່າງເປົ່າ — ບໍ່ແມ່ນການສະແກນເດີມ ເພາະຖືກລຶບໄປຕອນລົງໂທດແລ້ວ"
              okText="ຍົກເລີກການລົງໂທດ"
              cancelText="ບໍ່"
              onConfirm={cancelMarkAbsent}
            >
              <Button danger loading={markingAbsent}>
                ຍົກເລີກການລົງໂທດ
              </Button>
            </Popconfirm>
          </div>
        ) : (
          <div>
            <Typography.Paragraph strong style={{ marginBottom: 4 }}>
              ລົງໂທດໃຫ້ເປັນຂາດວຽກ
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
              ໃຊ້ເມື່ອພະນັກງານມາເຮັດວຽກຕາມປົກກະຕິ ແຕ່ຖືກລົງໂທດໃຫ້ນັບເປັນຂາດວຽກ — ຈະລຶບການສະແກນເດີມຂອງມື້ນີ້ອອກ
            </Typography.Paragraph>
            <Input.TextArea
              rows={2}
              placeholder="ເຫດຜົນທີ່ລົງໂທດ (ບັງຄັບ)"
              value={disciplineReason}
              onChange={(e) => setDisciplineReason(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <Popconfirm
              title="ບັນທຶກເປັນຂາດວຽກ?"
              description="ການສະແກນເດີມຂອງມື້ນີ້ຈະຖືກລຶບ ແລະ ນັບເປັນຂາດວຽກແທນ"
              okText="ຢືນຢັນ"
              cancelText="ບໍ່"
              onConfirm={submitMarkAbsent}
              disabled={!disciplineReason.trim()}
            >
              <Button danger loading={markingAbsent} disabled={!disciplineReason.trim()}>
                ບັນທຶກເປັນຂາດວຽກ (ລົງໂທດ)
              </Button>
            </Popconfirm>
          </div>
        )}
      </Modal>

      <Modal
        title="ລົງເວລາຍ້ອນຫຼັງ (ລະບົບສະແກນເສຍ)"
        open={outageOpen}
        onCancel={() => setOutageOpen(false)}
        footer={
          <Popconfirm
            title="ລົງເວລາໃຫ້ທຸກຄົນໃນຊ່ວງນີ້?"
            description="ຈະລົງເວລາຕາມກະປົກກະຕິໃຫ້ທຸກຄົນທີ່ຍັງບໍ່ມີຂໍ້ມູນມື້ນັ້ນ — ຂ້າມຄົນທີ່ລາອະນຸມັດແລ້ວ ຫຼື ເປັນວັນພັກຂອງເຂົາຢູ່ແລ້ວ"
            okText="ຢືນຢັນ"
            cancelText="ບໍ່"
            onConfirm={submitOutageFill}
            disabled={!outageRange || !outageReason.trim()}
          >
            <Button type="primary" danger loading={outageSubmitting} disabled={!outageRange || !outageReason.trim()}>
              ລົງເວລາໃຫ້ທຸກຄົນ
            </Button>
          </Popconfirm>
        }
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ໃຊ້ເມື່ອເຄື່ອງສະແກນ ຫຼື ລະບົບໃຊ້ບໍ່ໄດ້ຊົ່ວໄລຍະໜຶ່ງ (ໄຟດັບ, server ພັງ ...) — ຈະດຶງກະປະຈຳຂອງແຕ່ລະຄົນມາລົງເປັນເວລາເຂົ້າ-ອອກໃຫ້ອັດຕະໂນມັດ
          ນັບເປັນມາເຮັດວຽກປົກກະຕິ ບໍ່ແມ່ນຂາດວຽກ. ຄົນທີ່ມີຂໍ້ມູນມື້ນັ້ນຢູ່ແລ້ວ, ລາອະນຸມັດແລ້ວ, ຫຼື ເປັນວັນພັກຂອງເຂົາ ຈະຖືກຂ້າມໄປ ບໍ່ແຕະຕ້ອງ.
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="ຊ່ວງວັນທີ່" required>
            <RangePicker
              style={{ width: '100%' }}
              value={outageRange}
              onChange={(v) => v && v[0] && v[1] && setOutageRange([v[0], v[1]])}
              format="DD/MM/YYYY"
            />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" required>
            <Input.TextArea
              rows={2}
              placeholder="ຕົວຢ່າງ: Server ພັງ 12-14 ຕຸລາ 2026, ເຄື່ອງສະແກນໃຊ້ບໍ່ໄດ້"
              value={outageReason}
              onChange={(e) => setOutageReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export const AttendanceLogsPage: React.FC = () => {
  return (
    <List title="ປະຫວັດການສະແກນເຂົ້າ-ອອກວຽກ" breadcrumb={false}>
      <AttendanceSummaryGrid />
    </List>
  );
};
