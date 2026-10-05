import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList } from '@refinedev/core';
import { Table, Select, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Department, Position, RestDayHistory } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

function weekdayLabel(day: number | null | undefined) {
  if (day == null) return 'ບໍ່ມີ';
  return WEEKDAY_OPTIONS.find((o) => o.value === day)?.label ?? '-';
}

// Read-only audit trail — rows are written server-side only, whenever
// Employee.defaultRestDay actually changes (see routes/employees.js). There's
// no history before this feature existed, since nothing was tracking it yet.
export const RestDayHistoryPage: React.FC = () => {
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

  const { data, isLoading } = useList<RestDayHistory>({
    resource: 'rest-day-history',
    pagination: { pageSize: 2000, mode: 'server' },
    sorters: [{ field: 'createdAt', order: 'desc' }],
  });
  const allRows = data?.data ?? [];

  const rows = useMemo(
    () =>
      allRows.filter((r) => {
        const emp = typeof r.employee === 'object' ? r.employee : undefined;
        if (!emp) return false;
        if (search) {
          const q = search.trim().toLowerCase();
          const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.toLowerCase();
          const code = (emp.employeeCode ?? '').toLowerCase();
          if (!name.includes(q) && !code.includes(q)) return false;
        }
        if (departmentFilter && idOf(emp.department) !== departmentFilter) return false;
        if (positionFilter && idOf(emp.position) !== positionFilter) return false;
        return true;
      }),
    [allRows, search, departmentFilter, positionFilter]
  );

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ປະຫວັດການປ່ຽນວັນພັກປະຈຳ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
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
        </Space>
      </div>

      <Table
        dataSource={rows}
        rowKey="_id"
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        locale={{ emptyText: 'ຍັງບໍ່ມີການປ່ຽນວັນພັກປະຈຳ' }}
      >
        <Table.Column title="ວັນທີ່ປ່ຽນ" width={150} render={(_, r: RestDayHistory) => dayjs(r.createdAt).format('DD/MM/YYYY HH:mm')} />
        <Table.Column
          title="ລະຫັດ"
          width={90}
          render={(_, r: RestDayHistory) => (typeof r.employee === 'object' ? r.employee?.employeeCode : undefined) || '-'}
        />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          width={180}
          render={(_, r: RestDayHistory) => {
            const emp = typeof r.employee === 'object' ? r.employee : undefined;
            return emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}` : '-';
          }}
        />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, r: RestDayHistory) => {
            const emp = typeof r.employee === 'object' ? r.employee : undefined;
            const dept = emp && typeof emp.department === 'object' ? emp.department : undefined;
            return dept?.name || '-';
          }}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, r: RestDayHistory) => {
            const emp = typeof r.employee === 'object' ? r.employee : undefined;
            const pos = emp && typeof emp.position === 'object' ? emp.position : undefined;
            return pos?.name || '-';
          }}
        />
        <Table.Column title="ວັນພັກເກົ່າ" width={130} render={(_, r: RestDayHistory) => weekdayLabel(r.previousRestDay)} />
        <Table.Column
          title="ວັນພັກໃໝ່"
          width={130}
          render={(_, r: RestDayHistory) => <Typography.Text strong>{weekdayLabel(r.newRestDay)}</Typography.Text>}
        />
        <Table.Column
          title="ຜູ້ແກ້ໄຂ"
          width={180}
          render={(_, r: RestDayHistory) => {
            const changer = typeof r.changedBy === 'object' ? r.changedBy : undefined;
            if (changer) return `${changer.firstName ?? ''} ${changer.lastName ?? ''}`;
            return r.changedByEmail || '-';
          }}
        />
      </Table>
    </List>
  );
};
