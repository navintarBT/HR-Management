import { useTable, useModalForm, DeleteButton } from '@refinedev/antd';
import { useGetIdentity } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { Position, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';

export const PositionPanel: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps } = useTable<Position>({
    resource: 'positions',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  const { modalProps: createModalProps, formProps: createFormProps, show: showCreate } = useModalForm<Position>({
    resource: 'positions',
    action: 'create',
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    formLoading: editFormLoading,
  } = useModalForm<Position>({
    resource: 'positions',
    action: 'edit',
  });

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">ຈັດການລາຍຊື່ຕໍາແໜ່ງງານທັງໝົດ</Typography.Text>
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
              ເພີ່ມຕໍາແໜ່ງ
            </Button>
          )}
        </Space>
      </div>

      <Table {...tableProps} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column title="ຊື່ຕໍາແໜ່ງ" dataIndex="name" />
        <Table.Column title="ລະດັບ" dataIndex="level" />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            width={120}
            render={(_, record: Position) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <DeleteButton size="small" hideText resource="positions" recordItemId={record._id} />
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...createModalProps} title="ເພີ່ມຕໍາແໜ່ງ" destroyOnClose>
        <Form {...createFormProps} layout="vertical">
          <Form.Item label="ຊື່ຕໍາແໜ່ງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ຕໍາແໜ່ງ' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="ລະດັບ" name="level">
            <Input placeholder="staff / senior / lead / manager" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂຕໍາແໜ່ງ" confirmLoading={editFormLoading} destroyOnClose>
        <Form {...editFormProps} layout="vertical">
          <Form.Item label="ຊື່ຕໍາແໜ່ງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ຕໍາແໜ່ງ' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="ລະດັບ" name="level">
            <Input placeholder="staff / senior / lead / manager" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
