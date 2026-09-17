import { useEffect, useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useList, useGetIdentity, useCreate, useUpdate, useDelete, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Typography, Space, Button, Modal, Form, TimePicker, Select } from 'antd';
import { LeftOutlined, RightOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { Employee, Shift, Identity } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';

type Cell =
  | { kind: 'unset' }
  | { kind: 'rest'; isOverride: boolean; overrideId?: string }
  | { kind: 'work'; start: string; end: string; isOverride: boolean; overrideId?: string };

function idOf(value: { _id: string } | string | undefined) {
  return value && typeof value === 'object' ? value._id : value;
}

// A linked category is a live reference (unlike Shift.category, a one-time
// prefill) — editing the category's time later shows up here immediately for
// every employee that references it. Falls back to a manually-set fixed time
// for an employee with no matching category.
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

function computeCell(employee: Employee, dateKey: string, override?: Shift): Cell {
  if (override) {
    if (override.status === 'rest') return { kind: 'rest', isOverride: true, overrideId: override._id };
    return { kind: 'work', start: override.startTime!, end: override.endTime!, isOverride: true, overrideId: override._id };
  }
  const dow = dayjs(dateKey).day();
  if (employee.defaultRestDay === dow) return { kind: 'rest', isOverride: false };
  const defaultTime = resolveDefaultTime(employee);
  if (defaultTime) return { kind: 'work', start: defaultTime.start, end: defaultTime.end, isOverride: false };
  return { kind: 'unset' };
}

const CELL_STYLE: Record<Cell['kind'], React.CSSProperties> = {
  unset: { background: 'var(--app-surface-bg)', border: '1px dashed var(--app-border-color, #d9d9d9)' },
  rest: { background: '#f9f0ff' },
  work: { background: 'transparent' },
};

export const MonthlySchedulePage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isManager = identity?.role === 'admin' || identity?.role === 'manager';

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const daysInMonth = monthStart.daysInMonth();
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, 'day')), [monthStart, daysInMonth]);
  const monthStartKey = monthStart.format('YYYY-MM-DD');
  const monthEndKey = monthStart.endOf('month').format('YYYY-MM-DD');

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = employeesData?.data ?? [];

  const { data: shiftsData, isLoading: shiftsLoading } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: monthStartKey },
      { field: 'date', operator: 'lte', value: monthEndKey },
    ],
    pagination: { pageSize: 3000 },
  });
  const shifts = shiftsData?.data ?? [];

  // Only 'scheduled'/'rest' shifts count as an override for this table — a
  // 'cancelled' one (from the position-based weekly schedule) isn't a rest-day
  // decision, so it's ignored here and the cell just falls back to the default.
  const overrideByEmpDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    for (const s of shifts) {
      if (s.status === 'cancelled') continue;
      map[`${idOf(s.employee)}_${s.date}`] = s;
    }
    return map;
  }, [shifts]);

  const [editing, setEditing] = useState<{ employee: Employee; dateKey: string } | null>(null);
  const editingOverride = editing ? overrideByEmpDate[`${editing.employee._id}_${editing.dateKey}`] : undefined;
  const editingCell = editing ? computeCell(editing.employee, editing.dateKey, editingOverride) : null;

  const [timeForm] = Form.useForm();
  useEffect(() => {
    if (!editing || !editingCell) return;
    timeForm.setFieldsValue({
      time: editingCell.kind === 'work' ? [dayjs(editingCell.start, 'HH:mm'), dayjs(editingCell.end, 'HH:mm')] : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const { mutate: createShift, isLoading: creating } = useCreate();
  const { mutate: updateShift, isLoading: updating } = useUpdate();
  const { mutate: deleteShift, isLoading: deleting } = useDelete();
  const { mutate: updateEmployee, isLoading: savingRestDay } = useUpdate();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const saving = creating || updating || deleting;

  // A recurring weekly rest day (Employee.defaultRestDay) — set once here and
  // it applies to every matching weekday automatically, this month and every
  // month after, with no per-day clicking and no Shift rows created at all.
  const [recurringRestFor, setRecurringRestFor] = useState<Employee | null>(null);
  const [recurringRestDay, setRecurringRestDay] = useState<number>();

  const openRecurringRest = (emp: Employee) => {
    setRecurringRestFor(emp);
    setRecurringRestDay(emp.defaultRestDay ?? undefined);
  };

  const saveRecurringRest = () => {
    if (!recurringRestFor) return;
    updateEmployee(
      { resource: 'employees', id: recurringRestFor._id, values: { defaultRestDay: recurringRestDay ?? null } },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
          setRecurringRestFor(null);
          invalidate({ resource: 'employees', invalidates: ['list'] });
        },
      }
    );
  };

  const closeModal = () => setEditing(null);
  const onSaved = () => {
    notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
    closeModal();
  };

  const upsertOverride = (values: Record<string, unknown>) => {
    if (editingOverride) {
      updateShift({ resource: 'shifts', id: editingOverride._id, values }, { onSuccess: onSaved });
    } else {
      createShift({ resource: 'shifts', values }, { onSuccess: onSaved });
    }
  };

  const handleSetRest = () => {
    if (!editing) return;
    upsertOverride({ employee: editing.employee._id, date: editing.dateKey, status: 'rest' });
  };

  const handleSaveTime = () => {
    if (!editing) return;
    const time = timeForm.getFieldValue('time') as [Dayjs, Dayjs] | undefined;
    if (!time) return;
    upsertOverride({
      employee: editing.employee._id,
      position: idOf(editing.employee.position),
      date: editing.dateKey,
      status: 'scheduled',
      startTime: time[0].format('HH:mm'),
      endTime: time[1].format('HH:mm'),
    });
  };

  const handleRevert = () => {
    if (!editingOverride) return;
    deleteShift({ resource: 'shifts', id: editingOverride._id }, { onSuccess: onSaved });
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ຕາຕະລາງວັນພັກ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space>
            <Button icon={<LeftOutlined />} onClick={() => setMonthStart(monthStart.subtract(1, 'month'))} />
            <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
            <Button icon={<RightOutlined />} onClick={() => setMonthStart(dayjs().startOf('month'))}>
              ເດືອນນີ້
            </Button>
            <Button icon={<RightOutlined />} onClick={() => setMonthStart(monthStart.add(1, 'month'))} />
          </Space>
          <Space size={16} wrap>
            <Space size={6}>
              <span style={{ width: 14, height: 14, background: '#f9f0ff', display: 'inline-block', borderRadius: 2 }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ວັນພັກ
              </Typography.Text>
            </Space>
            <Space size={6}>
              <span style={{ width: 14, height: 14, borderLeft: '3px solid #d46b08', display: 'inline-block' }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ແກ້ໄຂພິເສດ (ບໍ່ຄືປົກກະຕິ)
              </Typography.Text>
            </Space>
            <Space size={6}>
              <span
                style={{ width: 14, height: 14, background: 'var(--app-surface-bg)', border: '1px dashed #d9d9d9', display: 'inline-block' }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ຍັງບໍ່ຕັ້ງຄ່າປົກກະຕິ
              </Typography.Text>
            </Space>
          </Space>
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || shiftsLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
      >
        <Table.Column title="ລະຫັດ" fixed="left" width={90} dataIndex="employeeCode" />
        <Table.Column
          title="ໂມງວຽກ"
          fixed="left"
          width={110}
          render={(_, emp: Employee) => {
            const defaultTime = resolveDefaultTime(emp);
            return (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {defaultTime ? `${defaultTime.start}-${defaultTime.end}` : 'ຍັງບໍ່ຕັ້ງ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column
          title="ພະແນກ"
          fixed="left"
          width={110}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          fixed="left"
          width={130}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          fixed="left"
          width={165}
          render={(_, emp: Employee) => (
            <Space size={4}>
              <span>
                {emp.firstName} {emp.lastName}
              </span>
              {isManager && (
                <Button
                  size="small"
                  type="text"
                  icon={<CalendarOutlined />}
                  title="ຕັ້ງວັນພັກປະຈຳອາທິດ"
                  onClick={() => openRecurringRest(emp)}
                />
              )}
            </Space>
          )}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('D')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {day.format('ddd')}
                  </Typography.Text>
                </div>
              }
              width={72}
              render={(_, emp: Employee) => {
                const override = overrideByEmpDate[`${emp._id}_${dateKey}`];
                const cell = computeCell(emp, dateKey, override);
                return (
                  <div
                    onClick={() => isManager && setEditing({ employee: emp, dateKey })}
                    style={{
                      ...CELL_STYLE[cell.kind],
                      borderLeft: cell.kind !== 'unset' && cell.isOverride ? '3px solid #d46b08' : CELL_STYLE[cell.kind].borderLeft,
                      cursor: isManager ? 'pointer' : 'default',
                      minHeight: 40,
                      padding: '4px 6px',
                      textAlign: 'center',
                      fontSize: 11,
                      lineHeight: 1.3,
                      borderRadius: 2,
                    }}
                  >
                    {cell.kind === 'unset' && <span style={{ color: '#bfbfbf' }}>-</span>}
                    {cell.kind === 'rest' && <span style={{ color: '#722ed1' }}>ພັກ</span>}
                    {cell.kind === 'work' && (
                      <>
                        {cell.start}
                        <br />
                        {cell.end}
                      </>
                    )}
                  </div>
                );
              }}
            />
          );
        })}
      </Table>

      <Modal
        title={editing ? `${editing.employee.firstName} ${editing.employee.lastName} — ${dayjs(editing.dateKey).format('DD MMMM YYYY')}` : ''}
        open={!!editing}
        onCancel={closeModal}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {editingCell?.kind === 'rest' && `ປັດຈຸບັນ: ພັກ${editingCell.isOverride ? ' (ແກ້ໄຂພິເສດ)' : ' (ຄ່າປົກກະຕິ)'}`}
            {editingCell?.kind === 'work' &&
              `ປັດຈຸບັນ: ${editingCell.start}-${editingCell.end}${editingCell.isOverride ? ' (ແກ້ໄຂພິເສດ)' : ' (ຄ່າປົກກະຕິ)'}`}
            {editingCell?.kind === 'unset' && 'ປັດຈຸບັນ: ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ'}
          </Typography.Text>

          <Space>
            <Button onClick={handleSetRest} loading={saving}>
              ຕັ້ງເປັນວັນພັກ
            </Button>
            {editingOverride && (
              <Button onClick={handleRevert} loading={saving}>
                ຄືນຄ່າປົກກະຕິ
              </Button>
            )}
          </Space>

          <Form form={timeForm} layout="inline">
            <Form.Item name="time" label="ຫຼືກຳນົດເວລາເອງ">
              <TimePicker.RangePicker format="HH:mm" minuteStep={15} />
            </Form.Item>
            <Button type="primary" onClick={handleSaveTime} loading={saving}>
              ບັນທຶກເວລາ
            </Button>
          </Form>
        </Space>
      </Modal>

      <Modal
        title={recurringRestFor ? `ຕັ້ງວັນພັກປະຈຳອາທິດ — ${recurringRestFor.firstName} ${recurringRestFor.lastName}` : ''}
        open={!!recurringRestFor}
        onOk={saveRecurringRest}
        onCancel={() => setRecurringRestFor(null)}
        confirmLoading={savingRestDay}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ເລືອກວັນໃນອາທິດທີ່ຄົນນີ້ພັກປະຈຳ — ລະບົບຈະຕັ້ງເປັນວັນພັກໃຫ້ທຸກວັນນັ້ນອັດຕະໂນມັດ ທັງເດືອນນີ້ ແລະ ທຸກເດືອນຕໍ່ໄປ ໂດຍບໍ່ຕ້ອງກົດເລືອກທີລະວັນ
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          options={WEEKDAY_OPTIONS}
          allowClear
          placeholder="ບໍ່ມີວັນພັກປະຈຳ"
          value={recurringRestDay}
          onChange={(v) => setRecurringRestDay(v)}
        />
      </Modal>
    </List>
  );
};
