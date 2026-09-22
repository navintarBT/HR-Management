import { useEffect, useMemo, useState } from 'react';
import { List, useModalForm, useSelect } from '@refinedev/antd';
import { useGetIdentity, useDelete, useInvalidate, useNotification, useList } from '@refinedev/core';
import { Table, Button, Modal, Form, DatePicker, Input, InputNumber, Select, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, Identity, Leave } from '../../types';
import { LeaveStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter } from '../../utils/selectFilters';

const { RangePicker } = DatePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

function hasCompletedOneYear(hireDate?: string) {
  return !!hireDate && dayjs().diff(dayjs(hireDate), 'year') >= 1;
}

export const LeaveListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canApprove = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const [search, setSearch] = useState('');

  // Fetched unpaginated (a leave list is never huge) so the month view and the
  // code/name search below can both filter client-side — matching the pattern
  // used on the attendance report pages.
  const { data: leavesData, isLoading } = useList<Leave>({
    resource: 'leaves',
    pagination: { pageSize: 2000, mode: 'server' },
    sorters: [{ field: 'startDate', order: 'desc' }],
  });
  const allLeaves = leavesData?.data ?? [];

  const monthKey = monthStart.format('YYYY-MM');
  const leaves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLeaves.filter((l) => {
      if (dayjs(l.startDate).format('YYYY-MM') !== monthKey) return false;
      if (q) {
        const emp = typeof l.employee === 'object' ? l.employee : undefined;
        const name = `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.toLowerCase();
        const code = (emp?.employeeCode ?? '').toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      return true;
    });
  }, [allLeaves, monthKey, search]);

  // ລາໄປແລ້ວຈັກມື້ / ລວມທັງໝົດ — both read from every APPROVED leave an employee
  // has this YEAR, independent of whichever month is currently being viewed
  // above (the annual balance doesn't reset just because the list is filtered
  // to one month). Uses billableDays (server-computed, excludes any day in
  // the request that lands on the employee's own rest day) rather than the
  // raw date span — a rest day was never really taken off work, so it
  // shouldn't eat into the annual leave quota either.
  const usedDaysByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of allLeaves) {
      if (l.status !== 'approved') continue;
      if (dayjs(l.startDate).year() !== monthStart.year()) continue;
      const empId = idOf(l.employee);
      if (!empId) continue;
      const days = l.billableDays ?? dayjs(l.endDate).diff(dayjs(l.startDate), 'day') + 1;
      map[empId] = (map[empId] ?? 0) + days;
    }
    return map;
  }, [allLeaves, monthStart]);

  const { modalProps, formProps, show } = useModalForm<Leave>({
    resource: 'leaves',
    action: 'create',
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    query: editQuery,
  } = useModalForm<Leave>({
    resource: 'leaves',
    action: 'edit',
  });

  // "range" is a UI-only field (the RangePicker) with no matching path on the
  // record, so useModalForm's own auto-fill can't populate it — set it (and
  // the hidden startDate/endDate it drives) manually once the record loads.
  useEffect(() => {
    const record = editQuery?.data?.data;
    if (!record) return;
    editFormProps.form?.setFieldsValue({
      range: [dayjs(record.startDate), dayjs(record.endDate)],
      startDate: record.startDate,
      endDate: record.endDate,
      reason: record.reason,
      deductAmount: record.deductAmount ?? undefined,
      deductNote: record.deductNote ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery?.data?.data]);

  // Only an admin/manager filing a request on someone else's behalf needs to
  // pick who it's for — a plain "employee" role user's own id is filled in
  // automatically server-side, so they never see this field.
  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.employeeCode} - ${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { mutate: deleteLeave } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  // No confirm dialog — only an admin can even see this button, and an admin
  // account is itself the trust boundary here.
  const handleDelete = (id: string) => {
    deleteLeave(
      { resource: 'leaves', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          invalidate({ resource: 'leaves', invalidates: ['list'] });
        },
        onError: () => notify?.({ type: 'error', message: 'ລຶບບໍ່ສຳເລັດ' }),
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ລາຍການຄໍາຂໍລາ"
      breadcrumb={false}
      headerButtons={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>
          ຂໍລາ
        </Button>
      }
    >
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap>
          <Button icon={<LeftOutlined />} onClick={() => setMonthStart(monthStart.subtract(1, 'month'))} />
          <Button onClick={() => setMonthStart(dayjs().startOf('month'))}>ເດືອນນີ້</Button>
          <Button icon={<RightOutlined />} onClick={() => setMonthStart(monthStart.add(1, 'month'))} />
          <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(v) => setSearch(v)}
            onChange={(e) => !e.target.value && setSearch('')}
          />
        </Space>
      </div>

      <Table dataSource={leaves} loading={isLoading} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ລະຫັດ"
          width={110}
          fixed="left"
          render={(_, record: Leave) => (typeof record.employee === 'object' ? record.employee?.deviceUserId : undefined) || '-'}
        />
        <Table.Column
          title="ຊື່"
          width={160}
          fixed="left"
          render={(_, record: Leave) =>
            record.employee && typeof record.employee === 'object'
              ? `${(record.employee as Employee).firstName ?? ''} ${(record.employee as Employee).lastName ?? ''}`
              : '-'
          }
        />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, record: Leave) => {
            const dept = typeof record.employee === 'object' ? record.employee?.department : undefined;
            return (dept && typeof dept === 'object' ? dept.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={130}
          render={(_, record: Leave) => {
            const position = typeof record.employee === 'object' ? record.employee?.position : undefined;
            return (position && typeof position === 'object' ? position.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ເລີ່ມເຮັດວຽກຕັ້ງແຕ່"
          width={140}
          render={(_, record: Leave) => {
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            return hireDate ? dayjs(hireDate).format('DD/MM/YYYY') : '-';
          }}
        />
        <Table.Column
          title="ເຮັດວຽກໄດ້ຈັກມື້ແລ້ວ"
          width={140}
          render={(_, record: Leave) => {
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            if (!hireDate) return '-';
            const hasFullYear = hasCompletedOneYear(hireDate);
            return (
              <Typography.Text type={hasFullYear ? 'success' : 'warning'}>
                {hasFullYear ? 'ຄົບ 1 ປີ' : 'ຍັງບໍ່ຮອດ 1 ປີ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column title="ເຫດຜົນທີ່ລາ" dataIndex="reason" width={180} ellipsis />
        <Table.Column title="ວັນທີລາ" width={110} render={(_, record: Leave) => dayjs(record.startDate).format('DD/MM/YYYY')} />
        <Table.Column title="ຫາວັນທີ" width={110} render={(_, record: Leave) => dayjs(record.endDate).format('DD/MM/YYYY')} />
        <Table.Column
          title="ເຂົ້າວຽກປົກກະຕິ"
          width={130}
          render={(_, record: Leave) => dayjs(record.endDate).add(1, 'day').format('DD/MM/YYYY')}
        />
        <Table.Column
          title="ລາຈັກມື້"
          width={100}
          render={(_, record: Leave) => `${dayjs(record.endDate).diff(dayjs(record.startDate), 'day') + 1} ມື້`}
        />
        <Table.Column
          title="ລາໄປແລ້ວຈັກມື້"
          width={130}
          render={(_, record: Leave) => {
            // Counts against the formal annual entitlement only once the
            // employee has actually earned it (1 year of service) — before
            // that, leave taken still counts toward ລວມທັງໝົດ/ຍັງຈັກມື້ for
            // planning, but doesn't show here yet.
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            const used = hasCompletedOneYear(hireDate) ? usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0 : 0;
            return `${used} ມື້`;
          }}
        />
        <Table.Column
          title="ລວມທັງໝົດ"
          width={110}
          render={(_, record: Leave) => `${usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0} ມື້`}
        />
        <Table.Column
          title="ຍັງຈັກມື້"
          width={100}
          render={(_, record: Leave) => {
            const total = typeof record.employee === 'object' ? record.employee?.annualLeaveDays : undefined;
            if (total == null) return '-';
            const used = usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0;
            const remaining = total - used;
            return <Typography.Text type={remaining < 0 ? 'danger' : undefined}>{remaining} ມື້</Typography.Text>;
          }}
        />
        <Table.Column
          title="ມື້ທີ່ຕ້ອງຕັດເງີນ x1"
          width={140}
          render={(_, record: Leave) => (record.deductDaysX1 != null ? `${record.deductDaysX1} ມື້` : '-')}
        />
        <Table.Column
          title="ປ"
          width={140}
          render={(_, record: Leave) => (record.deductDaysX2 != null ? `${record.deductDaysX2} ມື້` : '-')}
        />
        <Table.Column
          title="ຕັດເງີນຈັກເທົ່າ"
          width={130}
          render={(_, record: Leave) => (record.deductAmount != null ? record.deductAmount.toLocaleString() : '-')}
        />
        <Table.Column title="ຫມາຍເຫດ" dataIndex="deductNote" width={160} ellipsis render={(v) => v || '-'} />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(v) => <LeaveStatusTag status={v} />} />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={120}
            render={(_, record: Leave) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record._id)} />
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...modalProps} title="ຂໍລາງານ">
        <Form {...formProps} layout="vertical">
          {canApprove && (
            <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
              <Select {...withLocalTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
            </Form.Item>
          )}
          <Form.Item label="ຊ່ວງວັນທີລາ" name="range" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ' }]}>
            <RangePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              onChange={(dates) => {
                formProps.form?.setFieldsValue({
                  startDate: dates?.[0]?.toISOString(),
                  endDate: dates?.[1]?.toISOString(),
                });
              }}
            />
          </Form.Item>
          <Form.Item name="startDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={3} placeholder="ລະບຸເຫດຜົນການລາ (ຖ້າມີ)" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂຄໍາຂໍລາ">
        <Form {...editFormProps} layout="vertical">
          <Form.Item label="ຊ່ວງວັນທີລາ" name="range" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ' }]}>
            <RangePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              onChange={(dates) => {
                editFormProps.form?.setFieldsValue({
                  startDate: dates?.[0]?.toISOString(),
                  endDate: dates?.[1]?.toISOString(),
                });
              }}
            />
          </Form.Item>
          <Form.Item name="startDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={3} placeholder="ລະບຸເຫດຜົນການລາ (ຖ້າມີ)" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            "ມື້ທີ່ຕ້ອງຕັດເງີນ x1" ແລະ "ປ" ຄຳນວນອັດຕະໂນມັດຈາກວັນທີ່ລາ (ບໍ່ນັບວັນພັກຂອງພະນັກງານ) — ແກ້ໄຂໄດ້ສະເພາະຈຳນວນເງິນ ແລະ ໝາຍເຫດ
          </Typography.Paragraph>
          <Form.Item
            label="ຕັດເງີນຈັກເທົ່າ"
            name="deductAmount"
            tooltip="ຄິດໃຫ້ອັດຕະໂນມັດຈາກເງິນເດືອນ ÷ 30 ຄູນມື້ທີ່ຕ້ອງຕັດ x1 — ພິມຕົວເລກເອງທີ່ນີ້ເພື່ອໃຊ້ແທນຄ່າທີ່ຄິດໃຫ້"
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="ຈຳນວນເງິນ (ຄິດໃຫ້ອັດຕະໂນມັດຖ້າບໍ່ພິມ)"
              formatter={(v) => (v != null ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '')}
              parser={(v) => (v ? Number(v.replace(/,/g, '')) : (0 as any))}
            />
          </Form.Item>
          <Form.Item label="ຫມາຍເຫດ" name="deductNote">
            <Input.TextArea rows={2} placeholder="ຫມາຍເຫດກ່ຽວກັບການຕັດເງີນ (ຖ້າມີ)" />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};
