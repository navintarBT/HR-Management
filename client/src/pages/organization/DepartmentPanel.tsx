import { useTable, useModalForm, DeleteButton } from '@refinedev/antd';
import { useGetIdentity } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { Department, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';

export const DepartmentPanel: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps } = useTable<Department>({
    resource: 'departments',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  const { modalProps: createModalProps, formProps: createFormProps, show: showCreate } = useModalForm<Department>({
    resource: 'departments',
    action: 'create',
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    formLoading: editFormLoading,
  } = useModalForm<Department>({
    resource: 'departments',
    action: 'edit',
  });

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">ຈັດການລາຍຊື່ພະແນກທັງໝົດໃນອົງກອນ</Typography.Text>
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
              ເພີ່ມພະແນກ
            </Button>
          )}
        </Space>
      </div>

      <Table {...tableProps} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column title="ຊື່ພະແນກ" dataIndex="name" />
        <Table.Column title="ລາຍລະອຽດ" dataIndex="description" />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            width={120}
            render={(_, record: Department) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <DeleteButton size="small" hideText resource="departments" recordItemId={record._id} />
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...createModalProps} title="ເພີ່ມພະແນກ" destroyOnClose>
        <Form {...createFormProps} layout="vertical">
          <Form.Item label="ຊື່ພະແນກ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ພະແນກ' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="ລາຍລະອຽດ" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂພະແນກ" confirmLoading={editFormLoading} destroyOnClose>
        <Form {...editFormProps} layout="vertical">
          <Form.Item label="ຊື່ພະແນກ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ພະແນກ' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="ລາຍລະອຽດ" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
