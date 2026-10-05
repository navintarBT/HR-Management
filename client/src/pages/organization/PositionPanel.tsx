import { useState } from 'react';
import { useTable, useModalForm, useSelect, DeleteButton } from '@refinedev/antd';
import { useGetIdentity, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, Select, Space, Typography } from 'antd';
import { PlusOutlined, EditOutlined, ApartmentOutlined, DeleteOutlined, ExclamationCircleFilled, SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Position, Identity } from '../../types';
import { useTableStickyOffset, useTabsNavBottom } from '../../hooks/useTableStickyOffset';
import { useShowAllToggle } from '../../hooks/useShowAllToggle';
import { withLocalTextFilter } from '../../utils/selectFilters';
import { axiosInstance, API_URL } from '../../providers/axios';
import { palette } from '../../theme/palette';

export const PositionPanel: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps, setPageSize, setCurrent, setFilters } = useTable<Position>({
    resource: 'positions',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  const total = typeof tableProps.pagination === 'object' ? tableProps.pagination?.total ?? 0 : 0;
  const { showAll, toggleShowAll } = useShowAllToggle(setPageSize, total, 10, setCurrent);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const applyPositionFilters = (overrides: { search?: string; department?: string } = {}) => {
    const s = 'search' in overrides ? overrides.search : search;
    const d = 'department' in overrides ? overrides.department : departmentFilter;
    const filters: any[] = [];
    if (s) filters.push({ field: 'q', operator: 'eq', value: s });
    if (d) filters.push({ field: 'departments', operator: 'eq', value: d });
    setFilters(filters, 'replace');
  };

  const pagination = {
    ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {}),
    showTotal: () => (
      <Button size="small" onClick={toggleShowAll}>
        {showAll ? 'ສະແດງເປັນໜ້າ' : 'ສະແດງທັງໝົດ'}
      </Button>
    ),
  };

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { selectProps: headSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
  });

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkDepartments, setBulkDepartments] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const deleteSelectedPositions = async () => {
    setBulkDeleteLoading(true);
    try {
      const dataSource = (tableProps.dataSource ?? []) as Position[];
      const results = await Promise.allSettled(
        selectedRowKeys.map((key) => axiosInstance.delete(`${API_URL}/positions/${key}`))
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results
        .map((r, i) => ({ r, key: selectedRowKeys[i] }))
        .filter(({ r }) => r.status === 'rejected');

      if (succeeded > 0) {
        notify?.({ type: 'success', message: `ລຶບ ${succeeded} ຕໍາແໜ່ງສໍາເລັດແລ້ວ` });
      }
      if (failed.length > 0) {
        const names = failed
          .map(({ key }) => dataSource.find((p) => p._id === key)?.name || key)
          .join(', ');
        notify?.({
          type: 'error',
          message: `ລຶບບໍ່ສໍາເລັດ ${failed.length} ຕໍາແໜ່ງ (ຍັງຖືກນໍາໃຊ້ຢູ່): ${names}`,
        });
      }

      setSelectedRowKeys(failed.map(({ key }) => key));
      invalidate({ resource: 'positions', invalidates: ['list'] });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const confirmBulkDelete = () => {
    Modal.confirm({
      title: `ລຶບ ${selectedRowKeys.length} ຕໍາແໜ່ງທີ່ເລືອກ?`,
      icon: <ExclamationCircleFilled style={{ color: palette.error }} />,
      content: 'ການດໍາເນີນການນີ້ບໍ່ສາມາດຍ້ອນກັບໄດ້',
      okText: 'ລຶບ',
      okButtonProps: { danger: true },
      cancelText: 'ຍົກເລີກ',
      onOk: deleteSelectedPositions,
    });
  };

  const applyBulkDepartments = async () => {
    if (!bulkDepartments.length) return;
    setBulkLoading(true);
    try {
      const dataSource = (tableProps.dataSource ?? []) as Position[];
      await Promise.all(
        selectedRowKeys.map((key) => {
          const record = dataSource.find((p) => p._id === key);
          const existing = (record?.departments ?? []).map((d) => (typeof d === 'object' ? d._id : d));
          const merged = Array.from(new Set([...existing, ...bulkDepartments]));
          return axiosInstance.patch(`${API_URL}/positions/${key}`, { departments: merged });
        })
      );
      notify?.({ type: 'success', message: `ເພີ່ມພະແນກໃຫ້ ${selectedRowKeys.length} ຕໍາແໜ່ງສໍາເລັດແລ້ວ` });
      setBulkModalOpen(false);
      setBulkDepartments([]);
      setSelectedRowKeys([]);
      invalidate({ resource: 'positions', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສໍາເລັດ' });
    } finally {
      setBulkLoading(false);
    }
  };

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
    onMutationSuccess: () => {
      // Renaming a position should be reflected immediately anywhere it's
      // already displayed (e.g. populated on cached employee records), not
      // just in this position list.
      invalidate({ resource: 'employees', invalidates: ['list', 'detail'] });
    },
  });

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="ຄົ້ນຫາຊື່ຕໍາແໜ່ງ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(value) => {
              setSearch(value);
              applyPositionFilters({ search: value });
            }}
          />
          <Select
            {...departmentSelect}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 200 }}
            value={departmentFilter}
            onChange={(v: any) => {
              setDepartmentFilter(v);
              applyPositionFilters({ department: v });
            }}
          />
        </Space>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            {selectedRowKeys.length > 0 ? `ເລືອກໄວ້ ${selectedRowKeys.length} ຕໍາແໜ່ງ` : 'ຈັດການລາຍຊື່ຕໍາແໜ່ງງານທັງໝົດ'}
          </Typography.Text>
          <Space>
            {isAdmin && selectedRowKeys.length > 0 && (
              <>
                <Button
                  type="primary"
                  icon={<ApartmentOutlined />}
                  style={{ backgroundColor: palette.warning, borderColor: palette.warning }}
                  onClick={() => setBulkModalOpen(true)}
                >
                  ເພີ່ມພະແນກໃຫ້ຕໍາແໜ່ງທີ່ເລືອກ
                </Button>
                <Button danger icon={<DeleteOutlined />} loading={bulkDeleteLoading} onClick={confirmBulkDelete}>
                  ລຶບຕໍາແໜ່ງທີ່ເລືອກ
                </Button>
              </>
            )}
            {isAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
                ເພີ່ມຕໍາແໜ່ງ
              </Button>
            )}
          </Space>
        </Space>
      </div>

      <Table
        {...tableProps}
        pagination={pagination}
        rowKey="_id"
        sticky={{ offsetHeader }}
        rowSelection={
          isAdmin ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined
        }
      >
        <Table.Column title="ຊື່ຕໍາແໜ່ງ" dataIndex="name" />
        <Table.Column
          title="ພະແນກ"
          dataIndex="departments"
          render={(_, record: Position) =>
            record.departments?.length
              ? record.departments.map((d) => (typeof d === 'object' ? d.name : d)).join(', ')
              : '-'
          }
        />
        <Table.Column
          title="ຫົວໜ້າຕໍາແໜ່ງ"
          render={(_, record: Position) =>
            typeof record.head === 'object' && record.head ? `${record.head.firstName} ${record.head.lastName}` : '-'
          }
        />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            width={120}
            render={(_, record: Position) =>
              selectedRowKeys.length > 1 && selectedRowKeys.includes(record._id) ? null : (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                  <DeleteButton size="small" hideText resource="positions" recordItemId={record._id} />
                </Space>
              )
            }
          />
        )}
      </Table>

      <Modal
        title={`ເພີ່ມພະແນກໃຫ້ ${selectedRowKeys.length} ຕໍາແໜ່ງທີ່ເລືອກ`}
        open={bulkModalOpen}
        onOk={applyBulkDepartments}
        onCancel={() => setBulkModalOpen(false)}
        confirmLoading={bulkLoading}
        okText="ຢືນຢັນ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ພະແນກທີ່ເລືອກຈະຖືກເພີ່ມເຂົ້າໄປໃນຕໍາແໜ່ງທີ່ເລືອກໄວ້ທັງໝົດ (ພະແນກເດີມທີ່ມີຢູ່ແລ້ວຈະບໍ່ຖືກລຶບ)
        </Typography.Paragraph>
        <Select
          {...departmentSelect}
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="ເລືອກພະແນກ"
          value={bulkDepartments}
          onChange={(value: any) => setBulkDepartments(value)}
        />
      </Modal>

      <Modal {...createModalProps} title="ເພີ່ມຕໍາແໜ່ງ" destroyOnClose>
        <Form
          {...createFormProps}
          onFinish={(values: any) => createFormProps.onFinish?.({ ...values, departments: values.departments ? [values.departments] : [] })}
          layout="vertical"
        >
          <Form.Item label="ຊື່ຕໍາແໜ່ງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ຕໍາແໜ່ງ' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="ພະແນກ" name="departments" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະແນກ' }]}>
            <Select {...departmentSelect} allowClear placeholder="ເລືອກພະແນກ" />
          </Form.Item>
          <Form.Item label="ຫົວໜ້າຕໍາແໜ່ງ" name="head">
            <Select {...withLocalTextFilter(headSelect)} allowClear placeholder="ເລືອກຫົວໜ້າຕໍາແໜ່ງ" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂຕໍາແໜ່ງ" confirmLoading={editFormLoading} destroyOnClose>
        <Form
          {...editFormProps}
          onFinish={(values: any) => editFormProps.onFinish?.({ ...values, departments: values.departments ? [values.departments] : [] })}
          layout="vertical"
        >
          <Form.Item label="ຊື່ຕໍາແໜ່ງ" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ຕໍາແໜ່ງ' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="ພະແນກ"
            name="departments"
            rules={[{ required: true, message: 'ກະລຸນາເລືອກພະແນກ' }]}
            getValueProps={(value) => {
              const first = Array.isArray(value) ? value[0] : value;
              return { value: first && typeof first === 'object' ? first._id : first };
            }}
          >
            <Select {...departmentSelect} allowClear placeholder="ເລືອກພະແນກ" />
          </Form.Item>
          <Form.Item
            label="ຫົວໜ້າຕໍາແໜ່ງ"
            name="head"
            getValueProps={(value) => ({ value: value && typeof value === 'object' ? value._id : value })}
          >
            <Select {...withLocalTextFilter(headSelect)} allowClear placeholder="ເລືອກຫົວໜ້າຕໍາແໜ່ງ" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
