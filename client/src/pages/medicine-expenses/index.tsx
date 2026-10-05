import { useEffect, useMemo, useState } from 'react';
import { useModalForm, useSelect, List } from '@refinedev/antd';
import { useGetIdentity, useDelete, useInvalidate, useList, useNotification } from '@refinedev/core';
import { Table, Button, Modal, Form, Select, DatePicker, InputNumber, Input, Space, Typography, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Identity, MedicineExpense, Position } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter as withTextFilter } from '../../utils/selectFilters';

const { RangePicker: DateRangePicker } = DatePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

const employeeName = (v?: Employee | string) => (v && typeof v === 'object' ? `${v.firstName ?? ''} ${v.lastName ?? ''}` : '-');

const MedicineExpenseListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canWrite = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);
  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');

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

  const { data, isLoading, refetch } = useList<MedicineExpense>({
    resource: 'medicine-expenses',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    sorters: [{ field: 'date', order: 'desc' }],
    pagination: { pageSize: 2000 },
  });
  const allRows = data?.data ?? [];
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        const emp = typeof row.employee === 'object' ? row.employee : undefined;
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

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.employeeCode} - ${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { modalProps, formProps, show } = useModalForm<MedicineExpense>({ resource: 'medicine-expenses', action: 'create' });
  const submitCreate = (values: any) =>
    formProps.onFinish?.({
      ...values,
      billDate: values.billDate ? dayjs(values.billDate).toISOString() : undefined,
    });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    query: editQuery,
  } = useModalForm<MedicineExpense>({ resource: 'medicine-expenses', action: 'edit' });
  const submitEdit = (values: any) =>
    editFormProps.onFinish?.({
      ...values,
      date: values.date ? dayjs(values.date).toISOString() : undefined,
      billDate: values.billDate ? dayjs(values.billDate).toISOString() : undefined,
    });

  useEffect(() => {
    const record = editQuery?.data?.data;
    if (!record) return;
    editFormProps.form?.setFieldsValue({
      employee: idOf(record.employee),
      date: dayjs(record.date),
      billDate: record.billDate ? dayjs(record.billDate) : undefined,
      items: record.items,
      billAmount: record.billAmount,
      shopPayAmount: record.shopPayAmount,
      note: record.note,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery?.data?.data]);

  const { mutate: deleteExpense } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const refreshAll = () => {
    invalidate({ resource: 'medicine-expenses', invalidates: ['list'] });
    refetch();
  };

  const handleDelete = (id: string) => {
    deleteExpense(
      { resource: 'medicine-expenses', id },
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
    <List title="ຄ່າຢາ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
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
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>
              ເພີ່ມລາຍການຄ່າຢາ
            </Button>
          )}
        </Space>
      </div>

      <Table dataSource={rows} loading={isLoading} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ລະຫັດ"
          width={100}
          render={(_, record: MedicineExpense) => (typeof record.employee === 'object' ? record.employee?.employeeCode : undefined) || '-'}
        />
        <Table.Column title="ຊື່" width={160} render={(_, record: MedicineExpense) => employeeName(record.employee as Employee)} />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, record: MedicineExpense) => {
            const dept = typeof record.employee === 'object' ? record.employee?.department : undefined;
            return (dept && typeof dept === 'object' ? dept.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, record: MedicineExpense) => {
            const position = typeof record.employee === 'object' ? record.employee?.position : undefined;
            return (position && typeof position === 'object' ? position.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ອາຍຸງານ"
          width={130}
          render={(_, record: MedicineExpense) => {
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            if (!hireDate) return '-';
            const hasFullYear = dayjs().diff(dayjs(hireDate), 'year') >= 1;
            return (
              <div>
                <div style={{ fontSize: 12 }}>{dayjs(hireDate).format('DD/MM/YYYY')}</div>
                <Typography.Text type={hasFullYear ? 'success' : 'warning'} style={{ fontSize: 12 }}>
                  {hasFullYear ? 'ຄົບ 1 ປີ' : 'ຍັງບໍ່ຮອດ 1 ປີ'}
                </Typography.Text>
              </div>
            );
          }}
        />
        <Table.Column
          title="ວ.ດ.ປ /ບິນຢາ"
          width={120}
          render={(_, record: MedicineExpense) => (record.billDate ? dayjs(record.billDate).format('DD/MM/YYYY') : '-')}
        />
        <Table.Column title="ລາຍການ" dataIndex="items" width={200} ellipsis />
        <Table.Column
          title="ຍອດບີນຢາ"
          width={120}
          render={(_, record: MedicineExpense) => (record.billAmount ? record.billAmount.toLocaleString() : '-')}
        />
        <Table.Column
          title="ຮ້ານຕ້ອງຈ່າຍ"
          width={120}
          render={(_, record: MedicineExpense) =>
            record.shopPayAmount ? <Typography.Text strong>{record.shopPayAmount.toLocaleString()}</Typography.Text> : '-'
          }
        />
        <Table.Column title="ໝາຍເຫດ" dataIndex="note" width={150} ellipsis />
        {(canWrite || isAdmin) && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={100}
            render={(_, record: MedicineExpense) => (
              <Space>
                {canWrite && <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />}
                {isAdmin && (
                  <Popconfirm title="ຢືນຢັນລຶບລາຍການນີ້?" onConfirm={() => handleDelete(record._id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...modalProps} title="ເພີ່ມລາຍການຄ່າຢາ" afterClose={refreshAll}>
        <Form {...formProps} onFinish={submitCreate} layout="vertical">
          <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
            <Select {...withTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ວ.ດ.ປ /ບິນຢາ" name="billDate">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="ລາຍການ" name="items">
            <Input.TextArea rows={2} placeholder="ລາຍການຢາ / ຄ່າໃຊ້ຈ່າຍ" />
          </Form.Item>
          <Form.Item label="ຍອດບີນຢາ" name="billAmount">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="ຮ້ານຕ້ອງຈ່າຍ" name="shopPayAmount">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="ໝາຍເຫດ" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂລາຍການຄ່າຢາ" afterClose={refreshAll}>
        <Form {...editFormProps} onFinish={submitEdit} layout="vertical">
          <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
            <Select {...withTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
          </Form.Item>
          <Form.Item label="ວັນທີ່/ເດືອນ/ປີ" name="date" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ່' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="ວ.ດ.ປ /ບິນຢາ" name="billDate">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="ລາຍການ" name="items">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="ຍອດບີນຢາ" name="billAmount">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="ຮ້ານຕ້ອງຈ່າຍ" name="shopPayAmount">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="ໝາຍເຫດ" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};

export default MedicineExpenseListPage;
export { MedicineExpenseListPage };
