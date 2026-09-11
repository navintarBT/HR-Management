import { List, useTable, EditButton, ShowButton, DeleteButton, CreateButton } from '@refinedev/antd';
import { useGetIdentity } from '@refinedev/core';
import { Table, Space, Input, Avatar, Typography } from 'antd';
import { UserOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, Identity } from '../../types';
import { EmployeeStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { categorical } from '../../theme/palette';

export const EmployeeList: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';

  const { tableProps, setFilters } = useTable<Employee>({
    resource: 'employees',
    syncWithLocation: true,
    sorters: { initial: [{ field: 'employeeCode', order: 'asc' }] },
    pagination: { pageSize: 10 },
  });

  const colorFor = (seed: string) => categorical[seed.charCodeAt(seed.length - 1) % categorical.length];

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ລາຍຊື່ພະນັກງານ"
      headerButtons={isAdmin ? <CreateButton>ເພີ່ມພະນັກງານ</CreateButton> : <></>}
      breadcrumb={false}
    >
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Input.Search
          placeholder="ຄົ້ນຫາຊື່, ລະຫັດພະນັກງານ, ອີເມວ"
          allowClear
          style={{ maxWidth: 320 }}
          prefix={<SearchOutlined />}
          onSearch={(value) => setFilters([{ field: 'q', operator: 'eq', value }])}
        />
      </div>
      <Table {...tableProps} rowKey="_id" scroll={{ x: true }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ພະນັກງານ"
          dataIndex="firstName"
          render={(_, record: Employee) => (
            <Space>
              <Avatar style={{ backgroundColor: colorFor(record.employeeCode) }} icon={<UserOutlined />} />
              <div>
                <div style={{ fontWeight: 500 }}>
                  {record.firstName} {record.lastName}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {record.employeeCode}
                </Typography.Text>
              </div>
            </Space>
          )}
        />
        <Table.Column
          title="ພະແນກ"
          dataIndex={['department', 'name']}
          render={(_, record: Employee) => (typeof record.department === 'object' ? record.department?.name : '-')}
        />
        <Table.Column
          title="ຕໍາແໜ່ງ"
          dataIndex={['position', 'name']}
          render={(_, record: Employee) => (typeof record.position === 'object' ? record.position?.name : '-')}
        />
        <Table.Column title="ອີເມວ" dataIndex="email" />
        <Table.Column
          title="ວັນທີເລີ່ມງານ"
          dataIndex="hireDate"
          render={(value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-')}
        />
        <Table.Column
          title="ສະຖານະ"
          dataIndex="status"
          render={(value) => <EmployeeStatusTag status={value} />}
        />
        <Table.Column
          title="ຈັດການ"
          fixed="right"
          width={isAdmin ? 140 : 70}
          render={(_, record: Employee) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record._id} />
              {isAdmin && (
                <>
                  <EditButton hideText size="small" recordItemId={record._id} />
                  <DeleteButton hideText size="small" recordItemId={record._id} />
                </>
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
