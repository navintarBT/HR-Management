import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useCustomMutation, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Select, DatePicker, TimePicker, Button, Space, Typography, Tag } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { Employee, Position, Shift, ShiftCategory } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker: DateRangePicker } = DatePicker;
const { RangePicker: TimeRangePicker } = TimePicker;

interface PendingChange {
  employee?: string;
  position?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}

const withTextFilter = (selectProps: any) => ({
  ...selectProps,
  onSearch: undefined,
  filterOption: (input: string, option: any) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase()),
  showSearch: true,
});

export const BulkShiftEditPage: React.FC = () => {
  const [filterPosition, setFilterPosition] = useState<string>();
  const [filterEmployees, setFilterEmployees] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs().add(7, 'day')]);

  const filters = useMemo(() => {
    const f: any[] = [
      { field: 'date', operator: 'gte', value: dateRange[0].format('YYYY-MM-DD') },
      { field: 'date', operator: 'lte', value: dateRange[1].format('YYYY-MM-DD') },
    ];
    if (filterPosition) f.push({ field: 'position', operator: 'eq', value: filterPosition });
    return f;
  }, [filterPosition, dateRange]);

  const { data, isLoading, refetch } = useList<Shift>({
    resource: 'shifts',
    filters,
    pagination: { pageSize: 500 },
    sorters: [{ field: 'date', order: 'asc' }],
  });

  const allShifts = data?.data ?? [];
  const shifts = useMemo(() => {
    if (!filterEmployees.length) return allShifts;
    const set = new Set(filterEmployees);
    return allShifts.filter((s) => set.has(typeof s.employee === 'object' ? s.employee._id : s.employee));
  }, [allShifts, filterEmployees]);

  // Local unsaved edits, keyed by shift id — nothing hits the server until "save all".
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const getValue = (shift: Shift, field: keyof PendingChange): string | undefined => {
    const change = pending[shift._id]?.[field];
    if (change !== undefined) return change;
    if (field === 'employee') return typeof shift.employee === 'object' ? shift.employee._id : shift.employee;
    if (field === 'position') return typeof shift.position === 'object' ? shift.position._id : shift.position;
    return (shift as any)[field];
  };

  const setValue = (shiftId: string, field: keyof PendingChange, value?: string) => {
    setPending((prev) => ({ ...prev, [shiftId]: { ...prev[shiftId], [field]: value } }));
  };

  const applyToSelected = (field: keyof PendingChange, value?: string) => {
    if (!value) return;
    setPending((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = { ...next[id], [field]: value };
      return next;
    });
  };

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { selectProps: positionSelect } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
  });

  const { data: categoriesData } = useList<ShiftCategory>({ resource: 'shift-categories', pagination: { pageSize: 100 } });
  const categories = categoriesData?.data ?? [];
  const { selectProps: categorySelect } = useSelect<ShiftCategory>({
    resource: 'shift-categories',
    optionLabel: (item) => `${item.name} (${item.startTime}-${item.endTime})`,
    optionValue: '_id',
    pagination: { pageSize: 100, mode: 'server' },
  });

  const { mutate, isLoading: saving } = useCustomMutation();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const dirtyCount = Object.keys(pending).length;

  const handleSaveAll = () => {
    const updates = Object.entries(pending).map(([id, changes]) => ({ id, ...changes }));
    if (!updates.length) return;
    mutate(
      { url: `${API_URL}/shifts/bulk`, method: 'patch', values: { updates } },
      {
        onSuccess: (response: any) => {
          const results: Array<{ id: string; success: boolean; message?: string }> = response?.data?.results ?? [];
          const failed: Record<string, string> = {};
          let successCount = 0;
          for (const r of results) {
            if (r.success) successCount += 1;
            else failed[r.id] = r.message || 'ບໍ່ສໍາເລັດ';
          }
          setRowErrors(failed);
          setPending((prev) => {
            const next = { ...prev };
            for (const r of results) if (r.success) delete next[r.id];
            return next;
          });
          notify?.({
            type: Object.keys(failed).length ? 'error' : 'success',
            message: `ບັນທຶກສໍາເລັດ ${successCount}/${results.length} ລາຍການ`,
          });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
          refetch();
        },
        onError: () => notify?.({ type: 'error', message: 'ບັນທຶກບໍ່ສໍາເລັດ' }),
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  const [bulkPosition, setBulkPosition] = useState<string>();
  const [bulkEmployee, setBulkEmployee] = useState<string>();
  const [bulkDate, setBulkDate] = useState<Dayjs>();
  const [bulkTime, setBulkTime] = useState<[Dayjs, Dayjs] | null>(null);
  const [bulkCategory, setBulkCategory] = useState<string>();

  return (
    <List title="ແກ້ໄຂກະແບບກຸ່ມ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            {...positionSelect}
            placeholder="ກັ່ນຕອງຕາມຕໍາແໜ່ງ"
            style={{ width: 200 }}
            allowClear
            value={filterPosition}
            onChange={(v: any) => setFilterPosition(v)}
          />
          <Select
            {...withTextFilter(employeeSelect)}
            mode="multiple"
            placeholder="ກັ່ນຕອງຕາມພະນັກງານ"
            style={{ minWidth: 240 }}
            allowClear
            value={filterEmployees}
            onChange={(v: any) => setFilterEmployees(v)}
            maxTagCount={2}
          />
          <DateRangePicker
            value={dateRange}
            onChange={(v) => v && v[0] && v[1] && setDateRange([v[0], v[1]])}
            format="DD/MM/YYYY"
            allowClear={false}
          />
        </Space>

        <Space wrap style={{ background: 'rgba(47,111,235,0.08)', padding: '8px 12px', borderRadius: 8, width: '100%' }}>
          <Typography.Text strong>
            {selectedIds.length ? `ເລືອກແລ້ວ ${selectedIds.length} ກະ — ຕັ້ງຄ່າດຽວກັນ:` : 'ຕິກເລືອກກະ ເພື່ອຕັ້ງຄ່າດຽວກັນໃຫ້ທຸກແຖວທີ່ເລືອກ:'}
          </Typography.Text>
          <Select {...positionSelect} placeholder="ຕໍາແໜ່ງ" style={{ width: 160 }} value={bulkPosition} onChange={(v: any) => setBulkPosition(v)} disabled={!selectedIds.length} />
          <Button size="small" disabled={!selectedIds.length || !bulkPosition} onClick={() => applyToSelected('position', bulkPosition)}>
            ນໍາໃຊ້
          </Button>

          <Select
            {...withTextFilter(employeeSelect)}
            placeholder="ພະນັກງານ"
            style={{ width: 180 }}
            value={bulkEmployee}
            onChange={setBulkEmployee}
            disabled={!selectedIds.length}
          />
          <Button size="small" disabled={!selectedIds.length || !bulkEmployee} onClick={() => applyToSelected('employee', bulkEmployee)}>
            ນໍາໃຊ້
          </Button>

          <DatePicker placeholder="ວັນທີ" format="DD/MM/YYYY" value={bulkDate} onChange={(v) => setBulkDate(v ?? undefined)} disabled={!selectedIds.length} />
          <Button size="small" disabled={!selectedIds.length || !bulkDate} onClick={() => applyToSelected('date', bulkDate?.format('YYYY-MM-DD'))}>
            ນໍາໃຊ້
          </Button>

          <Select
            {...categorySelect}
            placeholder="ໝວດໝູ່ກະ"
            style={{ width: 160 }}
            value={bulkCategory}
            onChange={(v: any) => setBulkCategory(v)}
            disabled={!selectedIds.length}
          />
          <Button
            size="small"
            disabled={!selectedIds.length || !bulkCategory}
            onClick={() => {
              const category = categories.find((c) => c._id === bulkCategory);
              if (!category) return;
              setPending((prev) => {
                const next = { ...prev };
                for (const id of selectedIds) next[id] = { ...next[id], startTime: category.startTime, endTime: category.endTime };
                return next;
              });
            }}
          >
            ນໍາໃຊ້
          </Button>

          <TimeRangePicker format="HH:mm" value={bulkTime} onChange={(v) => setBulkTime(v as [Dayjs, Dayjs] | null)} disabled={!selectedIds.length} />
          <Button
            size="small"
            disabled={!selectedIds.length || !bulkTime}
            onClick={() => {
              if (bulkTime?.[0] && bulkTime?.[1]) {
                setPending((prev) => {
                  const next = { ...prev };
                  for (const id of selectedIds) {
                    next[id] = { ...next[id], startTime: bulkTime[0].format('HH:mm'), endTime: bulkTime[1].format('HH:mm') };
                  }
                  return next;
                });
              }
            }}
          >
            ນໍາໃຊ້
          </Button>
        </Space>

        <div style={{ marginTop: 12 }}>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveAll} loading={saving} disabled={!dirtyCount}>
            ບັນທຶກທັງໝົດ {dirtyCount ? `(${dirtyCount})` : ''}
          </Button>
        </div>
      </div>

      <Table
        rowKey="_id"
        dataSource={shifts}
        loading={isLoading}
        pagination={false}
        sticky={{ offsetHeader }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
      >
        <Table.Column
          title="ພະນັກງານ"
          render={(_, record: Shift) => (
            <Select
              {...withTextFilter(employeeSelect)}
              style={{ width: 170 }}
              value={getValue(record, 'employee')}
              onChange={(v: any) => setValue(record._id, 'employee', v)}
            />
          )}
        />
        <Table.Column
          title="ຕໍາແໜ່ງ"
          render={(_, record: Shift) => (
            <Select {...positionSelect} style={{ width: 150 }} value={getValue(record, 'position')} onChange={(v: any) => setValue(record._id, 'position', v)} />
          )}
        />
        <Table.Column
          title="ວັນທີ"
          render={(_, record: Shift) => (
            <DatePicker
              style={{ width: 130 }}
              format="DD/MM/YYYY"
              value={dayjs(getValue(record, 'date'))}
              onChange={(v) => v && setValue(record._id, 'date', v.format('YYYY-MM-DD'))}
              allowClear={false}
            />
          )}
        />
        <Table.Column
          title="ເວລາ"
          render={(_, record: Shift) => (
            <TimeRangePicker
              style={{ width: 180 }}
              format="HH:mm"
              value={[dayjs(getValue(record, 'startTime'), 'HH:mm'), dayjs(getValue(record, 'endTime'), 'HH:mm')]}
              onChange={(v) => {
                if (v?.[0] && v?.[1]) {
                  setValue(record._id, 'startTime', v[0].format('HH:mm'));
                  setValue(record._id, 'endTime', v[1].format('HH:mm'));
                }
              }}
              allowClear={false}
            />
          )}
        />
        <Table.Column
          title="ສະຖານະ"
          width={140}
          render={(_, record: Shift) =>
            rowErrors[record._id] ? (
              <Tag color="red">{rowErrors[record._id]}</Tag>
            ) : pending[record._id] ? (
              <Tag color="gold">ຍັງບໍ່ບັນທຶກ</Tag>
            ) : (
              <Tag color="green">ບັນທຶກແລ້ວ</Tag>
            )
          }
        />
      </Table>
    </List>
  );
};
