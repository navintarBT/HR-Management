import { useMemo, useState } from 'react';
import { List, useTable, useSelect } from '@refinedev/antd';
import { useList } from '@refinedev/core';
import { Table, Form, Select, DatePicker, Button, Space, Tag, Tabs, Typography } from 'antd';
import { SearchOutlined, ReloadOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceLog, AttendanceDaily, Employee } from '../../types';
import { useTableStickyOffset, useTabsNavBottom, useHeadingBottom } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter } from '../../utils/selectFilters';

const { RangePicker } = DatePicker;

const typeMap: Record<string, { label: string; color: string }> = {
  in: { label: 'ເຂົ້າວຽກ', color: 'green' },
  out: { label: 'ອອກວຽກ', color: 'blue' },
  auto: { label: 'ບໍ່ລະບຸ', color: 'default' },
};

// Employee rows x day columns, each cell showing that day's first-to-last scan
// (AttendanceDaily.firstIn/lastOut already ARE the first/last raw scan of the
// day — see attendanceProcessor.recomputeDay — so no need to re-derive from
// AttendanceLog directly). Prev/this-month/next buttons jump a full calendar
// month at a time; the range picker next to them allows any custom span too
// (including one crossing a month boundary, e.g. the 23rd to the 3rd).
const AttendanceSummaryGrid: React.FC = () => {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);

  const days = useMemo(() => {
    const count = range[1].startOf('day').diff(range[0].startOf('day'), 'day') + 1;
    return Array.from({ length: Math.max(count, 0) }, (_, i) => range[0].add(i, 'day'));
  }, [range]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');

  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = employeesData?.data ?? [];

  const { data: dailyData, isLoading: dailyLoading } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    pagination: { pageSize: 5000 },
  });
  const dailyRows = dailyData?.data ?? [];

  const byEmpDate = useMemo(() => {
    const map: Record<string, AttendanceDaily> = {};
    for (const d of dailyRows) {
      // A record whose employee was since deleted has nowhere to attribute it to — skip it.
      if (!d.employee) continue;
      const empId = typeof d.employee === 'object' ? d.employee._id : d.employee;
      map[`${empId}_${d.date}`] = d;
    }
    return map;
  }, [dailyRows]);

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap>
          <Button icon={<LeftOutlined />} onClick={() => goToMonth(range[0].subtract(1, 'month'))} />
          <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
          <Button icon={<RightOutlined />} onClick={() => goToMonth(range[0].add(1, 'month'))} />
          <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
          <RangePicker
            value={range}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            format="DD/MM/YYYY"
            allowClear={false}
          />
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || dailyLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        size="small"
      >
        <Table.Column title="ລະຫັດພະນັກງານ" fixed="left" width={100} dataIndex="employeeCode" />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          fixed="left"
          width={160}
          render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`}
        />
        <Table.Column
          title="ພະແນກ"
          fixed="left"
          width={120}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          fixed="left"
          width={140}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        {days.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('DD')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {day.format('ddd')}
                  </Typography.Text>
                  <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 'normal' }}>ເຂົ້າ | ອອກ</div>
                </div>
              }
              width={100}
              render={(_, emp: Employee) => {
                const row = byEmpDate[`${emp._id}_${dateKey}`];
                if (!row || !row.firstIn) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const first = dayjs(row.firstIn).format('HH:mm');
                const last = row.lastOut ? dayjs(row.lastOut).format('HH:mm') : '';
                return (
                  <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {first}
                    {last ? `-${last}` : ''}
                  </span>
                );
              }}
            />
          );
        })}
      </Table>
    </div>
  );
};

// The original flat per-scan-event list — unchanged, just moved under its own tab.
const RawLogList: React.FC = () => {
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

  const tabsNavBottom = useTabsNavBottom();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset(tabsNavBottom);

  return (
    <div>
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
          render={(_, record: AttendanceLog) =>
            typeof record.employee === 'object' && record.employee
              ? `${(record.employee as Employee).firstName} ${(record.employee as Employee).lastName}`
              : record.deviceUserId || '-'
          }
        />
        <Table.Column title="ວັນທີ-ເວລາ" dataIndex="timestamp" width={170} render={(v) => dayjs(v).format('DD/MM/YYYY HH:mm:ss')} />
        <Table.Column
          title="ປະເພດ"
          dataIndex="type"
          width={100}
          render={(v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.label ?? v}</Tag>}
        />
        <Table.Column title="ອຸປະກອນ" dataIndex="deviceId" width={130} />
      </Table>
    </div>
  );
};

export const AttendanceLogsPage: React.FC = () => {
  const headingBottom = useHeadingBottom();

  return (
    <List title="ປະຫວັດການສະແກນເຂົ້າ-ອອກງານ (raw log)" breadcrumb={false}>
      <Tabs
        defaultActiveKey="summary"
        tabBarStyle={{ position: 'sticky', top: headingBottom, zIndex: 9, background: 'var(--app-surface-bg)', margin: 0 }}
        items={[
          { key: 'summary', label: 'ຕາຕະລາງສະຫຼຸບ', children: <AttendanceSummaryGrid /> },
          { key: 'detail', label: 'ລາຍລະອຽດ', children: <RawLogList /> },
        ]}
      />
    </List>
  );
};
