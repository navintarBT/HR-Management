import { useTable, useModalForm, DeleteButton } from '@refinedev/antd';
import { useGetIdentity, useInvalidate } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { EmploymentType, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';
import { useShowAllToggle } from '../../hooks/useShowAllToggle';

export const EmploymentTypePanel: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps, setPageSize } = useTable<EmploymentType>({
    resource: 'employment-types',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  const total = typeof tableProps.pagination === 'object' ? tableProps.pagination?.total ?? 0 : 0;
  const { showAll, toggleShowAll } = useShowAllToggle(setPageSize, total);

  const pagination = {
    ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {}),
    showTotal: () => (
      <Button size="small" onClick={toggleShowAll}>
        {showAll ? 'ສະແດງເປັນໜ້າ' : 'ສະແດງທັງໝົດ'}
      </Button>
    ),
  };

  const invalidate = useInvalidate();

  const { modalProps: createModalProps, formProps: createFormProps, show: showCreate } = useModalForm<EmploymentType>({
    resource: 'employment-types',
    action: 'create',
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    formLoading: editFormLoading,
  } = useModalForm<EmploymentType>({
    resource: 'employment-types',
    action: 'edit',
    onMutationSuccess: () => {
      // Renaming an employment type should be reflected immediately anywhere
      // it's already displayed (e.g. populated on cached employee records),
      // not just in this list.
      invalidate({ resource: 'employees', invalidates: ['list', 'detail'] });
    },
  });

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">ຈັດການລາຍການປະເພດການຈ້າງງານທັງໝົດ</Typography.Text>
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
              ເພີ່ມປະເພດການຈ້າງ
            </Button>
          )}
        </Space>
      </div>

      <Table {...tableProps} pagination={pagination} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column title="ຊື່ປະເພດການຈ້າງ" dataIndex="name" />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            width={120}
            render={(_, record: EmploymentType) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <DeleteButton size="small" hideText resource="employment-types" recordItemId={record._id} />
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...createModalProps} title="ເພີ່ມປະເພດການຈ້າງ" destroyOnClose>
        <Form {...createFormProps} layout="vertical">
          <Form.Item label="ຊື່ປະເພດການຈ້າງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ປະເພດການຈ້າງ' }]}>
            <Input placeholder="ເຊັ່ນ: ເຕັມເວລາ, ບາງເວລາ, ຕາມລະດູການ" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂປະເພດການຈ້າງ" confirmLoading={editFormLoading} destroyOnClose>
        <Form {...editFormProps} layout="vertical">
          <Form.Item label="ຊື່ປະເພດການຈ້າງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ປະເພດການຈ້າງ' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
