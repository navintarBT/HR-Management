import { useMemo, useState } from 'react';
import { useSelect } from '@refinedev/antd';
import { useList, useCreate, useDelete, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Statistic, Card, Select, Modal, Form, DatePicker, TimePicker } from 'antd';
import { LeftOutlined, RightOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Position, Shift } from '../../types';

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

// Overnight-aware, same convention as a shift's own start/end.
function hoursBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

// Monthly grid of ການເຮັດແທນ, same month-at-a-time shape as ຕາຕະລາງວັນພັກ: one
// row per employee covering someone this month, one column per day. Each
// cell lists that day's covers with who they're covering, the covered
// person's department and position, and the time — kept full-size (not
// shrunk to match ຕາຕະລາງວັນພັກ's compact day cells), since a cover genuinely
// needs more than that to show. Records are created from ຕາຕະລາງວັນພັກ (click
// a day → ໄປເຮັດແທນຄົນອື່ນ) or from the "ມອບໝາຍການເຮັດແທນ" button below.
export const ScheduleCoversGrid: React.FC = () => {
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const rangeStart = monthStart;
  const dayCount = monthStart.daysInMonth();
  const rangeEnd = rangeStart.add(dayCount - 1, 'day');
  const rangeDays = Array.from({ length: dayCount }, (_, i) => rangeStart.add(i, 'day'));
  const periodText = 'ໃນເດືອນນີ້';
  const startKey = rangeStart.format('YYYY-MM-DD');
  const endKey = rangeEnd.format('YYYY-MM-DD');

  const { data: shiftsData, isLoading, refetch } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: startKey },
      { field: 'date', operator: 'lte', value: endKey },
      { field: 'status', operator: 'eq', value: 'scheduled' },
    ],
    pagination: { pageSize: 5000 },
  });
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

  // Filters match the covered person's department and position — the ones shown
  // in each cell — since that's the job being done.
  const covers = useMemo(
    () =>
      (shiftsData?.data ?? []).filter((s) => {
        if (!s.coveringFor) return false;
        const covered = typeof s.coveringFor === 'object' ? s.coveringFor : undefined;
        if (departmentFilter && idOf(covered?.department) !== departmentFilter) return false;
        if (positionFilter && idOf(s.position) !== positionFilter) return false;
        return true;
      }),
    [shiftsData?.data, departmentFilter, positionFilter]
  );

  // Index by coverer → date → covers (sorted by start time within a day).
  const byCoverer = useMemo(() => {
    const map = new Map<string, { employee: Employee; byDate: Map<string, Shift[]> }>();
    for (const s of covers) {
      const emp = s.employee as Employee;
      const empId = typeof s.employee === 'object' ? emp._id : String(s.employee);
      if (!map.has(empId)) map.set(empId, { employee: emp, byDate: new Map() });
      const bucket = map.get(empId)!.byDate;
      bucket.set(s.date, [...(bucket.get(s.date) ?? []), s]);
    }
    for (const entry of map.values()) {
      for (const list of entry.byDate.values()) list.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return Array.from(map.values()).sort((a, b) => (a.employee.employeeCode ?? '').localeCompare(b.employee.employeeCode ?? ''));
  }, [covers]);

  const totalHours = covers.reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);

  const { mutate: deleteShift } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const removeCover = (id: string) => {
    deleteShift(
      { resource: 'shifts', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  // Mirrors ຕາຕະລາງວັນພັກ's own "ໄປເຮັດແທນຄົນອື່ນ" flow (monthly.tsx's
  // handleCover) — same fields, same createShift call — just with its own
  // coverer/date pickers up front instead of those coming from a clicked day
  // cell, since this page has no such cell to click.
  const { data: allEmployeesData } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
  });
  const allEmployees = allEmployeesData?.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const createCoverer = Form.useWatch('coverer', createForm);
  const createCoverDept = Form.useWatch('coverDept', createForm);
  const createCoverPos = Form.useWatch('coverPos', createForm);
  const { mutate: createShift, isLoading: creatingCover } = useCreate();

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

  // The covered person's own time for that day, same fallback order as
  // monthly.tsx's defaultTimeFor — a real schedule to start the picker from
  // instead of an empty one.
  const defaultTimeFor = (emp: Employee, dateKey: string): [Dayjs, Dayjs] | undefined => {
    const category = emp.defaultShiftCategory;
    if (category && typeof category === 'object') {
      return [dayjs(`${dateKey}T${category.startTime}`), dayjs(`${dateKey}T${category.endTime}`)];
    }
    if (emp.defaultShiftStart && emp.defaultShiftEnd) {
      return [dayjs(`${dateKey}T${emp.defaultShiftStart}`), dayjs(`${dateKey}T${emp.defaultShiftEnd}`)];
    }
    return undefined;
  };
  const fillCoverTime = (coveredId: string) => {
    const date = createForm.getFieldValue('date') as Dayjs | undefined;
    if (!date) return;
    const covered = allEmployees.find((e) => e._id === coveredId);
    const time = covered ? defaultTimeFor(covered, date.format('YYYY-MM-DD')) : undefined;
    if (time) createForm.setFieldValue('time', time);
  };

  const submitCreateCover = async () => {
    const values = await createForm.validateFields();
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
          employee: values.coverer,
          coveringFor: values.coveredEmployee,
          position: coveredPositionId,
          date: (values.date as Dayjs).format('YYYY-MM-DD'),
          startTime: (values.time as [Dayjs, Dayjs])[0].format('HH:mm'),
          endTime: (values.time as [Dayjs, Dayjs])[1].format('HH:mm'),
          status: 'scheduled',
        },
      },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກການເຮັດແທນແລ້ວ' });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
          refetch();
          setCreateOpen(false);
          createForm.resetFields();
        },
        onError: (err: any) => {
          notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
        },
      }
    );
  };

  const CoverCell = ({ list }: { list: Shift[] }) => (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {list.map((s) => (
        <div
          key={s._id}
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
            <Popconfirm title="ລຶບການເຮັດແທນນີ້?" onConfirm={() => removeCover(s._id)}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>
      ))}
    </Space>
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          ມອບໝາຍການເຮັດແທນ
        </Button>
      </Space>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small">
          <Statistic title={`ຈຳນວນການເຮັດແທນ${periodText}`} value={covers.length} />
        </Card>
        <Card size="small">
          <Statistic title="ລວມຊົ່ວໂມງເຮັດແທນ" value={totalHours} precision={2} suffix="ຊມ." />
        </Card>
      </Space>

      <Table
        dataSource={byCoverer}
        rowKey={(row) => row.employee._id}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="small"
        locale={{ emptyText: `ຍັງບໍ່ມີການເຮັດແທນ${periodText}` }}
      >
        <Table.Column
          title="ຜູ້ເຮັດແທນ"
          fixed="left"
          width={200}
          render={(_, row: { employee: Employee }) => (
            <div style={{ fontWeight: 600 }}>
              {row.employee.employeeCode} {fullName(row.employee)}
            </div>
          )}
        />
        <Table.Column
          title="ພະແນກ"
          width={150}
          render={(_, row: { employee: Employee }) => deptOf(row.employee)}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, row: { employee: Employee }) => positionOf(row.employee)}
        />
        {rangeDays.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
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
                </div>
              }
              render={(_, row: { byDate: Map<string, Shift[]> }) => {
                const list = row.byDate.get(dateKey);
                return list ? <CoverCell list={list} /> : <span style={{ color: '#bfbfbf' }}>-</span>;
              }}
            />
          );
        })}
      </Table>

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
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
