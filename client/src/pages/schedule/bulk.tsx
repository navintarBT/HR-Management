import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Select, DatePicker, TimePicker, Button, Space, Typography, Modal, Form, Input } from 'antd';
import { ApartmentOutlined, IdcardOutlined, ClockCircleOutlined, SwapOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { Employee, Department, Position, ShiftCategory } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter as withTextFilter } from '../../utils/selectFilters';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';

const { RangePicker: TimeRangePicker } = TimePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// Same resolution rule as ຕາຕະລາງວັນພັກ and the employee show page — a linked
// category is a live reference (editing the category later updates this too),
// defaultShiftStart/End is the fallback for a manual time with no category.
function resolveDefaultShiftTime(employee: Employee): { start: string; end: string } | null {
  const category = employee.defaultShiftCategory;
  if (category && typeof category === 'object') return { start: category.startTime, end: category.endTime };
  if (employee.defaultShiftStart && employee.defaultShiftEnd) return { start: employee.defaultShiftStart, end: employee.defaultShiftEnd };
  return null;
}

// This page manages employees in GROUPS — permanently moving them to a
// different department/position/recurring shift, or scheduling a one-off
// shift swap ahead of time. Day-to-day per-person adjustments (a single rest
// day, a one-off time change) belong on ຕາຕະລາງວັນພັກ instead.
export const BulkShiftEditPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  const positionOptionsForFilter = useMemo(() => {
    if (!departmentFilter) return undefined;
    return allPositions
      .filter((p) => (p.departments ?? []).some((d) => idOf(d) === departmentFilter))
      .map((p) => ({ label: p.name, value: p._id }));
  }, [allPositions, departmentFilter]);

  const filters = useMemo(() => {
    const f: any[] = [{ field: 'status', operator: 'eq', value: 'active' }];
    if (search) f.push({ field: 'q', operator: 'eq', value: search });
    if (departmentFilter) f.push({ field: 'department', operator: 'eq', value: departmentFilter });
    if (positionFilter) f.push({ field: 'position', operator: 'eq', value: positionFilter });
    return f;
  }, [search, departmentFilter, positionFilter]);

  const { data: employeesData, isLoading, refetch } = useList<Employee>({
    resource: 'employees',
    filters,
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = employeesData?.data ?? [];

  const { selectProps: employeeSelect, query: employeeQuery } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500, mode: 'server' },
  });
  // Broader than the (possibly filtered) main table — used to resolve an
  // employee's own position when scheduling a shift swap for anyone active.
  const employeeById = useMemo(() => {
    const map: Record<string, Employee> = {};
    for (const e of employeeQuery?.data?.data ?? []) map[e._id] = e;
    return map;
  }, [employeeQuery?.data?.data]);

  const { data: categoriesData } = useList<ShiftCategory>({ resource: 'shift-categories', pagination: { pageSize: 100 } });
  const categories = categoriesData?.data ?? [];
  const { selectProps: categorySelect } = useSelect<ShiftCategory>({
    resource: 'shift-categories',
    optionLabel: (item) => (item.name ? `${item.name} (${item.startTime}-${item.endTime})` : `${item.startTime}-${item.endTime}`),
    optionValue: '_id',
    pagination: { pageSize: 100, mode: 'server' },
  });

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const refreshAll = () => {
    setSelectedIds([]);
    invalidate({ resource: 'employees', invalidates: ['list'] });
    refetch();
  };

  // ---- 1. ຍ້າຍພະແນກ ----
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [moveDepartment, setMoveDepartment] = useState<string>();
  const [movingDept, setMovingDept] = useState(false);

  const submitMoveDepartment = async () => {
    if (!moveDepartment || !selectedIds.length) return;
    const target = allDepartments.find((d) => d._id === moveDepartment);
    setMovingDept(true);
    const results = await Promise.allSettled(
      selectedIds.map((id) => {
        const emp = employees.find((e) => e._id === id);
        const positionStillValid =
          emp?.position &&
          allPositions.find((p) => p._id === idOf(emp.position))?.departments?.some((d) => idOf(d) === moveDepartment);
        return axiosInstance.patch(`${API_URL}/employees/${id}`, {
          department: moveDepartment,
          supervisor: target?.head ? idOf(target.head) : null,
          ...(positionStillValid ? {} : { position: null, positionHead: null }),
        });
      })
    );
    setMovingDept(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ຍ້າຍພະແນກສຳເລັດ ${results.length - failCount}/${results.length} ຄົນ`,
    });
    setDeptModalOpen(false);
    setMoveDepartment(undefined);
    refreshAll();
  };

  // ---- 2. ຍ້າຍຕຳແໜ່ງ ----
  const [positionModalOpen, setPositionModalOpen] = useState(false);
  const [movePosition, setMovePosition] = useState<string>();
  const [movingPosition, setMovingPosition] = useState(false);

  const submitMovePosition = async () => {
    if (!movePosition || !selectedIds.length) return;
    const target = allPositions.find((p) => p._id === movePosition);
    setMovingPosition(true);
    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        axiosInstance.patch(`${API_URL}/employees/${id}`, {
          position: movePosition,
          positionHead: target?.head ? idOf(target.head) : null,
        })
      )
    );
    setMovingPosition(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ຍ້າຍຕຳແໜ່ງສຳເລັດ ${results.length - failCount}/${results.length} ຄົນ`,
    });
    setPositionModalOpen(false);
    setMovePosition(undefined);
    refreshAll();
  };

  // ---- 3. ຍ້າຍກະ (ປ່ຽນກະປະຈຳ) ----
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [moveCategory, setMoveCategory] = useState<string>();
  const [moveTime, setMoveTime] = useState<[Dayjs, Dayjs] | null>(null);
  const [movingShift, setMovingShift] = useState(false);

  const submitMoveShift = async () => {
    if (!selectedIds.length) return;
    const category = categories.find((c) => c._id === moveCategory);
    const startTime = moveTime?.[0]?.format('HH:mm') ?? category?.startTime;
    const endTime = moveTime?.[1]?.format('HH:mm') ?? category?.endTime;
    if (!startTime || !endTime) return;
    setMovingShift(true);
    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        axiosInstance.patch(`${API_URL}/employees/${id}`, {
          defaultShiftCategory: moveCategory ?? null,
          defaultShiftStart: moveCategory ? null : startTime,
          defaultShiftEnd: moveCategory ? null : endTime,
        })
      )
    );
    setMovingShift(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ຍ້າຍກະສຳເລັດ ${results.length - failCount}/${results.length} ຄົນ`,
    });
    setShiftModalOpen(false);
    setMoveCategory(undefined);
    setMoveTime(null);
    refreshAll();
  };

  // ---- 4. ສະຫຼັບກະລ່ວງໜ້າ (ສ້າງ Shift ຈິງສຳລັບມື້ໃດໜຶ່ງໃນອະນາຄົດ) ----
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapEmployees, setSwapEmployees] = useState<string[]>([]);
  const [swapDate, setSwapDate] = useState<Dayjs>();
  const [swapCategory, setSwapCategory] = useState<string>();
  const [swapTime, setSwapTime] = useState<[Dayjs, Dayjs] | null>(null);
  const [swapping, setSwapping] = useState(false);

  const openSwapModal = () => {
    setSwapEmployees(selectedIds);
    setSwapModalOpen(true);
  };

  const submitSwap = async () => {
    if (!swapEmployees.length || !swapDate) return;
    const category = categories.find((c) => c._id === swapCategory);
    const startTime = swapTime?.[0]?.format('HH:mm') ?? category?.startTime;
    const endTime = swapTime?.[1]?.format('HH:mm') ?? category?.endTime;
    if (!startTime || !endTime) {
      notify?.({ type: 'error', message: 'ກະລຸນາເລືອກໝວດໝູ່ກະ ຫຼື ກຳນົດເວລາເອງ' });
      return;
    }
    const dateStr = swapDate.format('YYYY-MM-DD');
    setSwapping(true);
    const results = await Promise.allSettled(
      swapEmployees.map((employeeId) =>
        axiosInstance.post(`${API_URL}/shifts`, {
          employee: employeeId,
          position: idOf(employeeById[employeeId]?.position),
          date: dateStr,
          status: 'scheduled',
          startTime,
          endTime,
        })
      )
    );
    setSwapping(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ສ້າງກະສຳເລັດ ${results.length - failCount}/${results.length} ລາຍການ${
        failCount ? ' (ບາງລາຍການອາດຊ້ຳກັບກະທີ່ມີຢູ່ແລ້ວໃນມື້ນັ້ນ)' : ''
      }`,
    });
    if (results.length - failCount > 0) {
      setSwapModalOpen(false);
      setSwapEmployees([]);
      setSwapDate(undefined);
      setSwapCategory(undefined);
      setSwapTime(null);
    }
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ແກ້ໄຂກະແບບກຸ່ມ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(v) => setSearch(v)}
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
            options={positionOptionsForFilter}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            style={{ width: 180 }}
            value={positionFilter}
            onChange={(v: any) => setPositionFilter(v)}
          />
        </Space>

        <Space wrap style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {selectedIds.length ? `ເລືອກແລ້ວ ${selectedIds.length} ຄົນ` : 'ຕິກເລືອກພະນັກງານໃນຕາຕະລາງ ເພື່ອຈັດການແບບກຸ່ມ'}
          </Typography.Text>
          <Button icon={<ApartmentOutlined />} disabled={!selectedIds.length} onClick={() => setDeptModalOpen(true)}>
            ຍ້າຍພະແນກ
          </Button>
          <Button icon={<IdcardOutlined />} disabled={!selectedIds.length} onClick={() => setPositionModalOpen(true)}>
            ຍ້າຍຕຳແໜ່ງ
          </Button>
          <Button icon={<ClockCircleOutlined />} disabled={!selectedIds.length} onClick={() => setShiftModalOpen(true)}>
            ຍ້າຍກະ (ປ່ຽນກະປະຈຳ)
          </Button>
          <Button icon={<SwapOutlined />} onClick={openSwapModal}>
            ສະຫຼັບກະລ່ວງໜ້າ
          </Button>
        </Space>
      </div>

      <Table
        rowKey="_id"
        dataSource={employees}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
      >
        <Table.Column title="ລະຫັດພະນັກງານ" dataIndex="employeeCode" width={110} />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          width={180}
          render={(_, record: Employee) => `${record.firstName ?? ''} ${record.lastName ?? ''}`}
        />
        <Table.Column
          title="ພະແນກ"
          width={140}
          render={(_, record: Employee) => (typeof record.department === 'object' ? record.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, record: Employee) => (typeof record.position === 'object' ? record.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ໂມງເຂົ້າວຽກ"
          width={160}
          render={(_, record: Employee) => {
            const t = resolveDefaultShiftTime(record);
            return t ? `${t.start} - ${t.end}` : '-';
          }}
        />
        <Table.Column
          title="ວັນພັກປະຈຳ"
          width={110}
          render={(_, record: Employee) =>
            record.defaultRestDay != null ? WEEKDAY_OPTIONS.find((w) => w.value === record.defaultRestDay)?.label : '-'
          }
        />
      </Table>

      <Modal
        title={`ຍ້າຍພະແນກ — ${selectedIds.length} ຄົນ`}
        open={deptModalOpen}
        onCancel={() => setDeptModalOpen(false)}
        onOk={submitMoveDepartment}
        confirmLoading={movingDept}
        okText="ຍ້າຍ"
        okButtonProps={{ disabled: !moveDepartment }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຫົວໜ້າງານ (ຫົວໜ້າພະແນກ) ຈະຖືກປັບໃຫ້ຕົງກັບພະແນກໃໝ່ອັດຕະໂນມັດ — ຖ້າຕຳແໜ່ງເດີມບໍ່ຂຶ້ນກັບພະແນກໃໝ່ ຈະຖືກລ້າງອອກ (ໄປຕັ້ງໃໝ່ໄດ້ຈາກ "ຍ້າຍຕຳແໜ່ງ")
        </Typography.Paragraph>
        <Select
          {...departmentSelect}
          placeholder="ພະແນກໃໝ່"
          style={{ width: '100%' }}
          value={moveDepartment}
          onChange={(v: any) => setMoveDepartment(v)}
        />
      </Modal>

      <Modal
        title={`ຍ້າຍຕຳແໜ່ງ — ${selectedIds.length} ຄົນ`}
        open={positionModalOpen}
        onCancel={() => setPositionModalOpen(false)}
        onOk={submitMovePosition}
        confirmLoading={movingPosition}
        okText="ຍ້າຍ"
        okButtonProps={{ disabled: !movePosition }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">ຫົວໜ້າຕຳແໜ່ງ ຈະຖືກປັບໃຫ້ຕົງກັບຕຳແໜ່ງໃໝ່ອັດຕະໂນມັດ</Typography.Paragraph>
        <Select
          {...positionSelect}
          placeholder="ຕຳແໜ່ງໃໝ່"
          style={{ width: '100%' }}
          value={movePosition}
          onChange={(v: any) => setMovePosition(v)}
        />
      </Modal>

      <Modal
        title={`ຍ້າຍກະ — ${selectedIds.length} ຄົນ`}
        open={shiftModalOpen}
        onCancel={() => setShiftModalOpen(false)}
        onOk={submitMoveShift}
        confirmLoading={movingShift}
        okText="ຍ້າຍກະ"
        okButtonProps={{ disabled: !moveCategory && !moveTime }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">ປ່ຽນກະປະຈຳ (default) ຂອງທຸກຄົນທີ່ເລືອກ — ມີຜົນຕໍ່ທຸກມື້ນັບແຕ່ນີ້ໄປ ຈົນກວ່າຈະປ່ຽນອີກ</Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="ໝວດໝູ່ກະ">
            <Select {...categorySelect} placeholder="ໝວດໝູ່ກະ" allowClear value={moveCategory} onChange={(v: any) => setMoveCategory(v)} />
          </Form.Item>
          <Form.Item label="ຫຼື ກຳນົດເວລາເອງ" tooltip="ຖ້າຕື່ມທັງສອງຢ່າງ ຈະໃຊ້ຄ່າທີ່ກຳນົດເອງແທນ">
            <TimeRangePicker style={{ width: '100%' }} format="HH:mm" value={moveTime} onChange={(v) => setMoveTime(v as [Dayjs, Dayjs] | null)} allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="ສະຫຼັບກະລ່ວງໜ້າ"
        open={swapModalOpen}
        onCancel={() => setSwapModalOpen(false)}
        onOk={submitSwap}
        confirmLoading={swapping}
        okText="ສ້າງກະ"
        okButtonProps={{ disabled: !swapEmployees.length || !swapDate || (!swapCategory && !swapTime) }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ສຳລັບມື້ໃດໜຶ່ງໃນອະນາຄົດ (ເຊັ່ນ: ມື້ສະຫຼັບກະປະຈຳເດືອນ) — ຈະສ້າງກະຈິງໃຫ້ທຸກຄົນທີ່ເລືອກໃນມື້ດຽວກັນ, ຕໍາແໜ່ງໃຊ້ຂອງແຕ່ລະຄົນເອງ
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="ພະນັກງານ (ເລືອກໄດ້ຫຼາຍຄົນ)">
            <Select
              {...withTextFilter(employeeSelect)}
              mode="multiple"
              placeholder="ເລືອກພະນັກງານ"
              allowClear
              style={{ width: '100%' }}
              value={swapEmployees}
              onChange={(v: any) => setSwapEmployees(v)}
            />
          </Form.Item>
          <Form.Item label="ວັນທີ">
            <DatePicker style={{ width: '100%' }} placeholder="ວັນທີ" format="DD/MM/YYYY" value={swapDate} onChange={(v) => setSwapDate(v ?? undefined)} />
          </Form.Item>
          <Form.Item label="ໝວດໝູ່ກະ">
            <Select {...categorySelect} placeholder="ໝວດໝູ່ກະ" allowClear style={{ width: '100%' }} value={swapCategory} onChange={(v: any) => setSwapCategory(v)} />
          </Form.Item>
          <Form.Item label="ຫຼື ກຳນົດເວລາເອງ" tooltip="ຖ້າຕື່ມທັງສອງຢ່າງ ຈະໃຊ້ຄ່າທີ່ກຳນົດເອງແທນ">
            <TimeRangePicker
              style={{ width: '100%' }}
              format="HH:mm"
              placeholder={['ເລີ່ມ', 'ສິ້ນສຸດ']}
              value={swapTime}
              onChange={(v) => setSwapTime(v as [Dayjs, Dayjs] | null)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};
