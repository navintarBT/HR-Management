import { List, useTable, useSelect } from '@refinedev/antd';
import { Table, Form, Select, DatePicker, Button, Space, Typography } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AttendanceDaily, Employee } from '../../types';
import { AttendanceStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter } from '../../utils/selectFilters';

const { RangePicker } = DatePicker;

export const AttendanceDailyPage: React.FC = () => {
  const { tableProps, setFilters } = useTable<AttendanceDaily>({
    resource: 'attendance-daily',
    pagination: { pageSize: 15 },
    sorters: { initial: [{ field: 'date', order: 'desc' }] },
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
    if (values.range?.[0]) filters.push({ field: 'date', operator: 'gte', value: values.range[0].format('YYYY-MM-DD') });
    if (values.range?.[1]) filters.push({ field: 'date', operator: 'lte', value: values.range[1].format('YYYY-MM-DD') });
    setFilters(filters, 'replace');
  };

  const onReset = () => {
    form.resetFields();
    setFilters([], 'replace');
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ບົດລາຍງານການລົງເວລາລາຍວັນ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={onSearch} style={{ rowGap: 8 }}>
          <Form.Item name="employee">
            <Select {...withLocalTextFilter(employeeSelect)} placeholder="ເລືອກພະນັກງານ" style={{ width: 220 }} allowClear />
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

      <Table {...tableProps} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ພະນັກງານ"
          width={160}
          render={(_, record: AttendanceDaily) =>
            typeof record.employee === 'object'
              ? `${(record.employee as Employee).firstName} ${(record.employee as Employee).lastName}`
              : '-'
          }
        />
        <Table.Column title="ວັນທີ" dataIndex="date" width={110} render={(v) => dayjs(v).format('DD/MM/YYYY')} />
        <Table.Column title="ເຂົ້າວຽກ" dataIndex="firstIn" width={100} render={(v) => (v ? dayjs(v).format('HH:mm') : '-')} />
        <Table.Column title="ອອກວຽກ" dataIndex="lastOut" width={100} render={(v) => (v ? dayjs(v).format('HH:mm') : '-')} />
        <Table.Column
          title="ຊົ່ວໂມງເຮັດວຽກ"
          dataIndex="workedHours"
          width={130}
          render={(v) => <Typography.Text>{v?.toFixed(1)} ຊມ.</Typography.Text>}
        />
        <Table.Column
          title="ມາຊ້າ (ນາທີ)"
          dataIndex="lateMinutes"
          width={120}
          render={(v) => (v > 0 ? <Typography.Text type="warning">{v} ນາທີ</Typography.Text> : '-')}
        />
        <Table.Column
          title="OT (ຊມ.)"
          dataIndex="otHours"
          width={110}
          render={(v) => (v > 0 ? <Typography.Text type="success">{v.toFixed(1)} ຊມ.</Typography.Text> : '-')}
        />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(v) => <AttendanceStatusTag status={v} />} />
      </Table>
    </List>
  );
};
