import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useUpdate, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Switch, Select, Input, Space, Typography, Popconfirm } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Position } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// One place to manage the whole "ມາແທນ" rule (see attendance/logs.tsx and
// attendanceProcessor.js's resolveExpectedStart) instead of hunting through
// each position's edit modal and each employee's edit page separately.
const PositionRuleTable: React.FC<{ employeesByPosition: Record<string, number> }> = ({ employeesByPosition }) => {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { data: positionsData, isLoading, refetch } = useList<Position>({
    resource: 'positions',
    pagination: { pageSize: 500 },
    sorters: [{ field: 'name', order: 'asc' }],
  });
  const allPositions = positionsData?.data ?? [];

  // Same reasoning as the employee table below — there are 50+ positions,
  // too many to dump unfiltered by default. Without a filter, still show
  // whichever positions already have the rule on, so it stays visible at a
  // glance instead of disappearing the moment the filter is cleared.
  const hasFilter = !!(search || departmentFilter);

  const positions = useMemo(() => {
    if (!hasFilter) return allPositions.filter((p) => p.allowsSubstituteStatus);
    return allPositions.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (departmentFilter && !(p.departments ?? []).some((d) => idOf(d) === departmentFilter)) return false;
      return true;
    });
  }, [allPositions, hasFilter, search, departmentFilter]);

  const { mutate: updatePosition } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const setAllowed = (position: Position, allowed: boolean) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { allowsSubstituteStatus: allowed } },
      {
        onSuccess: () => {
          notify?.({
            type: 'success',
            message: allowed
              ? `ເປີດໃຊ້ໃຫ້ຕຳແໜ່ງ "${position.name}" ແລ້ວ — ລ້າງເວລາເຂົ້າວຽກຂອງທຸກຄົນໃນຕຳແໜ່ງນີ້ໃຫ້ອັດຕະໂນມັດ`
              : `ປິດໃຊ້ໃຫ້ຕຳແໜ່ງ "${position.name}" ແລ້ວ — ຄືນເວລາເຂົ້າວຽກເດີມໃຫ້ທຸກຄົນທີ່ໃຊ້ຄ່າຈາກຕຳແໜ່ງນີ້`,
          });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          {...departmentSelect}
          placeholder="ກອງຕາມພະແນກ"
          allowClear
          style={{ width: 200 }}
          value={departmentFilter}
          onChange={(v: any) => setDepartmentFilter(v)}
        />
        <Input.Search
          placeholder="ຄົ້ນຫາຊື່ຕຳແໜ່ງ"
          allowClear
          style={{ width: 220 }}
          prefix={<SearchOutlined />}
          onSearch={(v) => setSearch(v)}
          onChange={(e) => !e.target.value && setSearch('')}
        />
      </Space>
      <Table
        dataSource={positions}
        rowKey="_id"
        loading={isLoading}
        pagination={false}
        size="small"
        locale={{
          emptyText: hasFilter ? 'ບໍ່ພົບຕຳແໜ່ງ' : 'ຍັງບໍ່ມີຕຳແໜ່ງໃດເປີດໃຊ້ກົດນີ້ — ຄົ້ນຫາ ຫຼື ເລືອກຕົວກອງ ເພື່ອຫາຕຳແໜ່ງອື່ນ',
        }}
      >
        <Table.Column title="ຕຳແໜ່ງ" dataIndex="name" width={220} />
        <Table.Column
          title="ຈຳນວນພະນັກງານ"
          width={130}
          render={(_, position: Position) => employeesByPosition[position._id] ?? 0}
        />
        <Table.Column
          title={
            <span>
              ອະນຸຍາດສະຖານະ ມາແທນ (ໃຊ້ກັບທຸກຄົນໃນຕຳແໜ່ງນີ້)
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 'normal' }}>
                ສຳລັບຕຳແໜ່ງທີ່ມີຄົນອື່ນມາແທນແທນທີ່ຈະຂາດງານ
              </Typography.Text>
            </span>
          }
          width={260}
          render={(_, position: Position) =>
            position.allowsSubstituteStatus ? (
              <Popconfirm title={`ປິດໃຊ້ໃຫ້ "${position.name}"?`} onConfirm={() => setAllowed(position, false)}>
                <Switch checked />
              </Popconfirm>
            ) : (
              <Popconfirm
                title={`ເປີດໃຊ້ໃຫ້ "${position.name}"?`}
                description="ຈະລ້າງເວລາເຂົ້າວຽກຂອງທຸກຄົນໃນຕຳແໜ່ງນີ້ໃຫ້ອັດຕະໂນມັດ"
                onConfirm={() => setAllowed(position, true)}
              >
                <Switch checked={false} />
              </Popconfirm>
            )
          }
        />
      </Table>
    </div>
  );
};

