import { useEffect, useMemo, useState } from 'react';
import { useModalForm, useSelect } from '@refinedev/antd';
import { useGetIdentity, useDelete, useInvalidate, useList, useNotification } from '@refinedev/core';
import { Table, Button, Modal, Form, Select, DatePicker, TimePicker, Input, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Identity, Overtime, Position } from '../../types';
import { OvertimeStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter as withTextFilter } from '../../utils/selectFilters';

const { RangePicker: TimeRangePicker } = TimePicker;
const { RangePicker: DateRangePicker } = DatePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

const employeeName = (v?: Employee | string) => (v && typeof v === 'object' ? `${v.firstName ?? ''} ${v.lastName ?? ''}` : '-');

// Overnight-safe: an OT range like 22:00-02:00 crosses midnight.
function computeHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

// Shared by both pages: month nav + a free date-range, plus search/department/
// position — identical shape to what employees/list.tsx and the attendance
// reports already use, so it behaves the same way everywhere in the app.
function useOvertimeFilters() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);
  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

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

  const matchesEmployee = (emp?: Employee) => {
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
  };

  const toolbar = (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<LeftOutlined />} onClick={() => goToMonth(range[0].subtract(1, 'month'))} />
        <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
        <Button icon={<RightOutlined />} onClick={() => goToMonth(range[0].add(1, 'month'))} />
        <Typography.Text strong>{range[0].format('MMMM YYYY')}</Typography.Text>
        <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
        <DateRangePicker value={range} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} format="DD/MM/YYYY" allowClear={false} />
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
    </Space>
  );

  return { range, toolbar, matchesEmployee };
}

// One row per employee — with 200+ people and possibly several OT entries
// each this month, the flat per-request list (ຈັດການ OT page) is too long to
// scan for "who's racking up OT hours". This rolls each employee's entries
// for the selected range into one line instead.
export const OvertimeSummaryGrid: React.FC = () => {
  const { range, toolbar, matchesEmployee } = useOvertimeFilters();
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const { data: otData, isLoading: otLoading } = useList<Overtime>({
    resource: 'overtime',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    pagination: { pageSize: 5000 },
  });
  const otRows = otData?.data ?? [];

  const summaryByEmployee = useMemo(() => {
    const map: Record<string, { approvedCount: number; approvedHours: number }> = {};
    for (const ot of otRows) {
      if (!ot.employee || ot.status !== 'approved') continue;
      const empId = idOf(ot.employee) ?? '';
      if (!map[empId]) map[empId] = { approvedCount: 0, approvedHours: 0 };
      map[empId].approvedCount += 1;
      map[empId].approvedHours += computeHours(ot.startTime, ot.endTime);
    }
    return map;
  }, [otRows]);

  // Only list employees who actually have OT this range — with 200+ staff,
  // a summary meant to answer "who racked up OT" shouldn't be buried under
  // everyone who didn't.
  const employees = useMemo(
    () => allEmployees.filter(matchesEmployee).filter((emp) => !!summaryByEmployee[emp._id]),
    [allEmployees, matchesEmployee, summaryByEmployee]
  );

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        {toolbar}
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || otLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        locale={{ emptyText: 'ບໍ່ມີໃຜເຮັດ OT ໃນຊ່ວງນີ້' }}
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
          title="ຈຳນວນຄັ້ງ (ອະນຸມັດແລ້ວ)"
          width={150}
          render={(_, emp: Employee) => summaryByEmployee[emp._id]?.approvedCount ?? 0}
        />
        <Table.Column
          title="ລວມຊົ່ວໂມງ OT"
          width={130}
          render={(_, emp: Employee) => {
            const hours = summaryByEmployee[emp._id]?.approvedHours ?? 0;
            return hours > 0 ? <Typography.Text strong>{hours} ຊມ.</Typography.Text> : '-';
          }}
        />
        <Table.Column
          title="ນັບເປັນມື້ (24 ຊມ./ມື້)"
          width={150}
          render={(_, emp: Employee) => {
            // ມື້ = a full 24-hour day. Only whole days count — 27 ຊມ. is
            // "1 ມື້ 3 ຊມ.", not rounded up to 2 ມື້; under 24 ຊມ. total
            // doesn't reach even 1 ມື້ yet, so nothing is counted.
            const hours = summaryByEmployee[emp._id]?.approvedHours ?? 0;
            const days = Math.floor(hours / 24);
            const remainder = Math.round((hours - days * 24) * 100) / 100;
            if (days <= 0) return '-';
            return (
              <Typography.Text strong>
                {days} ມື້{remainder > 0 ? ` ${remainder} ຊມ.` : ''}
              </Typography.Text>
            );
          }}
        />
      </Table>
    </div>
  );
};

