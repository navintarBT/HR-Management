import { List, useTable, useSelect } from '@refinedev/antd';
import { Table, Form, Select, DatePicker, Button, Space, Tag } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AttendanceLog, Employee } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker } = DatePicker;

const typeMap: Record<string, { label: string; color: string }> = {
  in: { label: 'ເຂົ້າວຽກ', color: 'green' },
  out: { label: 'ອອກວຽກ', color: 'blue' },
  auto: { label: 'ບໍ່ລະບຸ', color: 'default' },
};

export const AttendanceLogsPage: React.FC = () => {
  const { tableProps, setFilters } = useTable<AttendanceLog>({
    resource: 'attendance-logs',
    pagination: { pageSize: 15 },
    sorters: { initial: [{ field: 'timestamp', order: 'desc' }] },
  });

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });

  const [form] = Form.useForm();

  const onSearch = (values: any) => {
    const filters: any[] = [];
    if (values.employee) filters.push({ field: 'employee', operator: 'eq', value: values.employee });
    if (values.range?.[0]) filters.push({ field: 'timestamp', operator: 'gte', value: values.range[0].startOf('day').toISOString() });
    if (values.range?.[1]) filters.push({ field: 'timestamp', operator: 'lte', value: values.range[1].endOf('day').toISOString() });
    setFilters(filters, 'replace');
  };

  const onReset = () => {
    form.resetFields();
    setFilters([], 'replace');
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ປະຫວັດການສະແກນເຂົ້າ-ອອກງານ (raw log)" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={onSearch} style={{ rowGap: 8 }}>
          <Form.Item name="employee">
            <Select
              {...employeeSelect}
              onSearch={undefined}
              filterOption={(input, option) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="ເລືອກພະນັກງານ"
              style={{ width: 220 }}
              allowClear
              showSearch
            />
          </Form.Item>
          <Form.Item name="range">
            <RangePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} htmlType="submit">
              ຄົ້ນຫາ
            </Button>
            <Button icon={<ReloadOutlined />} onClick={onReset}>
              ລ້າງຕົວກອງ
            </Button>
          </Space>
        </Form>
      </div>

      <Table {...tableProps} rowKey="_id" scroll={{ x: true }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ພະນັກງານ"
          render={(_, record: AttendanceLog) =>
            typeof record.employee === 'object' && record.employee
              ? `${(record.employee as Employee).firstName} ${(record.employee as Employee).lastName}`
              : record.deviceUserId || '-'
          }
        />
        <Table.Column title="ວັນທີ-ເວລາ" dataIndex="timestamp" render={(v) => dayjs(v).format('DD/MM/YYYY HH:mm:ss')} />
        <Table.Column
          title="ປະເພດ"
          dataIndex="type"
          render={(v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.label ?? v}</Tag>}
        />
        <Table.Column title="ອຸປະກອນ" dataIndex="deviceId" />
      </Table>
    </List>
  );
};