const EmployeeRuleTable: React.FC = () => {
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

  const { data: employeesData, isLoading, refetch } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  // 190+ active employees is too much to dump unfiltered — require at least
  // one filter before showing any rows. Anyone with an individual override
  // already set (allowed or explicitly disallowed) stays visible regardless,
  // same as the position table, so it doesn't vanish the moment filters clear.
  const hasFilter = !!(search || departmentFilter || positionFilter);

  const employees = useMemo(() => {
    if (!hasFilter) return allEmployees.filter((e) => e.allowsSubstituteStatus != null);
    return allEmployees.filter((e) => {
      if (search) {
        const q = search.trim().toLowerCase();
        const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.toLowerCase();
        const code = (e.employeeCode ?? '').toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (departmentFilter && idOf(e.department) !== departmentFilter) return false;
      if (positionFilter && idOf(e.position) !== positionFilter) return false;
      return true;
    });
  }, [allEmployees, hasFilter, search, departmentFilter, positionFilter]);

  const { mutate: updateEmployee } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  // Only reached for "ບໍ່ອະນຸຍາດ" or clearing back to "ໃຊ້ຄ່າຈາກຕຳແໜ່ງ" — turning
  // it ON goes through a separate branch below since that one also clears the
  // employee's shift time and deserves its own confirmation message.
  const setOverride = (employee: Employee, value: boolean | null) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { allowsSubstituteStatus: value } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
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
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
        locale={{
          emptyText: hasFilter ? 'ບໍ່ພົບພະນັກງານ' : 'ຍັງບໍ່ມີໃຜຕັ້ງພິເສດສະເພາະຄົນ — ຄົ້ນຫາ ຫຼື ເລືອກຕົວກອງ ເພື່ອຫາພະນັກງານອື່ນ',
        }}
      >
        <Table.Column title="ລະຫັດ" width={90} dataIndex="employeeCode" />
        <Table.Column title="ຊື່" width={180} render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`} />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຄ່າຈາກຕຳແໜ່ງ"
          width={110}
          render={(_, emp: Employee) => {
            const posAllows = typeof emp.position === 'object' ? emp.position?.allowsSubstituteStatus : false;
            return <Typography.Text type="secondary">{posAllows ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'}</Typography.Text>;
          }}
        />
        <Table.Column
          title="ຕັ້ງພິເສດສະເພາະຄົນ"
          width={220}
          render={(_, emp: Employee) => (
            <Select
              size="small"
              style={{ width: 200 }}
              allowClear
              placeholder="ໃຊ້ຄ່າຈາກຕຳແໜ່ງ"
              value={emp.allowsSubstituteStatus ?? undefined}
              options={[
                { label: 'ອະນຸຍາດ', value: true },
                { label: 'ບໍ່ອະນຸຍາດ', value: false },
              ]}
              onChange={(v) => {
                if (v === true) {
                  updateEmployee(
                    { resource: 'employees', id: emp._id, values: { allowsSubstituteStatus: true } },
                    {
                      onSuccess: () => {
                        notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ — ລ້າງເວລາເຂົ້າວຽກຂອງຄົນນີ້ໃຫ້ອັດຕະໂນມັດ' });
                        invalidate({ resource: 'employees', invalidates: ['list'] });
                        refetch();
                      },
                    }
                  );
                  return;
                }
                setOverride(emp, v === undefined ? null : v);
              }}
            />
          )}
        />
        <Table.Column
          title="ຄ່າທີ່ໃຊ້ຈິງ"
          width={110}
          render={(_, emp: Employee) => {
            const posAllows = typeof emp.position === 'object' ? emp.position?.allowsSubstituteStatus : false;
            const effective = emp.allowsSubstituteStatus ?? posAllows;
            return (
              <Typography.Text strong type={effective ? 'success' : undefined}>
                {effective ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'}
              </Typography.Text>
            );
          }}
        />
      </Table>
    </div>
  );
};

// Blocks a position from EVER letting someone choose one of these days as
// their rest day (recurring default, or a one-off planned pick) — for roles
// that can't be short-staffed on the business's busiest days. Sick leave and
// company-wide holiday closures are separate workflows and are never
// affected by this (see server/src/utils/restDayRules.js).
const RestDayRuleTable: React.FC<{ employeesByPosition: Record<string, number> }> = ({ employeesByPosition }) => {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { data: positionsData, isLoading, refetch } = useList<Position>({
    resource: 'positions',
    pagination: { pageSize: 500 },
    sorters: [{ field: 'name', order: 'asc' }],
  });
  const allPositions = positionsData?.data ?? [];

  const hasFilter = !!(search || departmentFilter);
  const positions = useMemo(() => {
    if (!hasFilter) return allPositions.filter((p) => (p.restrictedRestDays ?? []).length > 0);
    return allPositions.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (departmentFilter && !(p.departments ?? []).some((d) => idOf(d) === departmentFilter)) return false;
      return true;
    });
  }, [allPositions, hasFilter, search, departmentFilter]);

  const { mutate: updatePosition } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const setRestrictedDays = (position: Position, days: number[]) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { restrictedRestDays: days } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກຂໍ້ຈຳກັດວັນພັກຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          {...departmentSelect}
          placeholder="ກອງຕາມພະແນກ"
          allowClear
          style={{ width: 200 }}
          value={departmentFilter}
          onChange={(v: any) => setDepartmentFilter(v)}
        />
        <Input.Search
          placeholder="ຄົ້ນຫາຊື່ຕຳແໜ່ງ"
          allowClear
          style={{ width: 220 }}
          prefix={<SearchOutlined />}
          onSearch={(v) => setSearch(v)}
          onChange={(e) => !e.target.value && setSearch('')}
        />
      </Space>
      <Table
        dataSource={positions}
        rowKey="_id"
        loading={isLoading}
        pagination={false}
        size="small"
        locale={{
          emptyText: hasFilter ? 'ບໍ່ພົບຕຳແໜ່ງ' : 'ຍັງບໍ່ມີຕຳແໜ່ງໃດຕັ້ງຂໍ້ຈຳກັດ — ຄົ້ນຫາ ຫຼື ເລືອກຕົວກອງ ເພື່ອຫາຕຳແໜ່ງອື່ນ',
        }}
      >
        <Table.Column title="ຕຳແໜ່ງ" dataIndex="name" width={220} />
        <Table.Column
          title="ຈຳນວນພະນັກງານ"
          width={130}
          render={(_, position: Position) => employeesByPosition[position._id] ?? 0}
        />
        <Table.Column
          title="ວັນທີ່ຫ້າມພັກ"
          render={(_, position: Position) => (
            <Select
              mode="multiple"
              style={{ width: '100%', minWidth: 280 }}
              placeholder="ບໍ່ມີຂໍ້ຈຳກັດ — ເລືອກວັນທີ່ຫ້າມພັກ"
              options={WEEKDAY_OPTIONS}
              value={position.restrictedRestDays ?? []}
              onChange={(days: number[]) => setRestrictedDays(position, days)}
            />
          )}
        />
      </Table>
    </div>
  );
};

export const SubstituteRulePage: React.FC = () => {
  const { data: employeesData } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
  });
  const employeesByPosition = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employeesData?.data ?? []) {
      const posId = idOf(e.position);
      if (!posId) continue;
      map[posId] = (map[posId] ?? 0) + 1;
    }
    return map;
  }, [employeesData?.data]);

  return (
    <List title="ຕັ້ງຄ່າກົດຂອງຕຳແໜ່ງ" breadcrumb={false}>
      <Typography.Title level={5}>ກົດ "ມາແທນ"</Typography.Title>
      <Typography.Paragraph type="secondary">
        ຄົນທີ່ເປີດໃຊ້ກົດນີ້ (ຈາກຕຳແໜ່ງ ຫຼື ຕັ້ງພິເສດເປັນລາຍບຸກຄົນ) ຈະບໍ່ຖືກຕັດສິນວ່າມາຊ້າ/ຂາດງານຈາກເວລາສະແກນ ແລະ ສາມາດໃຊ້ສະຖານະ
        "ມາແທນ" ໃນຕາຕະລາງ ປະຫວັດການສະແກນ ໄດ້ — ການເປີດໃຊ້ຈະລ້າງເວລາເຂົ້າວຽກປົກກະຕິຂອງຄົນນັ້ນອອກໃຫ້ອັດຕະໂນມັດ
      </Typography.Paragraph>

      <Typography.Title level={5} style={{ marginTop: 8 }}>
        1. ຕັ້ງຄ່າຕາມຕຳແໜ່ງ
      </Typography.Title>
      <PositionRuleTable employeesByPosition={employeesByPosition} />

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        2. ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ
      </Typography.Title>
      <EmployeeRuleTable />

      <Typography.Title level={5} style={{ marginTop: 40 }}>
        ຂໍ້ຈຳກັດວັນພັກ
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ຕຳແໜ່ງທີ່ຕັ້ງໄວ້ນີ້ ຈະຫ້າມທຸກຄົນໃນຕຳແໜ່ງນັ້ນເລືອກວັນທີ່ຫ້າມເປັນວັນພັກປະຈຳ ຫຼື ວັນພັກທີ່ຕັ້ງລ່ວງໜ້າ (ບໍ່ກະທົບການລາປ່ວຍ ຫຼື ວັນພັກຮ້ານທີ່ປິດທັງບໍລິສັດ)
      </Typography.Paragraph>
      <RestDayRuleTable employeesByPosition={employeesByPosition} />
    </List>
  );
};
