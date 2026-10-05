import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useDelete, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Statistic, Card, Select, Segmented } from 'antd';
import { LeftOutlined, RightOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, Employee, Position, Shift } from '../../types';

const LAO_WEEKDAYS = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];

function idOf(value: { _id: string } | string | null | undefined) {
  if (!value) return undefined;
  return typeof value === 'object' ? value._id : value;
}

function fullName(emp?: Employee | string | null) {
  if (!emp || typeof emp !== 'object') return '-';
  return `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || '-';
}

function codeOf(emp?: Employee | string | null) {
  return emp && typeof emp === 'object' ? emp.employeeCode ?? '' : '';
}

function deptOf(emp?: Employee | string | null) {
  const dept = emp && typeof emp === 'object' ? emp.department : undefined;
  return dept && typeof dept === 'object' ? dept.name : '-';
}

function positionOf(emp?: Employee | string | null) {
  const position = emp && typeof emp === 'object' ? emp.position : undefined;
  return position && typeof position === 'object' ? position.name : '-';
}

// Overnight-aware, same convention as a shift's own start/end.
function hoursBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

// Weekly or monthly view of ການເຮັດແທນ: one row per employee covering someone in
// the range, one column per day. Each cell lists that day's covers with who
// they're covering, the covered person's department and position, and the time.
// Records are created from ຕາຕະລາງວັນພັກ (click a day → ໄປເຮັດແທນຄົນອື່ນ).
type CoverView = 'week' | 'month';

export const ScheduleCoversGrid: React.FC = () => {
  const [view, setView] = useState<CoverView>('week');
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs());
  const step = view === 'week' ? 'week' : 'month';
  const rangeStart = view === 'week' ? anchor.startOf('week') : anchor.startOf('month');
  const dayCount = view === 'week' ? 7 : anchor.daysInMonth();
  const rangeEnd = rangeStart.add(dayCount - 1, 'day');
  const rangeDays = Array.from({ length: dayCount }, (_, i) => rangeStart.add(i, 'day'));
  const periodText = view === 'week' ? 'ໃນອາທິດນີ້' : 'ໃນເດືອນນີ້';
  const startKey = rangeStart.format('YYYY-MM-DD');
  const endKey = rangeEnd.format('YYYY-MM-DD');

  const { data: shiftsData, isLoading, refetch } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'date', operator: 'gte', value: startKey },
      { field: 'date', operator: 'lte', value: endKey },
      { field: 'status', operator: 'eq', value: 'scheduled' },
    ],
    pagination: { pageSize: 5000 },
  });
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const { selectProps: positionSelect, query: positionQuery } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allPositions = positionQuery?.data?.data ?? [];
  const positionOptionsForDepartment = useMemo(() => {
    if (!departmentFilter) return undefined;
    return allPositions
      .filter((p) => (p.departments ?? []).some((d) => idOf(d) === departmentFilter))
      .map((p) => ({ label: p.name, value: p._id }));
  }, [allPositions, departmentFilter]);

  // Filters match the covered person's department and position — the ones shown
  // in each cell — since that's the job being done.
  const covers = useMemo(
    () =>
      (shiftsData?.data ?? []).filter((s) => {
        if (!s.coveringFor) return false;
        const covered = typeof s.coveringFor === 'object' ? s.coveringFor : undefined;
        if (departmentFilter && idOf(covered?.department) !== departmentFilter) return false;
        if (positionFilter && idOf(s.position) !== positionFilter) return false;
        return true;
      }),
    [shiftsData?.data, departmentFilter, positionFilter]
  );

  // Index by coverer → date → covers (sorted by start time within a day).
  const byCoverer = useMemo(() => {
    const map = new Map<string, { employee: Employee; byDate: Map<string, Shift[]> }>();
    for (const s of covers) {
      const emp = s.employee as Employee;
      const empId = typeof s.employee === 'object' ? emp._id : String(s.employee);
      if (!map.has(empId)) map.set(empId, { employee: emp, byDate: new Map() });
      const bucket = map.get(empId)!.byDate;
      bucket.set(s.date, [...(bucket.get(s.date) ?? []), s]);
    }
    for (const entry of map.values()) {
      for (const list of entry.byDate.values()) list.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return Array.from(map.values()).sort((a, b) => (a.employee.employeeCode ?? '').localeCompare(b.employee.employeeCode ?? ''));
  }, [covers]);

  const totalHours = covers.reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);

  const { mutate: deleteShift } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const removeCover = (id: string) => {
    deleteShift(
      { resource: 'shifts', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
          refetch();
        },
      }
    );
  };

  const CoverCell = ({ list }: { list: Shift[] }) => (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {list.map((s) => (
        <div
          key={s._id}
          style={{
            borderLeft: '3px solid #722ed1',
            background: '#f9f0ff',
            borderRadius: 4,
            padding: '4px 6px',
            textAlign: 'left',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            ແທນ {codeOf(s.coveringFor as Employee)} {fullName(s.coveringFor as Employee)}
          </div>
          <div style={{ color: '#595959' }}>
            {deptOf(s.coveringFor as Employee)} · {s.position && typeof s.position === 'object' ? s.position.name : '-'}
          </div>
          <div style={{ color: '#531dab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {s.startTime}-{s.endTime} ({hoursBetween(s.startTime, s.endTime)} ຊມ.)
            </span>
            <Popconfirm title="ລຶບການເຮັດແທນນີ້?" onConfirm={() => removeCover(s._id)}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>
      ))}
    </Space>
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as CoverView)}
          options={[
            { label: 'ອາທິດ', value: 'week' },
            { label: 'ເດືອນ', value: 'month' },
          ]}
        />
        <Button icon={<LeftOutlined />} onClick={() => setAnchor(anchor.subtract(1, step))} />
        <Button onClick={() => setAnchor(dayjs())}>{view === 'week' ? 'ອາທິດນີ້' : 'ເດືອນນີ້'}</Button>
        <Button icon={<RightOutlined />} onClick={() => setAnchor(anchor.add(1, step))} />
        <Typography.Text strong>
          {view === 'week'
            ? `${rangeStart.format('DD/MM/YYYY')} – ${rangeEnd.format('DD/MM/YYYY')}`
            : rangeStart.format('MM/YYYY')}
        </Typography.Text>
        <Select
          {...departmentSelect}
          placeholder="ກອງຕາມພະແນກ"
          allowClear
          style={{ width: 180 }}
          value={departmentFilter}
          onChange={(v: any) => {
            setDepartmentFilter(v);
            const stillValid =
              !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some((d) => idOf(d) === v);
            if (!stillValid) setPositionFilter(undefined);
          }}
        />
        <Select
          {...positionSelect}
          options={positionOptionsForDepartment}
          placeholder="ກອງຕາມຕຳແໜ່ງ"
          allowClear
          style={{ width: 180 }}
          value={positionFilter}
          onChange={(v: any) => setPositionFilter(v)}
        />
      </Space>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small">
          <Statistic title={`ຈຳນວນການເຮັດແທນ${periodText}`} value={covers.length} />
        </Card>
        <Card size="small">
          <Statistic title="ລວມຊົ່ວໂມງເຮັດແທນ" value={totalHours} precision={2} suffix="ຊມ." />
        </Card>
      </Space>

      <Table
        dataSource={byCoverer}
        rowKey={(row) => row.employee._id}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="small"
        locale={{ emptyText: `ຍັງບໍ່ມີການເຮັດແທນ${periodText}` }}
      >
        <Table.Column
          title="ຜູ້ເຮັດແທນ"
          fixed="left"
          width={200}
          render={(_, row: { employee: Employee }) => (
            <div style={{ fontWeight: 600 }}>
              {row.employee.employeeCode} {fullName(row.employee)}
            </div>
          )}
        />
        <Table.Column
          title="ພະແນກ"
          width={150}
          render={(_, row: { employee: Employee }) => deptOf(row.employee)}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, row: { employee: Employee }) => positionOf(row.employee)}
        />
        {rangeDays.map((day) => {
          const dateKey = day.format('YYYY-MM-DD');
          return (
            <Table.Column
              key={dateKey}
              width={view === 'week' ? 170 : 150}
              title={
                <div style={{ textAlign: 'center' }}>
                  <div>{day.format('DD/MM')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {LAO_WEEKDAYS[day.day()]}
                  </Typography.Text>
                </div>
              }
              render={(_, row: { byDate: Map<string, Shift[]> }) => {
                const list = row.byDate.get(dateKey);
                return list ? <CoverCell list={list} /> : <span style={{ color: '#bfbfbf' }}>-</span>;
              }}
            />
          );
        })}
      </Table>
    </div>
  );
};

export const ScheduleCoversPage: React.FC = () => (
  <List title="ການເຮັດແທນ — ລາຍລະອຽດ" breadcrumb={false}>
    <ScheduleCoversGrid />
  </List>
);
