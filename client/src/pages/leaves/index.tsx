import { List, useTable, useModalForm } from '@refinedev/antd';
import { useGetIdentity, useCustomMutation, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Modal, Form, Select, DatePicker, Input, Space, Popconfirm, Typography } from 'antd';
import { PlusOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { Employee, Identity, Leave } from '../../types';
import { LeaveStatusTag, LeaveTypeTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker } = DatePicker;

export const LeaveListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canApprove = identity?.role === 'admin' || identity?.role === 'manager';

  const { tableProps } = useTable<Leave>({
    resource: 'leaves',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
  });

  const { modalProps, formProps, show } = useModalForm<Leave>({
    resource: 'leaves',
    action: 'create',
  });

  const { mutate } = useCustomMutation();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const decide = (id: string, decision: 'approve' | 'reject') => {
    mutate(
      { url: `${API_URL}/leaves/${id}/${decision}`, method: 'patch', values: {} },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: decision === 'approve' ? 'ອະນຸມັດຄໍາຂໍລາແລ້ວ' : 'ປະຕິເສດຄໍາຂໍລາແລ້ວ' });
          invalidate({ resource: 'leaves', invalidates: ['list'] });
        },
        onError: () => notify?.({ type: 'error', message: 'ດໍາເນີນການບໍ່ສໍາເລັດ' }),
      }
    );
  };

  const { offsetHeader } = useTableStickyOffset();

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
      <Table {...tableProps} rowKey="_id" scroll={{ x: true }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ພະນັກງານ"
          render={(_, record: Leave) =>
            typeof record.employee === 'object' ? `${(record.employee as Employee).firstName} ${(record.employee as Employee).lastName}` : '-'
          }
        />
        <Table.Column title="ປະເພດ" dataIndex="type" render={(v) => <LeaveTypeTag type={v} />} />
        <Table.Column
          title="ຊ່ວງວັນທີລາ"
          render={(_, record: Leave) =>
            `${dayjs(record.startDate).format('DD/MM/YYYY')} - ${dayjs(record.endDate).format('DD/MM/YYYY')}`
          }
        />
        <Table.Column title="ເຫດຜົນ" dataIndex="reason" ellipsis />
        <Table.Column title="ສະຖານະ" dataIndex="status" render={(v) => <LeaveStatusTag status={v} />} />
        <Table.Column
          title="ຜູ້ອະນຸມັດ"
          render={(_, record: Leave) =>
            typeof record.approver === 'object' && record.approver
              ? `${(record.approver as Employee).firstName} ${(record.approver as Employee).lastName}`
              : '-'
          }
        />
        {canApprove && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={140}
            render={(_, record: Leave) =>
              record.status === 'pending' ? (
                <Space>
                  <Popconfirm title="ຢືນຢັນອະນຸມັດຄໍາຂໍລານີ້?" onConfirm={() => decide(record._id, 'approve')}>
                    <Button size="small" icon={<CheckOutlined />} type="primary" ghost />
                  </Popconfirm>
                  <Popconfirm title="ຢືນຢັນປະຕິເສດຄໍາຂໍລານີ້?" onConfirm={() => decide(record._id, 'reject')}>
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

      <Modal {...modalProps} title="ຂໍລາງານ">
        <Form {...formProps} layout="vertical">
          <Form.Item label="ປະເພດການລາ" name="type" rules={[{ required: true, message: 'ກະລຸນາເລືອກປະເພດການລາ' }]}>
            <Select
              options={[
                { label: 'ລາພັກຜ່ອນ', value: 'vacation' },
                { label: 'ລາເຈັບປ່ວຍ', value: 'sick' },
                { label: 'ລາກິດສ່ວນຕົວ', value: 'personal' },
              ]}
            />
          </Form.Item>
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
    </List>
  );
};