export const OvertimeDetailList: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canWrite = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const { range, toolbar, matchesEmployee } = useOvertimeFilters();
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');

  const { data: otData, isLoading, refetch } = useList<Overtime>({
    resource: 'overtime',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    sorters: [{ field: 'date', order: 'desc' }],
    pagination: { pageSize: 2000 },
  });
  const allRows = otData?.data ?? [];
  const rows = useMemo(
    () => allRows.filter((ot) => matchesEmployee(typeof ot.employee === 'object' ? ot.employee : undefined)),
    [allRows, matchesEmployee]
  );

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.employeeCode} - ${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { modalProps, formProps, show } = useModalForm<Overtime>({
    resource: 'overtime',
    action: 'create',
    // Without this, Refine's default post-submit redirect bounces to
    // /overtime's own list route, which immediately redirects to
    // /overtime/summary via its index route — same fix as the leaves pages.
    redirect: false,
  });
  const submitCreate = (values: any) =>
    formProps.onFinish?.({ ...values, date: values.date ? dayjs(values.date).toISOString() : undefined });
  const createEmployeeId = Form.useWatch('employee', formProps.form);

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    query: editQuery,
  } = useModalForm<Overtime>({
    resource: 'overtime',
    action: 'edit',
    redirect: false,
  });
  const submitEdit = (values: any) =>
    editFormProps.onFinish?.({ ...values, date: values.date ? dayjs(values.date).toISOString() : undefined });
  const editEmployeeId = Form.useWatch('employee', editFormProps.form);

  // A person can't sign off on their own OT — checked here for immediate
  // feedback, and again server-side (the real enforcement) in case this is
  // ever bypassed some other way.
  const notSelfApprover = (employeeId?: string) => [
    {
      validator: (_: unknown, value?: string) =>
        value && employeeId && value === employeeId
          ? Promise.reject(new Error('ຜູ້ອະນຸມັດ ຈະເປັນຄົນດຽວກັນກັບຄົນທີ່ເຮັດ OT ບໍ່ໄດ້'))
          : Promise.resolve(),
    },
  ];

  useEffect(() => {
    const record = editQuery?.data?.data;
    if (!record) return;
    editFormProps.form?.setFieldsValue({
      employee: idOf(record.employee),
      date: dayjs(record.date),
      time: [dayjs(record.startTime, 'HH:mm'), dayjs(record.endTime, 'HH:mm')],
      reason: record.reason,
      note: record.note,
      approver: idOf(record.approver),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery?.data?.data]);

  const { mutate: deleteOvertime } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const refreshAll = () => {
    invalidate({ resource: 'overtime', invalidates: ['list'] });
    refetch();
  };

  const handleDelete = (id: string) => {
    deleteOvertime(
      { resource: 'overtime', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          refreshAll();
        },
        onError: () => notify?.({ type: 'error', message: 'ລຶບບໍ່ສຳເລັດ' }),
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {toolbar}
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>
              ສະເໜີ OT
            </Button>
          )}
        </Space>
      </div>

      <Table dataSource={rows} loading={isLoading} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ລະຫັດ"
          width={90}
          render={(_, record: Overtime) => (typeof record.employee === 'object' ? record.employee?.employeeCode : undefined) || '-'}
        />
        <Table.Column title="ວັນທີ່/ເດືອນ/ປີ" width={120} render={(_, record: Overtime) => dayjs(record.date).format('DD/MM/YYYY')} />
        <Table.Column title="ຜູ້ສະເໜີ" width={160} render={(_, record: Overtime) => employeeName(record.employee as Employee)} />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, record: Overtime) => {
            const dept = typeof record.employee === 'object' ? record.employee?.department : undefined;
            return (dept && typeof dept === 'object' ? dept.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={130}
          render={(_, record: Overtime) => {
            const position = typeof record.employee === 'object' ? record.employee?.position : undefined;
            return (position && typeof position === 'object' ? position.name : undefined) || '-';
          }}
        />
        <Table.Column title="ຈັກໂມງຫາຈັກໂມງ" width={140} render={(_, record: Overtime) => `${record.startTime} - ${record.endTime}`} />
        <Table.Column
          title="ລວມຊົ່ວໂມງ"
          width={110}
          render={(_, record: Overtime) => `${computeHours(record.startTime, record.endTime)} ຊມ.`}
        />
        <Table.Column title="ເຫດຜົນ" dataIndex="reason" width={180} ellipsis />
        <Table.Column title="ຜູ້ອະນຸມັດ" width={150} render={(_, record: Overtime) => employeeName(record.approver as Employee)} />
        <Table.Column title="ໝາຍເຫດ" dataIndex="note" width={150} ellipsis />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(v) => <OvertimeStatusTag status={v} />} />
        {(canWrite || isAdmin) && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={200}
            render={(_, record: Overtime) => (
              <Space>
                {canWrite && <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />}
                {isAdmin && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record._id)} />}
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...modalProps} title="ສະເໜີ OT" afterClose={refreshAll}>
        <Form {...formProps} onFinish={submitCreate} layout="vertical">
          <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
            <Select {...withTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ຜູ້ອະນຸມັດ" name="approver" rules={notSelfApprover(createEmployeeId)}>
            <Select {...withTextFilter(employeeSelect)} allowClear placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ວັນທີ່" name="date" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ່' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="ຈັກໂມງຫາຈັກໂມງ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
            <TimeRangePicker
              style={{ width: '100%' }}
              format="HH:mm"
              onChange={(dates) => {
                formProps.form?.setFieldsValue({
                  startTime: dates?.[0]?.format('HH:mm'),
                  endTime: dates?.[1]?.format('HH:mm'),
                });
              }}
            />
          </Form.Item>
          <Form.Item name="startTime" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endTime" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={2} placeholder="ລະບຸເຫດຜົນທີ່ຕ້ອງເຮັດ OT" />
          </Form.Item>
          <Form.Item label="ໝາຍເຫດ" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂ OT" afterClose={refreshAll}>
        <Form {...editFormProps} onFinish={submitEdit} layout="vertical">
          <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
            <Select {...withTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ຜູ້ອະນຸມັດ" name="approver" rules={notSelfApprover(editEmployeeId)}>
            <Select {...withTextFilter(employeeSelect)} allowClear placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ວັນທີ່" name="date" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ່' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="ຈັກໂມງຫາຈັກໂມງ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
            <TimeRangePicker
              style={{ width: '100%' }}
              format="HH:mm"
              onChange={(dates) => {
                editFormProps.form?.setFieldsValue({
                  startTime: dates?.[0]?.format('HH:mm'),
                  endTime: dates?.[1]?.format('HH:mm'),
                });
              }}
            />
          </Form.Item>
          <Form.Item name="startTime" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endTime" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="ໝາຍເຫດ" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
