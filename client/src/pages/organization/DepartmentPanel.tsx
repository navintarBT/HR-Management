import { useTable, useModalForm, useSelect, DeleteButton } from '@refinedev/antd';
import { useGetIdentity, useInvalidate } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Select, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';
import { useShowAllToggle } from '../../hooks/useShowAllToggle';
import { withLocalTextFilter } from '../../utils/selectFilters';

export const DepartmentPanel: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps, setPageSize, setCurrent, setFilters } = useTable<Department>({
    resource: 'departments',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  const total = typeof tableProps.pagination === 'object' ? tableProps.pagination?.total ?? 0 : 0;
  const { showAll, toggleShowAll } = useShowAllToggle(setPageSize, total, 10, setCurrent);

  const pagination = {
    ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {}),
    showTotal: () => (
      <Button size="small" onClick={toggleShowAll}>
        {showAll ? 'ສະແດງເປັນໜ້າ' : 'ສະແດງທັງໝົດ'}
      </Button>
    ),
  };

  const invalidate = useInvalidate();

  const { selectProps: headSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
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
    onMutationSuccess: () => {
      // Renaming a department should be reflected immediately anywhere it's
      // already displayed (e.g. populated on cached employee records), not
      // just in this department list.
      invalidate({ resource: 'employees', invalidates: ['list', 'detail'] });
    },
  });

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Input.Search
            placeholder="ຄົ້ນຫາຊື່ພະແນກ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(value) => setFilters(value ? [{ field: 'q', operator: 'eq', value }] : [], 'replace')}
          />
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
              ເພີ່ມພະແນກ
            </Button>
          )}
        </Space>
      </div>

      <Table {...tableProps} pagination={pagination} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column title="ຊື່ພະແນກ" dataIndex="name" />
        <Table.Column
          title="ຫົວໜ້າພະແນກ"
          render={(_, record: Department) =>
            typeof record.head === 'object' && record.head ? `${record.head.firstName} ${record.head.lastName}` : '-'
          }
        />
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
          <Form.Item label="ຫົວໜ້າພະແນກ" name="head">
            <Select {...withLocalTextFilter(headSelect)} allowClear placeholder="ເລືອກຫົວໜ້າພະແນກ" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂພະແນກ" confirmLoading={editFormLoading} destroyOnClose>
        <Form {...editFormProps} layout="vertical">
          <Form.Item label="ຊື່ພະແນກ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ພະແນກ' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="ຫົວໜ້າພະແນກ"
            name="head"
            getValueProps={(value) => ({ value: value && typeof value === 'object' ? value._id : value })}
          >
            <Select {...withLocalTextFilter(headSelect)} allowClear placeholder="ເລືອກຫົວໜ້າພະແນກ" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
