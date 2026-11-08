import { useTable, useModalForm, useSelect, DeleteButton } from '@refinedev/antd';
import { useGetIdentity, useInvalidate } from '@refinedev/core';
import { useState } from 'react';
import type { CrudFilter } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Select, Space, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';
import { useShowAllToggle } from '../../hooks/useShowAllToggle';
import { withLocalTextFilter } from '../../utils/selectFilters';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { EmployeeCountCell, UnusedOnlyToggle, deleteBlockedReason, useOrganizationCounts, useUnusedOnlyFilter } from './employeeCounts';

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

  const { counts, unusedIds, loaded: countsLoaded, refetch: refetchCounts } = useOrganizationCounts('departments');
  const [search, setSearch] = useState('');
  const applyFilters = (s: string, unused: CrudFilter | null) => {
    const filters: CrudFilter[] = [];
    if (s) filters.push({ field: 'q', operator: 'eq', value: s });
    if (unused) filters.push(unused);
    setFilters(filters, 'replace');
  };
  const { onlyUnused, setOnlyUnused, unusedFilter } = useUnusedOnlyFilter(unusedIds, (unused) => applyFilters(search, unused));

  const { selectProps: headSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE, mode: 'server' },
  });

  const { modalProps: createModalProps, formProps: createFormProps, show: showCreate } = useModalForm<Department>({
    resource: 'departments',
    action: 'create',
    onMutationSuccess: () => refetchCounts(),
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
        <Space wrap style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input.Search
              placeholder="ຄົ້ນຫາຊື່ພະແນກ"
              allowClear
              style={{ width: 220 }}
              prefix={<SearchOutlined />}
              onSearch={(value) => {
                setSearch(value);
                applyFilters(value, unusedFilter);
              }}
            />
            <UnusedOnlyToggle checked={onlyUnused} onChange={setOnlyUnused} count={unusedIds.length} loaded={countsLoaded} />
          </Space>
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
              ເພີ່ມພະແນກ
            </Button>
          )}
        </Space>
      </div>

      <Table {...tableProps} pagination={pagination} rowKey="_id" sticky={{ offsetHeader }} scroll={{ x: 'max-content' }}>
        <Table.Column title="ຊື່ພະແນກ" dataIndex="name" />
        <Table.Column
          title="ພະນັກງານ"
          render={(_, record: Department) => <EmployeeCountCell kind="departments" entry={counts?.[record._id]} loaded={countsLoaded} />}
        />
        <Table.Column
          title="ຕໍາແໜ່ງ"
          render={(_, record: Department) => (countsLoaded ? counts?.[record._id]?.positions ?? 0 : '-')}
        />
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
            render={(_, record: Department) => {
              const entry = counts?.[record._id];
              const blocked = deleteBlockedReason('departments', entry);
              const linkedPositions = entry?.positions ?? 0;
              return (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                  <Tooltip title={blocked}>
                    <span>
                      <DeleteButton
                        size="small"
                        hideText
                        resource="departments"
                        recordItemId={record._id}
                        disabled={!!blocked}
                        confirmTitle={
                          linkedPositions
                            ? `ພະແນກນີ້ມີ ${linkedPositions} ຕໍາແໜ່ງ — ລຶບແລ້ວຕໍາແໜ່ງເຫຼົ່ານັ້ນຈະບໍ່ຢູ່ໃນພະແນກນີ້ອີກ. ລຶບບໍ?`
                            : undefined
                        }
                        onSuccess={() => refetchCounts()}
                      />
                    </span>
                  </Tooltip>
                </Space>
              );
            }}
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
