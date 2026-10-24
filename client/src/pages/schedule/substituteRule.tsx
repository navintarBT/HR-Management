import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useUpdate, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Switch, Select, Input, Space, Typography, Popconfirm, Button, Modal, Form } from 'antd';
import { SearchOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
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
        pagination={{ pageSize: 10 }}
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
                ສຳລັບຕຳແໜ່ງທີ່ມີຄົນອື່ນມາແທນແທນທີ່ຈະຂາດວຽກ
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
        pagination={{ pageSize: 10 }}
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
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, emp: Employee) =>
            emp.allowsSubstituteStatus == null ? null : (
              <Popconfirm
                title="ລຶບການຕັ້ງພິເສດນີ້?"
                description={`"${emp.firstName} ${emp.lastName}" ຈະກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ`}
                okText="ລຶບ"
                cancelText="ບໍ່"
                onConfirm={() => setOverride(emp, null)}
              >
                <Button danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            )
          }
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

  // Always only positions that already have restrictedRestDays set — the
  // department/name filters just narrow that set further, they never widen it
  // to unconfigured positions. Finding an unconfigured one to set up goes
  // through the "ສ້າງ" button instead, which has its own full position list.
  const positions = useMemo(() => {
    return allPositions.filter((p) => {
      if ((p.restrictedRestDays ?? []).length === 0) return false;
      if (search && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (departmentFilter && !(p.departments ?? []).some((d) => idOf(d) === departmentFilter)) return false;
      return true;
    });
  }, [allPositions, search, departmentFilter]);

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

  const setRestDayFallback = (position: Position, day: number | null) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { restDayFallback: day } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກວັນພັກສຳຮອງຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  // Clears both fields together — a position with restDayFallback but no
  // restrictedRestDays is a state nothing else in this file expects (every
  // read of restDayFallback here only happens once restrictedRestDays is
  // already non-empty), and the position then drops out of `positions`
  // above, reappearing in the "ສ້າງ" picker as unconfigured again.
  const removeRestriction = (position: Position) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { restrictedRestDays: [], restDayFallback: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບຂໍ້ຈຳກັດວັນພັກຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const watchedRestrictedDays: number[] = Form.useWatch('restrictedRestDays', createForm) ?? [];
  // Narrows the position picker inside the create modal only — separate from
  // the table's own department filter above.
  const [createDeptFilter, setCreateDeptFilter] = useState<string>();

  // The dedicated create flow only ever targets a position that has nothing
  // set yet — editing an already-configured one still goes through the
  // inline cells below, where restDayFallback is already there via the
  // merge in routes/positions.js's beforeUpdate.
  const uncreatedPositions = useMemo(
    () =>
      allPositions.filter(
        (p) =>
          (p.restrictedRestDays ?? []).length === 0 &&
          (!createDeptFilter || (p.departments ?? []).some((d) => idOf(d) === createDeptFilter))
      ),
    [allPositions, createDeptFilter]
  );

  const submitCreateRestriction = () => {
    createForm.validateFields().then((values) => {
      updatePosition(
        {
          resource: 'positions',
          id: values.position,
          values: { restrictedRestDays: values.restrictedRestDays, restDayFallback: values.restDayFallback },
        },
        {
          onSuccess: () => {
            notify?.({ type: 'success', message: 'ສ້າງຂໍ້ຈຳກັດວັນພັກແລ້ວ' });
            invalidate({ resource: 'positions', invalidates: ['list'] });
            refetch();
            setCreateOpen(false);
            createForm.resetFields();
            setCreateDeptFilter(undefined);
          },
        }
      );
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ຖ້າຕັ້ງ "ວັນພັກສຳຮອງ" ໄວ້ — ຄົນທີ່ຈະພັກຕົງກັບວັນທີ່ຫ້າມ ຈະຖືກເລື່ອນໄປພັກວັນສຳຮອງໃຫ້ອັດຕະໂນມັດ (ລວມທັງຕອນສະຫຼັບຕຳແໜ່ງເຂົ້າມາ) ແທນທີ່ຈະຂຶ້ນຄ້ານໃຫ້ໄປເລືອກວັນອື່ນເອງ
        </Typography.Paragraph>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          ສ້າງຂໍ້ຈຳກັດວັນພັກ
        </Button>
      </div>
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
        pagination={{ pageSize: 10 }}
        size="small"
        locale={{
          emptyText: 'ບໍ່ພົບຕຳແໜ່ງທີ່ຕັ້ງຂໍ້ຈຳກັດ — ໃຊ້ປຸ່ມ "ສ້າງຂໍ້ຈຳກັດວັນພັກ" ຂ້າງເທິງເພື່ອຕັ້ງໃຫ້ຕຳແໜ່ງອື່ນ',
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
          render={(_, position: Position) =>
            (position.restrictedRestDays ?? []).length === 0 ? (
              <Typography.Text type="secondary">ຍັງບໍ່ໄດ້ຕັ້ງ — ໃຊ້ປຸ່ມ "ສ້າງຂໍ້ຈຳກັດວັນພັກ" ຂ້າງເທິງ</Typography.Text>
            ) : (
              <Select
                mode="multiple"
                style={{ width: '100%', minWidth: 280 }}
                placeholder="ບໍ່ມີຂໍ້ຈຳກັດ — ເລືອກວັນທີ່ຫ້າມພັກ"
                options={WEEKDAY_OPTIONS}
                value={position.restrictedRestDays ?? []}
                onChange={(days: number[]) => setRestrictedDays(position, days)}
              />
            )
          }
        />
        <Table.Column
          title="ວັນພັກສຳຮອງ"
          render={(_, position: Position) =>
            (position.restrictedRestDays ?? []).length === 0 ? (
              <Typography.Text type="secondary">-</Typography.Text>
            ) : (
              <Select
                allowClear
                style={{ width: '100%', minWidth: 160 }}
                placeholder="ບໍ່ມີ — ຈະຂຶ້ນຄ້ານແທນ"
                options={WEEKDAY_OPTIONS.filter((opt) => !(position.restrictedRestDays ?? []).includes(opt.value))}
                value={position.restDayFallback ?? undefined}
                onChange={(day: number | undefined) => setRestDayFallback(position, day ?? null)}
              />
            )
          }
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, position: Position) => (
            <Popconfirm
              title="ລຶບຂໍ້ຈຳກັດວັນພັກນີ້?"
              description={`ຕຳແໜ່ງ "${position.name}" ຈະບໍ່ມີຂໍ້ຈຳກັດວັນພັກອີກຕໍ່ໄປ`}
              okText="ລຶບ"
              cancelText="ບໍ່"
              onConfirm={() => removeRestriction(position)}
            >
              <Button danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>
      <Modal
        title="ສ້າງຂໍ້ຈຳກັດວັນພັກ"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
          setCreateDeptFilter(undefined);
        }}
        onOk={submitCreateRestriction}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຕ້ອງເລືອກທັງວັນທີ່ຫ້າມພັກ ແລະ ວັນພັກສຳຮອງພ້ອມກັນ — ຈະບໍ່ມີຕຳແໜ່ງໃດຕັ້ງໄດ້ພຽງອັນດຽວ
        </Typography.Paragraph>
        <Space style={{ marginBottom: 12, width: '100%' }} direction="vertical" size={4}>
          <Typography.Text>ກອງຕາມພະແນກ (ບໍ່ບັງຄັບ)</Typography.Text>
          <Select
            {...departmentSelect}
            allowClear
            style={{ width: '100%' }}
            placeholder="ທຸກພະແນກ"
            value={createDeptFilter}
            onChange={(v: any) => {
              setCreateDeptFilter(v);
              createForm.setFieldValue('position', undefined);
            }}
          />
        </Space>
        <Form form={createForm} layout="vertical">
          <Form.Item name="position" label="ຕຳແໜ່ງ" rules={[{ required: true, message: 'ກະລຸນາເລືອກຕຳແໜ່ງ' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="ເລືອກຕຳແໜ່ງທີ່ຍັງບໍ່ໄດ້ຕັ້ງຂໍ້ຈຳກັດ"
              options={uncreatedPositions.map((p) => ({ value: p._id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item
            name="restrictedRestDays"
            label="ວັນທີ່ຫ້າມພັກ"
            rules={[{ required: true, type: 'array', min: 1, message: 'ກະລຸນາເລືອກຢ່າງໜ້ອຍ 1 ວັນ' }]}
          >
            <Select mode="multiple" placeholder="ເລືອກວັນທີ່ຫ້າມພັກ" options={WEEKDAY_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="restDayFallback"
            label="ວັນພັກສຳຮອງ"
            rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນພັກສຳຮອງ' }]}
          >
            <Select
              placeholder="ເລືອກວັນພັກສຳຮອງ"
              options={WEEKDAY_OPTIONS.filter((opt) => !watchedRestrictedDays.includes(opt.value))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

function weekdayNames(days: number[]): string {
  if (!days.length) return '-';
  return days
    .slice()
    .sort()
    .map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d))
    .join(', ');
}

// Individual override of RestDayRuleTable above — same "2. ຕັ້ງຄ່າສະເພາະ
// ລາຍບຸກຄົນ" pattern as EmployeeRuleTable does for the ມາບໍ່ປົກກະຕິ rule.
// Setting a non-empty day list here REPLACES the position's entirely for
// this one person (not merged) — see server/src/utils/restDayRules.js's
// mergeRestDayRule. No separate create flow: just filter/search to find the
// employee and set it inline, same as EmployeeRuleTable.
const EmployeeRestDayRuleTable: React.FC = () => {
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

  const hasFilter = !!(search || departmentFilter || positionFilter);
  const employees = useMemo(() => {
    if (!hasFilter) return allEmployees.filter((e) => (e.restrictedRestDays ?? []).length > 0);
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

  const setDays = (employee: Employee, days: number[]) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { restrictedRestDays: days } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກຂໍ້ຈຳກັດວັນພັກຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ` });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };
  const setFallback = (employee: Employee, day: number | null) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { restDayFallback: day } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກວັນພັກສຳຮອງຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ` });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };
  const clearOverride = (employee: Employee) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { restrictedRestDays: [], restDayFallback: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບການຕັ້ງພິເສດຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ — ກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ` });
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
        pagination={{ pageSize: 10 }}
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
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຄ່າຈາກຕຳແໜ່ງ"
          width={200}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            const days = position?.restrictedRestDays ?? [];
            return (
              <Typography.Text type="secondary">
                {days.length ? `${weekdayNames(days)} → ສຳຮອງ: ${position?.restDayFallback != null ? weekdayNames([position.restDayFallback]) : 'ບໍ່ມີ'}` : 'ບໍ່ມີຂໍ້ຈຳກັດ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ຕັ້ງພິເສດສະເພາະຄົນ"
          width={340}
          render={(_, emp: Employee) => (
            <Space>
              <Select
                mode="multiple"
                size="small"
                allowClear
                style={{ width: 200 }}
                placeholder="ໃຊ້ຄ່າຈາກຕຳແໜ່ງ"
                options={WEEKDAY_OPTIONS}
                value={emp.restrictedRestDays ?? []}
                onChange={(days: number[]) => setDays(emp, days)}
              />
              <Select
                size="small"
                allowClear
                style={{ width: 130 }}
                placeholder="ວັນສຳຮອງ"
                options={WEEKDAY_OPTIONS.filter((opt) => !(emp.restrictedRestDays ?? []).includes(opt.value))}
                value={emp.restDayFallback ?? undefined}
                onChange={(day: number | undefined) => setFallback(emp, day ?? null)}
              />
            </Space>
          )}
        />
        <Table.Column
          title="ຄ່າທີ່ໃຊ້ຈິງ"
          width={200}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            const effectiveDays = emp.restrictedRestDays?.length ? emp.restrictedRestDays : position?.restrictedRestDays ?? [];
            const effectiveFallback = emp.restDayFallback ?? position?.restDayFallback ?? null;
            return (
              <Typography.Text strong type={effectiveDays.length ? 'warning' : undefined}>
                {effectiveDays.length ? `${weekdayNames(effectiveDays)} → ສຳຮອງ: ${effectiveFallback != null ? weekdayNames([effectiveFallback]) : 'ບໍ່ມີ'}` : 'ບໍ່ມີຂໍ້ຈຳກັດ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, emp: Employee) =>
            (emp.restrictedRestDays ?? []).length === 0 && emp.restDayFallback == null ? null : (
              <Popconfirm
                title="ລຶບການຕັ້ງພິເສດນີ້?"
                description={`"${emp.firstName} ${emp.lastName}" ຈະກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ`}
                okText="ລຶບ"
                cancelText="ບໍ່"
                onConfirm={() => clearOverride(emp)}
              >
                <Button danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            )
          }
        />
      </Table>
    </div>
  );
};

// Days a position can never be absent on — distinct from RestDayRuleTable
// above: that one blocks CHOOSING the day off at all; this one does nothing
// if the day is already a rest day one way or another, and only matters for
// a day they were expected to work and didn't. An absence on one of these
// days is charged at the configured X1/X2/X3 tier, which folds straight into
// the same x1/x2/x3 columns ການລາ's own deductions use on ສະຫຼຸບເງິນເດືອນ —
// see payroll-summary/index.tsx.
const NoAbsenceRuleTable: React.FC<{ employeesByPosition: Record<string, number> }> = ({ employeesByPosition }) => {
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

  // Always only positions that already have noAbsenceDays set — ມື້ທຳມະດາ
  // (ordinaryAbsenceSeverity) is a fully separate rule now, with its own
  // table/create-flow below (OrdinaryAbsenceRuleTable), so it has no bearing
  // on whether a position shows up here.
  const positions = useMemo(() => {
    return allPositions.filter((p) => {
      if ((p.noAbsenceDays ?? []).length === 0) return false;
      if (search && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (departmentFilter && !(p.departments ?? []).some((d) => idOf(d) === departmentFilter)) return false;
      return true;
    });
  }, [allPositions, search, departmentFilter]);

  const { mutate: updatePosition } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const setNoAbsenceDays = (position: Position, days: number[]) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { noAbsenceDays: days } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກວັນຫ້າມຂາດຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const setNoAbsenceSeverity = (position: Position, severity: 'X2' | 'X3' | undefined) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { noAbsenceSeverity: severity ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກລະດັບການຕັດເງິນຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  // Clears both fields together so the position drops out of `positions`
  // below and reappears in the "ສ້າງ" picker (and, now, back in
  // RestDayRuleTable's own picker too, since that one excludes positions
  // configured here). Leaves ordinaryAbsenceSeverity alone — that's a fully
  // separate rule managed by OrdinaryAbsenceRuleTable below.
  const removeNoAbsence = (position: Position) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { noAbsenceDays: [], noAbsenceSeverity: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບວັນຫ້າມຂາດຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creatingMany, setCreatingMany] = useState(false);
  // Separate from the table's own department filter above — this one only
  // narrows the position picker inside the create modal (and what "ເລືອກທັງໝົດ"
  // selects), since picking among 50+ positions at once is the main reason
  // to open this modal in the first place.
  const [createDeptFilter, setCreateDeptFilter] = useState<string>();

  // Also excludes any position already configured in ຂໍ້ຈຳກັດວັນພັກ
  // (restrictedRestDays) — that's a separate rule type (blocks CHOOSING a rest
  // day on certain weekdays, vs. this one penalizing an ACTUAL absence), and
  // a position already under it shouldn't be offered here too.
  const uncreatedPositions = useMemo(
    () =>
      allPositions.filter(
        (p) =>
          (p.noAbsenceDays ?? []).length === 0 &&
          (p.restrictedRestDays ?? []).length === 0 &&
          (!createDeptFilter || (p.departments ?? []).some((d) => idOf(d) === createDeptFilter))
      ),
    [allPositions, createDeptFilter]
  );

  // Applying the same days+severity to every position at once (e.g. the
  // whole bar on New Year's Eve) one at a time would mean reopening this
  // modal 50+ times — the position field takes several, or all of them via
  // the "ເລືອກທັງໝົດ" shortcut, and this writes them all in one go.
  const submitCreateNoAbsence = async () => {
    const values = await createForm.validateFields();
    const positionIds: string[] = Array.isArray(values.position) ? values.position : [values.position];
    setCreatingMany(true);
    let succeeded = 0;
    for (const id of positionIds) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        updatePosition(
          { resource: 'positions', id, values: { noAbsenceDays: values.noAbsenceDays, noAbsenceSeverity: values.noAbsenceSeverity } },
          {
            onSuccess: () => {
              succeeded += 1;
              resolve();
            },
            onError: () => resolve(),
          }
        );
      });
    }
    setCreatingMany(false);
    notify?.({
      type: succeeded === positionIds.length ? 'success' : 'error',
      message: `ສ້າງວັນຫ້າມຂາດສຳເລັດ ${succeeded}/${positionIds.length} ຕຳແໜ່ງ`,
    });
    invalidate({ resource: 'positions', invalidates: ['list'] });
    refetch();
    setCreateOpen(false);
    createForm.resetFields();
    setCreateDeptFilter(undefined);
  };

  const SEVERITY_OPTIONS = [
    { label: 'X2', value: 'X2' },
    { label: 'X3', value: 'X3' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ຖ້າວັນນັ້ນເປັນວັນພັກປະຈຳ ຫຼື ຖືກຕັ້ງເປັນວັນພັກຢູ່ແລ້ວ ຈະຂ້າມໃຫ້ ບໍ່ຕັດເງິນ — ມີຜົນສະເພາະວັນທີ່ຄົນນັ້ນຄວນມາເຮັດວຽກແຕ່ຂາດຈິງເທົ່ານັ້ນ
        </Typography.Paragraph>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          ສ້າງວັນຫ້າມຂາດ
        </Button>
      </div>
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
        pagination={{ pageSize: 10 }}
        size="small"
        locale={{
          emptyText: 'ບໍ່ພົບຕຳແໜ່ງທີ່ຕັ້ງວັນຫ້າມຂາດ — ໃຊ້ປຸ່ມ "ສ້າງວັນຫ້າມຂາດ" ຂ້າງເທິງເພື່ອຕັ້ງໃຫ້ຕຳແໜ່ງອື່ນ',
        }}
      >
        <Table.Column title="ຕຳແໜ່ງ" dataIndex="name" width={220} />
        <Table.Column
          title="ຈຳນວນພະນັກງານ"
          width={130}
          render={(_, position: Position) => employeesByPosition[position._id] ?? 0}
        />
        <Table.Column
          title="ວັນຫ້າມຂາດ"
          render={(_, position: Position) =>
            (position.noAbsenceDays ?? []).length === 0 ? (
              <Typography.Text type="secondary">ຍັງບໍ່ໄດ້ຕັ້ງ — ໃຊ້ປຸ່ມ "ສ້າງວັນຫ້າມຂາດ" ຂ້າງເທິງ</Typography.Text>
            ) : (
              <Select
                mode="multiple"
                style={{ width: '100%', minWidth: 280 }}
                placeholder="ບໍ່ມີວັນຫ້າມຂາດ — ເລືອກວັນ"
                options={WEEKDAY_OPTIONS}
                value={position.noAbsenceDays ?? []}
                onChange={(days: number[]) => setNoAbsenceDays(position, days)}
              />
            )
          }
        />
        <Table.Column
          title="ລະດັບການຕັດເງິນ"
          render={(_, position: Position) =>
            (position.noAbsenceDays ?? []).length === 0 ? (
              <Typography.Text type="secondary">-</Typography.Text>
            ) : (
              <Select
                allowClear
                style={{ width: '100%', minWidth: 120 }}
                placeholder="ບໍ່ມີ — ຈະບໍ່ມີຜົນ"
                options={SEVERITY_OPTIONS}
                value={position.noAbsenceSeverity ?? undefined}
                onChange={(v: 'X2' | 'X3' | undefined) => setNoAbsenceSeverity(position, v)}
              />
            )
          }
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, position: Position) => (
            <Popconfirm
              title="ລຶບວັນຫ້າມຂາດນີ້?"
              description={`ຕຳແໜ່ງ "${position.name}" ຈະບໍ່ມີວັນຫ້າມຂາດອີກຕໍ່ໄປ`}
              okText="ລຶບ"
              cancelText="ບໍ່"
              onConfirm={() => removeNoAbsence(position)}
            >
              <Button danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>
      <Modal
        title="ສ້າງວັນຫ້າມຂາດ"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
          setCreateDeptFilter(undefined);
        }}
        onOk={submitCreateNoAbsence}
        confirmLoading={creatingMany}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຕ້ອງເລືອກທັງວັນຫ້າມຂາດ ແລະ ລະດັບການຕັດເງິນພ້ອມກັນ — ຈະບໍ່ມີຕຳແໜ່ງໃດຕັ້ງໄດ້ພຽງອັນດຽວ. ເລືອກໄດ້ຫຼາຍຕຳແໜ່ງພ້ອມກັນ ຫຼື ກົດ
          "ເລືອກທັງໝົດ" ເພື່ອໃຊ້ຄ່າດຽວກັນກັບທຸກຕຳແໜ່ງທີ່ຍັງບໍ່ໄດ້ຕັ້ງ (ກອງຕາມພະແນກກ່ອນໄດ້ ເພື່ອຈຳກັດໃຫ້ແຄບລົງ)
        </Typography.Paragraph>
        <Space style={{ marginBottom: 12, width: '100%' }} direction="vertical" size={4}>
          <Typography.Text>ກອງຕາມພະແນກ (ບໍ່ບັງຄັບ)</Typography.Text>
          <Select
            {...departmentSelect}
            allowClear
            style={{ width: '100%' }}
            placeholder="ທຸກພະແນກ"
            value={createDeptFilter}
            onChange={(v: any) => {
              setCreateDeptFilter(v);
              createForm.setFieldValue('position', undefined);
            }}
          />
        </Space>
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="position"
            label={
              <Space>
                ຕຳແໜ່ງ
                <Button
                  size="small"
                  onClick={() => createForm.setFieldValue('position', uncreatedPositions.map((p) => p._id))}
                >
                  ເລືອກທັງໝົດ ({uncreatedPositions.length})
                </Button>
              </Space>
            }
            rules={[{ required: true, type: 'array', min: 1, message: 'ກະລຸນາເລືອກຕຳແໜ່ງຢ່າງໜ້ອຍ 1 ຕຳແໜ່ງ' }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="ເລືອກຕຳແໜ່ງທີ່ຍັງບໍ່ໄດ້ຕັ້ງວັນຫ້າມຂາດ (ເລືອກໄດ້ຫຼາຍຕຳແໜ່ງ)"
              options={uncreatedPositions.map((p) => ({ value: p._id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item
            name="noAbsenceDays"
            label="ວັນຫ້າມຂາດ"
            rules={[{ required: true, type: 'array', min: 1, message: 'ກະລຸນາເລືອກຢ່າງໜ້ອຍ 1 ວັນ' }]}
          >
            <Select mode="multiple" placeholder="ເລືອກວັນຫ້າມຂາດ" options={WEEKDAY_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="noAbsenceSeverity"
            label="ລະດັບການຕັດເງິນ"
            rules={[{ required: true, message: 'ກະລຸນາເລືອກລະດັບການຕັດເງິນ' }]}
          >
            <Select placeholder="ເລືອກລະດັບ" options={SEVERITY_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// ມື້ທຳມະດາ — fully separate from NoAbsenceRuleTable above, on its own table
// and its own "ຕັ້ງຄ່າ" flow, so a position can get this set regardless of
// whether it already has ຂໍ້ຈຳກັດວັນພັກ (restrictedRestDays) or a specific-day
// ວັນຫ້າມຂາດ rule — the two tables used to live as columns of one shared
// table, which made it unclear why some rows had blank ວັນຫ້າມຂາດ cells.
const OrdinaryAbsenceRuleTable: React.FC<{ employeesByPosition: Record<string, number> }> = ({ employeesByPosition }) => {
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

  const positions = useMemo(() => {
    return allPositions.filter((p) => {
      if (!p.ordinaryAbsenceSeverity) return false;
      if (search && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (departmentFilter && !(p.departments ?? []).some((d) => idOf(d) === departmentFilter)) return false;
      return true;
    });
  }, [allPositions, search, departmentFilter]);

  const { mutate: updatePosition } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const setSeverity = (position: Position, severity: 'X2' | 'X3' | undefined) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { ordinaryAbsenceSeverity: severity ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກລະດັບການຕັດເງິນສຳລັບມື້ທຳມະດາຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const removeSeverity = (position: Position) => {
    updatePosition(
      { resource: 'positions', id: position._id, values: { ordinaryAbsenceSeverity: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບລະດັບການຕັດເງິນສຳລັບມື້ທຳມະດາຂອງ "${position.name}" ແລ້ວ` });
          invalidate({ resource: 'positions', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creatingMany, setCreatingMany] = useState(false);
  const [createDeptFilter, setCreateDeptFilter] = useState<string>();

  // Unlike NoAbsenceRuleTable's own uncreatedPositions, this does NOT exclude
  // a position already in ຂໍ້ຈຳກັດວັນພັກ (restrictedRestDays) — ມື້ທຳມະດາ has
  // nothing to do with choosing specific no-absence days.
  const uncreatedPositions = useMemo(
    () =>
      allPositions.filter(
        (p) =>
          !p.ordinaryAbsenceSeverity &&
          (!createDeptFilter || (p.departments ?? []).some((d) => idOf(d) === createDeptFilter))
      ),
    [allPositions, createDeptFilter]
  );

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    const positionIds: string[] = Array.isArray(values.position) ? values.position : [values.position];
    setCreatingMany(true);
    let succeeded = 0;
    for (const id of positionIds) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        updatePosition(
          { resource: 'positions', id, values: { ordinaryAbsenceSeverity: values.ordinaryAbsenceSeverity } },
          {
            onSuccess: () => {
              succeeded += 1;
              resolve();
            },
            onError: () => resolve(),
          }
        );
      });
    }
    setCreatingMany(false);
    notify?.({
      type: succeeded === positionIds.length ? 'success' : 'error',
      message: `ຕັ້ງຄ່າມື້ທຳມະດາສຳເລັດ ${succeeded}/${positionIds.length} ຕຳແໜ່ງ`,
    });
    invalidate({ resource: 'positions', invalidates: ['list'] });
    refetch();
    setCreateOpen(false);
    createForm.resetFields();
    setCreateDeptFilter(undefined);
  };

  const SEVERITY_OPTIONS = [
    { label: 'X2', value: 'X2' },
    { label: 'X3', value: 'X3' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ແຍກອອກຈາກ ວັນຫ້າມຂາດ (ເຈາະຈົງວັນ) ຂ້າງເທິງ — ຕັ້ງໄດ້ເລີຍບໍ່ວ່າຕຳແໜ່ງນັ້ນຈະມີ ຂໍ້ຈຳກັດວັນພັກ ຫຼື ວັນຫ້າມຂາດເຈາະຈົງວັນຢູ່ແລ້ວຫຼືບໍ່
        </Typography.Paragraph>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          ຕັ້ງຄ່າມື້ທຳມະດາ
        </Button>
      </div>
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
        pagination={{ pageSize: 10 }}
        size="small"
        locale={{
          emptyText: 'ບໍ່ພົບຕຳແໜ່ງທີ່ຕັ້ງມື້ທຳມະດາ — ໃຊ້ປຸ່ມ "ຕັ້ງຄ່າມື້ທຳມະດາ" ຂ້າງເທິງເພື່ອຕັ້ງໃຫ້ຕຳແໜ່ງອື່ນ',
        }}
      >
        <Table.Column title="ຕຳແໜ່ງ" dataIndex="name" width={220} />
        <Table.Column
          title="ຈຳນວນພະນັກງານ"
          width={130}
          render={(_, position: Position) => employeesByPosition[position._id] ?? 0}
        />
        <Table.Column
          title="ລະດັບການຕັດເງິນ"
          render={(_, position: Position) => (
            <Select
              allowClear
              style={{ width: '100%', minWidth: 160 }}
              placeholder="ບໍ່ມີ — ຂາດມື້ທຳມະດາບໍ່ຕັດເງິນ"
              options={SEVERITY_OPTIONS}
              value={position.ordinaryAbsenceSeverity ?? undefined}
              onChange={(v: 'X2' | 'X3' | undefined) => setSeverity(position, v)}
            />
          )}
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, position: Position) => (
            <Popconfirm
              title="ລຶບການຕັ້ງຄ່ານີ້?"
              description={`ຕຳແໜ່ງ "${position.name}" ຈະບໍ່ມີລະດັບການຕັດເງິນສຳລັບມື້ທຳມະດາອີກຕໍ່ໄປ`}
              okText="ລຶບ"
              cancelText="ບໍ່"
              onConfirm={() => removeSeverity(position)}
            >
              <Button danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>
      <Modal
        title="ຕັ້ງຄ່າລະດັບການຕັດເງິນສຳລັບມື້ອື່ນໆ (ມື້ທຳມະດາ)"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
          setCreateDeptFilter(undefined);
        }}
        onOk={submitCreate}
        confirmLoading={creatingMany}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ເລືອກໄດ້ຫຼາຍຕຳແໜ່ງພ້ອມກັນ ຫຼື ກົດ "ເລືອກທັງໝົດ" ເພື່ອໃຊ້ຄ່າດຽວກັນກັບທຸກຕຳແໜ່ງທີ່ຍັງບໍ່ໄດ້ຕັ້ງ (ກອງຕາມພະແນກກ່ອນໄດ້ ເພື່ອຈຳກັດໃຫ້ແຄບລົງ)
        </Typography.Paragraph>
        <Space style={{ marginBottom: 12, width: '100%' }} direction="vertical" size={4}>
          <Typography.Text>ກອງຕາມພະແນກ (ບໍ່ບັງຄັບ)</Typography.Text>
          <Select
            {...departmentSelect}
            allowClear
            style={{ width: '100%' }}
            placeholder="ທຸກພະແນກ"
            value={createDeptFilter}
            onChange={(v: any) => {
              setCreateDeptFilter(v);
              createForm.setFieldValue('position', undefined);
            }}
          />
        </Space>
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="position"
            label={
              <Space>
                ຕຳແໜ່ງ
                <Button
                  size="small"
                  onClick={() => createForm.setFieldValue('position', uncreatedPositions.map((p) => p._id))}
                >
                  ເລືອກທັງໝົດ ({uncreatedPositions.length})
                </Button>
              </Space>
            }
            rules={[{ required: true, type: 'array', min: 1, message: 'ກະລຸນາເລືອກຕຳແໜ່ງຢ່າງໜ້ອຍ 1 ຕຳແໜ່ງ' }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="ເລືອກຕຳແໜ່ງທີ່ຍັງບໍ່ໄດ້ຕັ້ງ (ເລືອກໄດ້ຫຼາຍຕຳແໜ່ງ)"
              options={uncreatedPositions.map((p) => ({ value: p._id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item
            name="ordinaryAbsenceSeverity"
            label="ລະດັບການຕັດເງິນ"
            rules={[{ required: true, message: 'ກະລຸນາເລືອກລະດັບການຕັດເງິນ' }]}
          >
            <Select placeholder="ເລືອກລະດັບ" options={SEVERITY_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const NO_ABSENCE_SEVERITY_OPTIONS = [
  { label: 'X2', value: 'X2' },
  { label: 'X3', value: 'X3' },
];

// Individual override of NoAbsenceRuleTable above — same pattern as
// EmployeeRestDayRuleTable. A non-empty day list here REPLACES the
// position's entirely for this one person.
const EmployeeNoAbsenceRuleTable: React.FC = () => {
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

  const hasFilter = !!(search || departmentFilter || positionFilter);
  const employees = useMemo(() => {
    if (!hasFilter) return allEmployees.filter((e) => (e.noAbsenceDays ?? []).length > 0);
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

  const setDays = (employee: Employee, days: number[]) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { noAbsenceDays: days } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກວັນຫ້າມຂາດຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ` });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };
  const setSeverity = (employee: Employee, severity: 'X2' | 'X3' | undefined) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { noAbsenceSeverity: severity ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກລະດັບການຕັດເງິນຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ` });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };
  const clearOverride = (employee: Employee) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { noAbsenceDays: [], noAbsenceSeverity: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບການຕັ້ງພິເສດຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ — ກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ` });
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
        pagination={{ pageSize: 10 }}
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
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຄ່າຈາກຕຳແໜ່ງ"
          width={200}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            const days = position?.noAbsenceDays ?? [];
            return (
              <Typography.Text type="secondary">
                {days.length ? `${weekdayNames(days)} (${position?.noAbsenceSeverity ?? '-'})` : 'ບໍ່ມີ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ຕັ້ງພິເສດສະເພາະຄົນ"
          width={340}
          render={(_, emp: Employee) => (
            <Space>
              <Select
                mode="multiple"
                size="small"
                allowClear
                style={{ width: 200 }}
                placeholder="ໃຊ້ຄ່າຈາກຕຳແໜ່ງ"
                options={WEEKDAY_OPTIONS}
                value={emp.noAbsenceDays ?? []}
                onChange={(days: number[]) => setDays(emp, days)}
              />
              <Select
                size="small"
                allowClear
                style={{ width: 100 }}
                placeholder="ລະດັບ"
                options={NO_ABSENCE_SEVERITY_OPTIONS}
                value={emp.noAbsenceSeverity ?? undefined}
                onChange={(v: 'X2' | 'X3' | undefined) => setSeverity(emp, v)}
              />
            </Space>
          )}
        />
        <Table.Column
          title="ຄ່າທີ່ໃຊ້ຈິງ"
          width={200}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            const effectiveDays = emp.noAbsenceDays?.length ? emp.noAbsenceDays : position?.noAbsenceDays ?? [];
            const effectiveSeverity = emp.noAbsenceSeverity ?? position?.noAbsenceSeverity ?? null;
            return (
              <Typography.Text strong type={effectiveDays.length && effectiveSeverity ? 'warning' : undefined}>
                {effectiveDays.length && effectiveSeverity ? `${weekdayNames(effectiveDays)} (${effectiveSeverity})` : 'ບໍ່ມີຜົນ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, emp: Employee) =>
            (emp.noAbsenceDays ?? []).length === 0 && !emp.noAbsenceSeverity ? null : (
              <Popconfirm
                title="ລຶບການຕັ້ງພິເສດນີ້?"
                description={`"${emp.firstName} ${emp.lastName}" ຈະກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ`}
                okText="ລຶບ"
                cancelText="ບໍ່"
                onConfirm={() => clearOverride(emp)}
              >
                <Button danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            )
          }
        />
      </Table>
    </div>
  );
};

// Individual override of OrdinaryAbsenceRuleTable above — fully separate from
// EmployeeNoAbsenceRuleTable, same split as the position-level pair.
const EmployeeOrdinaryAbsenceRuleTable: React.FC = () => {
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

  const hasFilter = !!(search || departmentFilter || positionFilter);
  const employees = useMemo(() => {
    if (!hasFilter) return allEmployees.filter((e) => e.ordinaryAbsenceSeverity);
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

  const setSeverity = (employee: Employee, severity: 'X2' | 'X3' | undefined) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { ordinaryAbsenceSeverity: severity ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ບັນທຶກລະດັບການຕັດເງິນສຳລັບມື້ທຳມະດາຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ` });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };
  const clearOverride = (employee: Employee) => {
    updateEmployee(
      { resource: 'employees', id: employee._id, values: { ordinaryAbsenceSeverity: null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: `ລຶບການຕັ້ງພິເສດຂອງ "${employee.firstName} ${employee.lastName}" ແລ້ວ — ກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ` });
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
        pagination={{ pageSize: 10 }}
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
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຄ່າຈາກຕຳແໜ່ງ"
          width={110}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            return <Typography.Text type="secondary">{position?.ordinaryAbsenceSeverity ?? 'ບໍ່ມີ'}</Typography.Text>;
          }}
        />
        <Table.Column
          title="ຕັ້ງພິເສດສະເພາະຄົນ"
          width={160}
          render={(_, emp: Employee) => (
            <Select
              size="small"
              allowClear
              style={{ width: '100%', minWidth: 120 }}
              placeholder="ໃຊ້ຄ່າຈາກຕຳແໜ່ງ"
              options={NO_ABSENCE_SEVERITY_OPTIONS}
              value={emp.ordinaryAbsenceSeverity ?? undefined}
              onChange={(v: 'X2' | 'X3' | undefined) => setSeverity(emp, v)}
            />
          )}
        />
        <Table.Column
          title="ຄ່າທີ່ໃຊ້ຈິງ"
          width={110}
          render={(_, emp: Employee) => {
            const position = typeof emp.position === 'object' ? emp.position : undefined;
            const effective = emp.ordinaryAbsenceSeverity ?? position?.ordinaryAbsenceSeverity ?? null;
            return (
              <Typography.Text strong type={effective ? 'warning' : undefined}>
                {effective ?? 'ບໍ່ມີຜົນ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ຈັດການ"
          width={70}
          align="center"
          render={(_, emp: Employee) =>
            !emp.ordinaryAbsenceSeverity ? null : (
              <Popconfirm
                title="ລຶບການຕັ້ງພິເສດນີ້?"
                description={`"${emp.firstName} ${emp.lastName}" ຈະກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ`}
                okText="ລຶບ"
                cancelText="ບໍ່"
                onConfirm={() => clearOverride(emp)}
              >
                <Button danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            )
          }
        />
      </Table>
    </div>
  );
};

// Shared by all three rule pages below — each is its own route now, but all
// of them show the "ຈຳນວນພະນັກງານ" column against the same active-employee
// headcount per position.
function useEmployeesByPosition(): Record<string, number> {
  const { data: employeesData } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
  });
  return useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employeesData?.data ?? []) {
      const posId = idOf(e.position);
      if (!posId) continue;
      map[posId] = (map[posId] ?? 0) + 1;
    }
    return map;
  }, [employeesData?.data]);
}

export const SubstituteRulePage: React.FC = () => {
  const employeesByPosition = useEmployeesByPosition();

  return (
    <List title='ມາບໍ່ປົກກະຕິ' breadcrumb={false}>
      <Typography.Paragraph type="secondary">
        ຄົນທີ່ເປີດໃຊ້ກົດນີ້ (ຈາກຕຳແໜ່ງ ຫຼື ຕັ້ງພິເສດເປັນລາຍບຸກຄົນ) ຈະບໍ່ຖືກຕັດສິນວ່າມາຊ້າ/ຂາດວຽກຈາກເວລາສະແກນ ແລະ ສາມາດໃຊ້ສະຖານະ
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
    </List>
  );
};

export const RestDayRulePage: React.FC = () => {
  const employeesByPosition = useEmployeesByPosition();

  return (
    <List title="ຂໍ້ຈຳກັດວັນພັກ" breadcrumb={false}>
      <Typography.Paragraph type="secondary">
        ຕຳແໜ່ງທີ່ຕັ້ງໄວ້ນີ້ ຈະຫ້າມທຸກຄົນໃນຕຳແໜ່ງນັ້ນເລືອກວັນທີ່ຫ້າມເປັນວັນພັກປະຈຳ ຫຼື ວັນພັກທີ່ຕັ້ງລ່ວງໜ້າ (ບໍ່ກະທົບການລາປ່ວຍ ຫຼື ວັນພັກຮ້ານທີ່ປິດທັງບໍລິສັດ)
      </Typography.Paragraph>
      <Typography.Title level={5} style={{ marginTop: 8 }}>
        1. ຕັ້ງຄ່າຕາມຕຳແໜ່ງ
      </Typography.Title>
      <RestDayRuleTable employeesByPosition={employeesByPosition} />

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        2. ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ຖ້າຕັ້ງໄວ້ທີ່ນີ້ ຈະໃຊ້ຄ່າຂອງຄົນນີ້ແທນຄ່າຂອງຕຳແໜ່ງທັງໝົດ (ບໍ່ແມ່ນລວມກັນ) — ລ້າງຄືນທັງສອງຊ່ອງເພື່ອກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ
      </Typography.Paragraph>
      <EmployeeRestDayRuleTable />
    </List>
  );
};

export const NoAbsenceRulePage: React.FC = () => {
  const employeesByPosition = useEmployeesByPosition();

  return (
    <List title="ວັນຫ້າມຂາດ" breadcrumb={false}>
      <Typography.Title level={5}>ວັນຫ້າມຂາດ (ເຈາະຈົງວັນ)</Typography.Title>
      <Typography.Paragraph type="secondary">
        ຕຳແໜ່ງທີ່ຕັ້ງໄວ້ນີ້ ຈະຕັດເງິນໃນລະດັບທີ່ກຳນົດ (X2/X3) ຖ້າຄົນໃນຕຳແໜ່ງນັ້ນຂາດວຽກໃນວັນນີ້ — ແຕ່ຈະບໍ່ມີຜົນຖ້າວັນນັ້ນເປັນວັນພັກຂອງເຂົາຢູ່ແລ້ວ
        (ບໍ່ວ່າວັນພັກປະຈຳ ຫຼື ວັນພັກທີ່ຕັ້ງໄວ້)
      </Typography.Paragraph>
      <Typography.Title level={5} style={{ marginTop: 8 }}>
        1. ຕັ້ງຄ່າຕາມຕຳແໜ່ງ
      </Typography.Title>
      <NoAbsenceRuleTable employeesByPosition={employeesByPosition} />

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        2. ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ຖ້າຕັ້ງໄວ້ທີ່ນີ້ ຈະໃຊ້ຄ່າຂອງຄົນນີ້ແທນຄ່າຂອງຕຳແໜ່ງທັງໝົດ (ບໍ່ແມ່ນລວມກັນ) — ລ້າງຄືນທັງສອງຊ່ອງເພື່ອກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ
      </Typography.Paragraph>
      <EmployeeNoAbsenceRuleTable />

      <Typography.Title level={5} style={{ marginTop: 40 }}>
        ມື້ທຳມະດາ (ມື້ອື່ນໆ)
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ລະດັບການຕັດເງິນສຳລັບມື້ທຳມະດາ (ບໍ່ແມ່ນມື້ຫ້າມຂາດເຈາະຈົງວັນຂ້າງເທິງ) — ຕັ້ງແຍກກັນໄດ້ຢ່າງອິດສະລະ ບໍ່ວ່າຕຳແໜ່ງນັ້ນຈະມີ ຂໍ້ຈຳກັດວັນພັກ
        ຫຼື ວັນຫ້າມຂາດເຈາະຈົງວັນຂ້າງເທິງຢູ່ແລ້ວຫຼືບໍ່
      </Typography.Paragraph>
      <Typography.Title level={5} style={{ marginTop: 8 }}>
        1. ຕັ້ງຄ່າຕາມຕຳແໜ່ງ
      </Typography.Title>
      <OrdinaryAbsenceRuleTable employeesByPosition={employeesByPosition} />

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        2. ຕັ້ງຄ່າສະເພາະລາຍບຸກຄົນ
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ຖ້າຕັ້ງໄວ້ທີ່ນີ້ ຈະໃຊ້ຄ່າຂອງຄົນນີ້ແທນຄ່າຂອງຕຳແໜ່ງທັງໝົດ (ບໍ່ແມ່ນລວມກັນ) — ລ້າງຄືນເພື່ອກັບໄປໃຊ້ຄ່າຈາກຕຳແໜ່ງ
      </Typography.Paragraph>
      <EmployeeOrdinaryAbsenceRuleTable />
    </List>
  );
};
