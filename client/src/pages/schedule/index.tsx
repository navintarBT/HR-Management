import { useEffect, useMemo, useState } from 'react';
import { List, useModalForm, useSelect } from '@refinedev/antd';
import { useList, useGetIdentity, useDelete, useNotification } from '@refinedev/core';
import { Table, Tag, Space, Button, Typography, Modal, Form, Select, DatePicker, TimePicker, Input, Popconfirm } from 'antd';
import { LeftOutlined, RightOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, Position, Shift, ShiftCategory, Identity } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { RequestSwapModal } from './RequestSwapModal';
import { categorical } from '../../theme/palette';

const colorForId = (id: string) => categorical[id.charCodeAt(id.length - 1) % categorical.length];

function mondayOf(d: dayjs.Dayjs) {
  const dow = d.day(); // 0 = Sun .. 6 = Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return d.add(diffToMonday, 'day').startOf('day');
}

const withTextFilter = (selectProps: any) => ({
  ...selectProps,
  onSearch: undefined,
  filterOption: (input: string, option: any) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase()),
  showSearch: true,
});

// Shared between the create and edit shift modals — only the Form/formProps wrapping differs.
const ShiftFormItems: React.FC<{
  employeeSelectProps: any;
  positionSelectProps: any;
  categorySelectProps: any;
  onCategoryChange: (categoryId?: any) => void;
}> = ({ employeeSelectProps, positionSelectProps, categorySelectProps, onCategoryChange }) => (
  <>
    <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
      <Select {...employeeSelectProps} placeholder="ເລືອກພະນັກງານ" />
    </Form.Item>
    <Form.Item label="ຕໍາແໜ່ງ" name="position" rules={[{ required: true, message: 'ກະລຸນາເລືອກຕໍາແໜ່ງ' }]}>
      <Select {...positionSelectProps} placeholder="ເລືອກຕໍາແໜ່ງ" />
    </Form.Item>
    <Form.Item label="ວັນທີ" name="date" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ' }]}>
      <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
    </Form.Item>
    <Form.Item label="ໝວດໝູ່ກະ (ຕັ້ງເວລາອັດຕະໂນມັດ, ບໍ່ບັງຄັບ)" name="category">
      <Select {...categorySelectProps} placeholder="ເລືອກໝວດໝູ່ (ຫຼືຂ້າມໄປຕັ້ງເວລາເອງ)" allowClear onChange={onCategoryChange} />
    </Form.Item>
    <Form.Item label="ເວລາ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກເວລາ' }]}>
      <TimePicker.RangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
    </Form.Item>
    <Form.Item label="ໝາຍເຫດ" name="note">
      <Input placeholder="ບໍ່ບັງຄັບ" />
    </Form.Item>
  </>
);

const buildShiftPayload = (values: any) => {
  const date = dayjs(values.date).format('YYYY-MM-DD');
  const [startTime, endTime] = values.time.map((t: any) => t.format('HH:mm'));
  return {
    employee: values.employee,
    position: values.position,
    category: values.category || undefined,
    date,
    startTime,
    endTime,
    note: values.note,
  };
};

