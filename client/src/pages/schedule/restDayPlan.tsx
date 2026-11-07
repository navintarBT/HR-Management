import { useEffect, useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useNotification, useWarnAboutChange } from '@refinedev/core';
import { Table, Select, Input, Space, Typography, Tag, Button, Checkbox } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Department, Employee, Position } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { effectiveRestrictedRestDays, firstMondayOfMonthAfter, mondayOptionLabel, upcomingMondays } from '../../utils/restDays';
import { restDaysLabel, sameDays, useRestDayPlanReview, useRestDayPlanSchedule } from './restDayPlanShared';

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// ວາງແຜນວັນພັກ — HR sets the coming month's recurring rest days for many
// people at once, all starting on one Monday (by default the first Monday of
// the next month), so every Monday-to-Sunday week rests on one pattern and
// none gets two rest days. Each row starts from what's already set for that
// Monday — a change waiting on it, else what they rest on just before it —
// and only rows changed here are sent. The server checks them all before
// saving any (routes/restDayHistory.js planMany); days before the Monday
// keep the rest day they had.
export const RestDayPlanPage: React.FC = () => {
  const [start, setStart] = useState(() => firstMondayOfMonthAfter(dayjs()).format('YYYY-MM-DD'));
  // employee id → the days picked here.
  const [edits, setEdits] = useState<Record<string, number[]>>({});
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDays, setBulkDays] = useState<number[]>([]);
  const { open: notify } = useNotification();

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

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = useMemo(() => employeesData?.data ?? [], [employeesData?.data]);

  // Just the changes around the Monday.
  const { rowsByEmployee, isLoading: scheduleLoading, refetch: refetchSchedule, beforeOf, waitingOf, plannedOf } = useRestDayPlanSchedule(start);
  const pickedOf = (emp: Employee) => edits[emp._id] ?? plannedOf(emp);
  const isChanged = (emp: Employee) => !!edits[emp._id] && !sameDays(edits[emp._id], plannedOf(emp));

  const changedEmployees = employees.filter(isChanged);
  const { setWarnWhen } = useWarnAboutChange();
  useEffect(() => {
    setWarnWhen(changedEmployees.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedEmployees.length]);

  const setPicked = (emp: Employee, days: number[]) =>
    setEdits((prev) => {
      const next = { ...prev };
      if (sameDays(days, plannedOf(emp))) delete next[emp._id];
      else next[emp._id] = days;
      return next;
    });

  const applyToSelected = () => {
    const chosen = employees.filter((emp) => selectedIds.includes(emp._id));
    setEdits((prev) => {
      const next = { ...prev };
      for (const emp of chosen) {
        if (sameDays(bulkDays, plannedOf(emp))) delete next[emp._id];
        else next[emp._id] = bulkDays;
      }
      return next;
    });
    const blocked = chosen.filter((emp) => bulkDays.some((d) => effectiveRestrictedRestDays(emp).includes(d))).length;
    notify?.({
      type: 'success',
      message: `ຕັ້ງ ${restDaysLabel(bulkDays)} ໃຫ້ ${chosen.length} ຄົນແລ້ວ (ຍັງບໍ່ໄດ້ບັນທຶກ)${
        blocked ? ` — ${blocked} ຄົນຢູ່ໃນຕຳແໜ່ງທີ່ຫ້າມພັກວັນນີ້, ກວດເບິ່ງຕອນບັນທຶກ` : ''
      }`,
    });
  };

  const shownEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (onlyChanged && !isChanged(emp)) return false;
      if (departmentFilter && idOf(emp.department) !== departmentFilter) return false;
      if (positionFilter && idOf(emp.position) !== positionFilter) return false;
      if (q) {
        const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.toLowerCase();
        if (!name.includes(q) && !(emp.employeeCode ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, edits, onlyChanged, departmentFilter, positionFilter, search, rowsByEmployee, start]);

  const changes = changedEmployees.map((emp) => ({ employee: emp._id, restDays: edits[emp._id] }));

  const { checkPlan, checking, reviewModal } = useRestDayPlanReview(start, () => {
    setEdits({});
    setSelectedIds([]);
    setBulkDays([]);
    refetchSchedule();
  });

  const mondayOptions = useMemo(
    () => upcomingMondays(dayjs()).map((monday) => ({ value: monday.format('YYYY-MM-DD'), label: mondayOptionLabel(monday) })),
    []
  );
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ວາງແຜນວັນພັກ"
      breadcrumb={false}
      headerButtons={
        <Space>
          <Button disabled={!changedEmployees.length} onClick={() => setEdits({})}>
            ລ້າງການແກ້ໄຂ
          </Button>
          <Button type="primary" disabled={!changedEmployees.length} loading={checking} onClick={() => checkPlan(changes)}>
            ກວດ ແລະ ບັນທຶກ ({changedEmployees.length} ຄົນ)
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        ຕັ້ງວັນພັກປະຈຳອາທິດຂອງເດືອນໃໝ່ໄວ້ລ່ວງໜ້າໃຫ້ຫຼາຍຄົນພ້ອມກັນ — ມີຜົນແຕ່ວັນຈັນທີ່ເລືອກ ແຕ່ລະອາທິດຈຶ່ງພັກຕາມແບບດຽວກັນທັງອາທິດ ບໍ່ມີອາທິດທີ່ພັກ 2
        ເທື່ອ. ມື້ກ່ອນວັນຈັນນັ້ນຍັງຄືເກົ່າ ແລະ ຍົກເລີກໄດ້ກ່ອນມີຜົນ (ປະຫວັດປ່ຽນວັນພັກ)
      </Typography.Paragraph>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Typography.Text strong>ມີຜົນແຕ່</Typography.Text>
          <Select style={{ width: 300 }} options={mondayOptions} value={start} onChange={(v: string) => setStart(v)} />
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
              const stillValid =
                !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some((d) => idOf(d) === v);
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
          <Checkbox checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)}>
            ສະເພາະທີ່ແກ້ໄຂ
          </Checkbox>
        </Space>
        <Space wrap style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {selectedIds.length ? `ເລືອກແລ້ວ ${selectedIds.length} ຄົນ — ຕັ້ງວັນພັກ:` : 'ຕິກເລືອກຫຼາຍຄົນ ເພື່ອຕັ້ງວັນພັກດຽວກັນໃຫ້ພ້ອມກັນ'}
          </Typography.Text>
          <Select
            mode="multiple"
            style={{ minWidth: 200 }}
            options={WEEKDAY_OPTIONS}
            placeholder="ເລືອກວັນ"
            disabled={!selectedIds.length}
            value={bulkDays}
            onChange={(v: number[]) => setBulkDays(v)}
          />
          <Button disabled={!selectedIds.length || !bulkDays.length} onClick={applyToSelected}>
            ໃຊ້ກັບທີ່ເລືອກ
          </Button>
        </Space>
      </div>

      <Table
        rowKey="_id"
        dataSource={shownEmployees}
        loading={employeesLoading || scheduleLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
      >
        <Table.Column title="ລະຫັດ" dataIndex="employeeCode" width={90} />
        <Table.Column title="ຊື່ພະນັກງານ" width={180} render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`} />
        <Table.Column
          title="ພະແນກ / ຕຳແໜ່ງ"
          width={200}
          render={(_, emp: Employee) =>
            [typeof emp.department === 'object' ? emp.department?.name : undefined, typeof emp.position === 'object' ? emp.position?.name : undefined]
              .filter(Boolean)
              .join(' / ') || '-'
          }
        />
        <Table.Column
          title={`ວັນພັກກ່ອນ ${dayjs(start).format('DD/MM')}`}
          width={130}
          render={(_, emp: Employee) => restDaysLabel(beforeOf(emp))}
        />
        <Table.Column
          title={`ວັນພັກແຕ່ ${dayjs(start).format('DD/MM')}`}
          width={240}
          render={(_, emp: Employee) => {
            const restricted = effectiveRestrictedRestDays(emp);
            return (
              <Select
                mode="multiple"
                size="small"
                style={{ width: '100%' }}
                placeholder="ບໍ່ມີວັນພັກປະຈຳ"
                options={WEEKDAY_OPTIONS.map((o) => ({ ...o, disabled: restricted.includes(o.value) }))}
                value={pickedOf(emp)}
                onChange={(v: number[]) => setPicked(emp, v)}
              />
            );
          }}
        />
        <Table.Column
          title="ສະຖານະ"
          width={140}
          render={(_, emp: Employee) => {
            const waiting = waitingOf(emp);
            if (isChanged(emp)) {
              return waiting && sameDays(edits[emp._id], beforeOf(emp)) ? <Tag color="orange">ຍົກເລີກແຜນເດີມ</Tag> : <Tag color="blue">ຈະປ່ຽນ</Tag>;
            }
            return waiting ? <Tag color="purple">ວາງແຜນໄວ້ແລ້ວ</Tag> : null;
          }}
        />
      </Table>

      {reviewModal}
    </List>
  );
};
