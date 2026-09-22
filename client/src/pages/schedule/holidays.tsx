import { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useGetIdentity, useInvalidate, useNotification, useList, useDelete } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, DatePicker, Space, Typography, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { Employee, Holiday, Identity } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { applyRestDayToAll } from '../../utils/holidayShifts';

const { RangePicker } = DatePicker;

// A separate resource (not just another bulk-edit action) specifically so
// each closed day can carry WHY it's closed — an occasion name — rather than
// just being an unexplained "rest" row on everyone's schedule.
export const HolidayListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canWrite = identity?.role === 'admin' || identity?.role === 'manager';

  // Fetched unpaginated (a holiday list is never huge) so the month nav and
  // custom range below can both filter client-side, matching the pattern
  // used on the attendance report pages.
  const { data: holidaysData, isLoading } = useList<Holiday>({
    resource: 'holidays',
    pagination: { pageSize: 500 },
    sorters: [{ field: 'date', order: 'asc' }],
  });
  const allHolidays = holidaysData?.data ?? [];

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const goToMonth = (m: Dayjs) => {
    setCustomRange(null);
    setMonthStart(m.startOf('month'));
  };

  const filterRange = customRange ?? [monthStart, monthStart.endOf('month')];
  const holidays = useMemo(
    () => allHolidays.filter((h) => !dayjs(h.date).isBefore(filterRange[0], 'day') && !dayjs(h.date).isAfter(filterRange[1], 'day')),
    [allHolidays, filterRange]
  );

  const { data: employeesData } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
  });
  const activeEmployees = employeesData?.data ?? [];

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const { mutate: deleteHoliday } = useDelete();

  const [createOpen, setCreateOpen] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submitCreate = async () => {
    if (!range || !name.trim()) return;
    const [rangeStart, rangeEnd] = range;
    const dates: string[] = [];
    for (let d = rangeStart.startOf('day'); !d.isAfter(rangeEnd, 'day'); d = d.add(1, 'day')) {
      dates.push(d.format('YYYY-MM-DD'));
    }
    setSaving(true);
    try {
      let holidayFails = 0;
      let shiftFails = 0;
      let shiftTotal = 0;
      for (const dateStr of dates) {
        // eslint-disable-next-line no-await-in-loop
        const created = await axiosInstance.post(`${API_URL}/holidays`, { date: dateStr, name: name.trim() }).catch(() => null);
        if (!created) {
          holidayFails++;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const results = await applyRestDayToAll(dateStr, activeEmployees, created.data._id);
        shiftTotal += results.length;
        shiftFails += results.filter((r) => r.status === 'rejected').length;
      }
      const holidayOk = dates.length - holidayFails;
      notify?.({
        type: holidayFails ? 'error' : 'success',
        message: `ຕັ້ງວັນພັກຮ້ານສຳເລັດ ${holidayOk}/${dates.length} ວັນ (${shiftTotal - shiftFails}/${shiftTotal} ຄົນຖືກຕັ້ງວັນພັກ)${
          holidayFails ? ' — ບາງວັນອາດຊ້ຳກັບວັນພັກທີ່ຕັ້ງໄວ້ແລ້ວ' : ''
        }`,
      });
      if (holidayOk > 0) {
        setCreateOpen(false);
        setRange(null);
        setName('');
        invalidate({ resource: 'holidays', invalidates: ['list'] });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteHoliday(
      { resource: 'holidays', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ — ວັນພັກຂອງພະນັກງານທີ່ຕັ້ງໄວ້ໃນວັນນັ້ນຖືກຍົກເລີກນຳ' });
          invalidate({ resource: 'holidays', invalidates: ['list'] });
        },
        onError: () => notify?.({ type: 'error', message: 'ລຶບບໍ່ສຳເລັດ' }),
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ວັນພັກຮ້ານ"
      breadcrumb={false}
      headerButtons={
        canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            ເພີ່ມວັນພັກຮ້ານ
          </Button>
        ) : (
          <></>
        )
      }
    >
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap>
          <Button icon={<LeftOutlined />} onClick={() => goToMonth(monthStart.subtract(1, 'month'))} />
          <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
          <Button icon={<RightOutlined />} onClick={() => goToMonth(monthStart.add(1, 'month'))} />
          <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
          <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
          <RangePicker
            value={customRange}
            onChange={(v) => setCustomRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
            format="DD/MM/YYYY"
            allowClear
          />
        </Space>
      </div>

      <Table
        dataSource={holidays}
        loading={isLoading}
        rowKey="_id"
        pagination={false}
        sticky={{ offsetHeader }}
        locale={{ emptyText: 'ບໍ່ມີວັນພັກຮ້ານໃນຊ່ວງນີ້' }}
      >
        <Table.Column title="ວັນທີ" dataIndex="date" width={140} render={(v) => dayjs(v).format('DD MMMM YYYY')} />
        <Table.Column title="ໂອກາດ" dataIndex="name" />
        {canWrite && (
          <Table.Column
            title="ຈັດການ"
            width={80}
            render={(_, record: Holiday) => (
              <Popconfirm title="ລຶບວັນພັກຮ້ານນີ້?" onConfirm={() => handleDelete(record._id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          />
        )}
      </Table>

      <Modal
        title="ເພີ່ມວັນພັກຮ້ານ"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        confirmLoading={saving}
        okText="ຕັ້ງວັນພັກ"
        okButtonProps={{ disabled: !range || !name.trim() }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຈະຕັ້ງເປັນວັນພັກໃຫ້ພະນັກງານທີ່ active ທຸກຄົນພ້ອມກັນ — ກະທີ່ວາງແຜນໄວ້ແລ້ວໃນວັນນັ້ນຈະຖືກປ່ຽນເປັນວັນພັກແທນ. ເລືອກຫຼາຍວັນໄດ້ (ເຊັ່ນ: ວັນນັກຂັດຖະລືກ 3 ມື້) — ແຕ່ລະວັນຈະຖືກບັນທຶກແຍກກັນ ໂດຍໃຊ້ຊື່ໂອກາດດຽວກັນ
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="ວັນທີ" required>
            <RangePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              value={range}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
            />
          </Form.Item>
          <Form.Item label="ໂອກາດ (ເຫດຜົນ)" required>
            <Input placeholder="ຕົວຢ່າງ: ວັນປີໃໝ່, ວັນສົງການ" value={name} onChange={(e) => setName(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};
