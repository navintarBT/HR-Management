import { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useList } from '@refinedev/core';
import { Table, Select, Button, Space, Typography, Input, DatePicker } from 'antd';
import { LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceDaily, Employee } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker } = DatePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// One row per employee (pulled fresh from the current employee list, not from
// whatever AttendanceDaily rows happen to exist — those can be orphaned if an
// employee was since deleted), aggregated over a chosen date range.
export const AttendanceDailyPage: React.FC = () => {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');
  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const departmentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      const dept = e.department;
      if (dept && typeof dept === 'object') map.set(dept._id, dept.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);

  const positionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      const pos = e.position;
      if (pos && typeof pos === 'object') map.set(pos._id, pos.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);

  const employees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEmployees.filter((e) => {
      if (q) {
        const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.toLowerCase();
        const code = (e.employeeCode ?? '').toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (departmentFilter && idOf(e.department) !== departmentFilter) return false;
      if (positionFilter && idOf(e.position) !== positionFilter) return false;
      return true;
    });
  }, [allEmployees, search, departmentFilter, positionFilter]);

  const { data: dailyData, isLoading: dailyLoading } = useList<AttendanceDaily>({
    resource: 'attendance-daily',
    filters: [
      { field: 'date', operator: 'gte', value: rangeStartKey },
      { field: 'date', operator: 'lte', value: rangeEndKey },
    ],
    pagination: { pageSize: 5000 },
  });
  const dailyRows = dailyData?.data ?? [];

  const summaryByEmployee = useMemo(() => {
    const map: Record<
      string,
      { workedHours: number; lateMinutes: number; lateDays: number; noScanOutDays: number; absentDays: number }
    > = {};
    for (const d of dailyRows) {
      // A record whose employee was since deleted has nowhere to attribute it to — skip it.
      if (!d.employee) continue;
      const empId = typeof d.employee === 'object' ? d.employee._id : d.employee;
      if (!map[empId]) map[empId] = { workedHours: 0, lateMinutes: 0, lateDays: 0, noScanOutDays: 0, absentDays: 0 };
      map[empId].workedHours += d.workedHours || 0;
      map[empId].lateMinutes += d.lateMinutes || 0;
      if (d.status === 'late') map[empId].lateDays += 1;
      // "incomplete" = no scan-out recorded that day (a lone scan-in, or a scan-in with no matching scan-out).
      if (d.status === 'incomplete') map[empId].noScanOutDays += 1;
      if (d.status === 'absent') map[empId].absentDays += 1;
    }
    return map;
  }, [dailyRows]);

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ບົດລາຍງານການລົງເວລາລາຍວັນ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
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
        <Space wrap>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(v) => setSearch(v)}
            onChange={(e) => !e.target.value && setSearch('')}
          />
          <Select
            options={departmentOptions}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 180 }}
            value={departmentFilter}
            onChange={(v) => setDepartmentFilter(v)}
          />
          <Select
            options={positionOptions}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            style={{ width: 180 }}
            value={positionFilter}
            onChange={(v) => setPositionFilter(v)}
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
      >
        <Table.Column title="ລະຫັດພະນັກງານ" width={110} dataIndex="employeeCode" />
        <Table.Column title="ຊື່ພະນັກງານ" width={180} render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`} />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຊົ່ວໂມງເຮັດວຽກ"
          width={130}
          render={(_, emp: Employee) => `${(summaryByEmployee[emp._id]?.workedHours ?? 0).toFixed(1)} ຊມ.`}
        />
        <Table.Column
          title="ມາຊ້າ (ນາທີ)"
          width={120}
          render={(_, emp: Employee) => {
            const v = summaryByEmployee[emp._id]?.lateMinutes ?? 0;
            return v > 0 ? <Typography.Text type="warning">{v} ນາທີ</Typography.Text> : '-';
          }}
        />
        <Table.Column
          title="ມາຊ້າ (ຈຳນວນມື້)"
          width={130}
          render={(_, emp: Employee) => {
            const v = summaryByEmployee[emp._id]?.lateDays ?? 0;
            return v > 0 ? <Typography.Text type="warning">{v} ມື້</Typography.Text> : '-';
          }}
        />
        <Table.Column
          title="ສະແກນຄັ້ງດຽວ"
          width={150}
          render={(_, emp: Employee) => {
            const v = summaryByEmployee[emp._id]?.noScanOutDays ?? 0;
            return v > 0 ? <Typography.Text type="danger">{v} ມື້</Typography.Text> : '-';
          }}
        />
        <Table.Column
          title="ມື້ຂາດວຽກ"
          width={110}
          render={(_, emp: Employee) => {
            const v = summaryByEmployee[emp._id]?.absentDays ?? 0;
            return v > 0 ? <Typography.Text type="danger">{v} ວັນ</Typography.Text> : '-';
          }}
        />
      </Table>
    </List>
  );
};
