import { useState } from 'react';
import { List, useTable } from '@refinedev/antd';
import { useGetIdentity, useCustomMutation, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Popconfirm, Typography } from 'antd';
import { PlusOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { Employee, Identity, Shift, ShiftSwapRequest } from '../../types';
import { ShiftSwapStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { RequestSwapModal } from './RequestSwapModal';

const employeeName = (v?: Employee | string) => (v && typeof v === 'object' ? `${v.firstName} ${v.lastName}` : '-');

const shiftLabel = (v?: Shift | string) => {
  if (!v || typeof v !== 'object') return '-';
  const position = typeof v.position === 'object' ? v.position?.name : '';
  return `${dayjs(v.date).format('DD/MM/YYYY')} ${v.startTime}-${v.endTime} (${position})`;
};

export const ShiftSwapListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canApprove = identity?.role === 'admin' || identity?.role === 'manager';
  const [createOpen, setCreateOpen] = useState(false);

  const { tableProps } = useTable<ShiftSwapRequest>({
    resource: 'shift-swaps',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
  });

  const { mutate } = useCustomMutation();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const decide = (id: string, decision: 'approve' | 'reject') => {
    mutate(
      { url: `${API_URL}/shift-swaps/${id}/${decision}`, method: 'patch', values: {} },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: decision === 'approve' ? 'ອະນຸມັດການສະຫຼັບກະແລ້ວ' : 'ປະຕິເສດການສະຫຼັບກະແລ້ວ' });
          invalidate({ resource: 'shift-swaps', invalidates: ['list'] });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
        },
        onError: (err: any) => notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສໍາເລັດ' }),
      }
    );
  };

  const { offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ຄໍາຂໍສະຫຼັບກະ"
      breadcrumb={false}
      headerButtons={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          ຂໍສະຫຼັບກະ
        </Button>
      }
    >
      <Table {...tableProps} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column title="ຜູ້ຂໍ" width={150} render={(_, record: ShiftSwapRequest) => employeeName(record.requestedBy as Employee)} />
        <Table.Column
          title="ກະທີ່ຂໍສະຫຼັບ"
          width={220}
          render={(_, record: ShiftSwapRequest) => shiftLabel(record.fromShift as Shift)}
        />
        <Table.Column
          title="ໃຫ້ / ແລກກັບ"
          width={200}
          render={(_, record: ShiftSwapRequest) => (
            <div>
              <div>{employeeName(record.toEmployee as Employee)}</div>
              {record.toShift ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ແລກກັບ: {shiftLabel(record.toShift as Shift)}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ມອບກະໃຫ້
                </Typography.Text>
              )}
            </div>
          )}
        />
        <Table.Column title="ເຫດຜົນ" dataIndex="reason" width={180} ellipsis />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(v) => <ShiftSwapStatusTag status={v} />} />
        <Table.Column
          title="ຜູ້ອະນຸມັດ"
          width={150}
          render={(_, record: ShiftSwapRequest) => employeeName(record.approver as Employee)}
        />
        {canApprove && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={140}
            render={(_, record: ShiftSwapRequest) =>
              record.status === 'pending' ? (
                <Space>
                  <Popconfirm title="ຢືນຢັນອະນຸມັດການສະຫຼັບກະນີ້?" onConfirm={() => decide(record._id, 'approve')}>
                    <Button size="small" icon={<CheckOutlined />} type="primary" ghost />
                  </Popconfirm>
                  <Popconfirm title="ຢືນຢັນປະຕິເສດການສະຫຼັບກະນີ້?" onConfirm={() => decide(record._id, 'reject')}>
                    <Button size="small" icon={<CloseOutlined />} danger />
                  </Popconfirm>
                </Space>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              )
            }
          />
        )}
      </Table>

      <RequestSwapModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </List>
  );
};