export const SchedulePage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isManager = identity?.role === 'admin' || identity?.role === 'manager';
  const myEmployeeId = identity?.employee?._id;

  const [weekStart, setWeekStart] = useState(() => mondayOf(dayjs()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day')), [weekStart]);
  const weekStartKey = weekStart.format('YYYY-MM-DD');
  const weekEndKey = weekStart.add(6, 'day').format('YYYY-MM-DD');

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 200 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = employeesData?.data ?? [];

  const { data: shiftsData, isLoading: shiftsLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: weekStartKey },
      { field: 'date', operator: 'lte', value: weekEndKey },
    ],
    pagination: { pageSize: 500 },
  });
  const shifts = shiftsData?.data ?? [];

  const shiftsByEmpDate = useMemo(() => {
    const map: Record<string, Record<string, Shift[]>> = {};
    for (const s of shifts) {
      const empId = typeof s.employee === 'object' ? s.employee._id : s.employee;
      map[empId] = map[empId] || {};
      map[empId][s.date] = map[empId][s.date] || [];
      map[empId][s.date].push(s);
    }
    return map;
  }, [shifts]);

  // --- shift create/edit modals (admin/manager only) ---
  // Two separate useModalForm instances: refine's `action` is fixed at hook-creation
  // time, so passing an id to show() on a "create" instance never fetches or updates
  // the record — it silently stays in create mode (would POST a duplicate on submit).
  const {
    modalProps: createModalProps,
    formProps: createFormProps,
    form: createForm,
    show: showCreate,
    formLoading: createFormLoading,
  } = useModalForm<Shift>({
    resource: 'shifts',
    action: 'create',
  });
  const [pendingDefaults, setPendingDefaults] = useState<{ employeeId: string; dateKey: string } | null>(null);

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    form: editForm,
    query: editQuery,
    show: showEdit,
    formLoading: editFormLoading,
  } = useModalForm<Shift>({
    resource: 'shifts',
    action: 'edit',
  });
  const editingRecord = editQuery?.data?.data;

  const { mutate: deleteShift, isLoading: deleting } = useDelete();
  const { open: notify } = useNotification();

  useEffect(() => {
    if (!createModalProps.open || !pendingDefaults) return;
    createForm.setFieldsValue({ employee: pendingDefaults.employeeId, date: dayjs(pendingDefaults.dateKey) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createModalProps.open, pendingDefaults]);

  useEffect(() => {
    if (!editModalProps.open || !editingRecord) return;
    editForm.setFieldsValue({
      employee: typeof editingRecord.employee === 'object' ? editingRecord.employee._id : editingRecord.employee,
      position: typeof editingRecord.position === 'object' ? editingRecord.position._id : editingRecord.position,
      category: typeof editingRecord.category === 'object' ? editingRecord.category?._id : editingRecord.category,
      date: dayjs(editingRecord.date),
      time: [dayjs(`${editingRecord.date} ${editingRecord.startTime}`), dayjs(`${editingRecord.date} ${editingRecord.endTime}`)],
      note: editingRecord.note,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModalProps.open, editingRecord]);

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { selectProps: positionSelect } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
  });

  const { data: categoriesData } = useList<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 100 },
  });
  const categories = categoriesData?.data ?? [];
  const { selectProps: categorySelect } = useSelect<ShiftCategory>({
    resource: 'shift-categories',
    optionLabel: (item) => `${item.name} (${item.startTime}-${item.endTime})`,
    optionValue: '_id',
    pagination: { pageSize: 100, mode: 'server' },
  });

  const applyCategoryTime = (formInstance: typeof createForm, categoryId?: any) => {
    const category = categories.find((c) => c._id === categoryId);
    if (category) {
      formInstance.setFieldsValue({ time: [dayjs(category.startTime, 'HH:mm'), dayjs(category.endTime, 'HH:mm')] });
    }
  };

  const openCreate = (employeeId: string, dateKey: string) => {
    setPendingDefaults({ employeeId, dateKey });
    showCreate();
  };

  const openEdit = (shiftId: string) => {
    showEdit(shiftId);
  };

  const handleDeleteCurrent = () => {
    if (!editingRecord) return;
    deleteShift(
      { resource: 'shifts', id: editingRecord._id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບກະສໍາເລັດ' });
          (editModalProps.onCancel as any)?.();
        },
      }
    );
  };

  // --- swap request modal (employee's own shift) ---
  const [swapShift, setSwapShift] = useState<Shift | null>(null);

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ຕາຕະລາງກະ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space>
          <Button icon={<LeftOutlined />} onClick={() => setWeekStart(weekStart.subtract(7, 'day'))} />
          <Typography.Text strong>
            {weekStart.format('DD MMM')} - {weekStart.add(6, 'day').format('DD MMM YYYY')}
          </Typography.Text>
          <Button icon={<RightOutlined />} onClick={() => setWeekStart(mondayOf(dayjs()))}>
            ອາທິດນີ້
          </Button>
          <Button icon={<RightOutlined />} onClick={() => setWeekStart(weekStart.add(7, 'day'))} />
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || shiftsLoading}
        pagination={false}
        scroll={{ x: true }}
        sticky={{ offsetHeader }}
      >
        <Table.Column
          title="ພະນັກງານ"
          fixed="left"
          width={180}
          render={(_, emp: Employee) => (
            <div>
              <div style={{ fontWeight: 500 }}>
                {emp.firstName} {emp.lastName}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {typeof emp.position === 'object' ? emp.position?.name : ''}
              </Typography.Text>
            </div>
          )}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('ddd')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {day.format('DD/MM')}
                  </Typography.Text>
                </div>
              }
              width={150}
              render={(_, emp: Employee) => {
                const cellShifts = shiftsByEmpDate[emp._id]?.[dateKey] ?? [];
                const isSelf = emp._id === myEmployeeId;
                return (
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {cellShifts.map((s) => (
                      <Tag
                        key={s._id}
                        color={colorForId(typeof s.position === 'object' ? s.position._id : s.position)}
                        style={{ cursor: isManager || isSelf ? 'pointer' : 'default', whiteSpace: 'normal', margin: 0 }}
                        onClick={() => {
                          if (isManager) openEdit(s._id);
                          else if (isSelf) setSwapShift(s);
                        }}
                      >
                        {typeof s.position === 'object' ? s.position?.name : ''}
                        <br />
                        {s.startTime}-{s.endTime}
                      </Tag>
                    ))}
                    {isManager && (
                      <Button type="dashed" size="small" block icon={<PlusOutlined />} onClick={() => openCreate(emp._id, dateKey)} />
                    )}
                  </Space>
                );
              }}
            />
          );
        })}
      </Table>

      <Modal {...createModalProps} title="ເພີ່ມກະ" confirmLoading={createFormLoading} destroyOnClose>
        <Form
          {...createFormProps}
          form={createForm}
          layout="vertical"
          onFinish={(values: any) => createFormProps.onFinish?.(buildShiftPayload(values))}
        >
          <ShiftFormItems
            employeeSelectProps={withTextFilter(employeeSelect)}
            positionSelectProps={positionSelect}
            categorySelectProps={categorySelect}
            onCategoryChange={(id) => applyCategoryTime(createForm, id)}
          />
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂກະ" confirmLoading={editFormLoading} destroyOnClose>
        <Form
          {...editFormProps}
          form={editForm}
          layout="vertical"
          onFinish={(values: any) => editFormProps.onFinish?.(buildShiftPayload(values))}
        >
          <ShiftFormItems
            employeeSelectProps={withTextFilter(employeeSelect)}
            positionSelectProps={positionSelect}
            categorySelectProps={categorySelect}
            onCategoryChange={(id) => applyCategoryTime(editForm, id)}
          />
        </Form>
        {editingRecord && (
          <Popconfirm title="ຢືນຢັນລຶບກະນີ້?" onConfirm={handleDeleteCurrent}>
            <Button danger loading={deleting}>
              ລຶບກະນີ້
            </Button>
          </Popconfirm>
        )}
      </Modal>

      <RequestSwapModal
        open={!!swapShift}
        onClose={() => setSwapShift(null)}
        initialShiftId={swapShift?._id}
        initialShiftLabel={
          swapShift ? `${dayjs(swapShift.date).format('DD/MM/YYYY')} ${swapShift.startTime}-${swapShift.endTime}` : undefined
        }
      />
    </List>
  );
};
