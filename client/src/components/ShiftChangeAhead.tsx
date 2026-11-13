import { useEffect, useState } from 'react';
import { useSelect } from '@refinedev/antd';
import { useInvalidate, useNotification } from '@refinedev/core';
import { Button, DatePicker, Input, Select, Space, TimePicker, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../providers/axios';
import type { ScheduledShiftChange, ShiftCategory } from '../types';

// ຍ້າຍກະລ່ວງໜ້າ: the one way a regular shift is moved, for one person on
// ຕັ້ງຄ່າແຜນວຽກ and for a group on ແກ້ໄຂກະແບບກຸ່ມ. Each person gets a
// ScheduledShiftChange, which sets the new shift on the start date itself and
// switches the regular shift from then on (server/src/utils/scheduledShiftChange.js).
// A start date of today or earlier takes effect right away.
// Every move lands in ປະຫວັດການແກ້ໄຂ: `bulkEditRound` is the ແກ້ໄຂກະແບບກຸ່ມ
// round it belongs to; otherwise it's a round of one, from `source` (the
// employee page, or ຕັ້ງຄ່າແຜນວຽກ when not given).
export function scheduleShiftChange(
  employee: string,
  newShiftCategory: string,
  effectiveDate: string,
  bulkEditRound?: string,
  source?: 'employee' | 'planner'
) {
  return axiosInstance.post<ScheduledShiftChange>(`${API_URL}/scheduled-shift-changes`, { employee, newShiftCategory, effectiveDate, bulkEditRound, source });
}

// Only a change still waiting for its date can be called off.
export function cancelScheduledShiftChange(id: string) {
  return axiosInstance.patch<ScheduledShiftChange>(`${API_URL}/scheduled-shift-changes/${id}`, { status: 'cancelled' });
}

export function shiftCategoryLabel(category: ShiftCategory | string | undefined | null): string {
  if (!category || typeof category === 'string') return '-';
  return category.name ? `${category.name} (${category.startTime}-${category.endTime})` : `${category.startTime}-${category.endTime}`;
}

// The start date and the new shift: one of the existing shifts, or a new one
// made on the spot. `onCreatingChange` reports while the new-shift panel is
// open, so the caller keeps its confirm button off until it's done.
export const ShiftChangeFields: React.FC<{
  date: Dayjs | null;
  onDateChange: (date: Dayjs | null) => void;
  category?: string;
  onCategoryChange: (id?: string) => void;
  onCreatingChange?: (creating: boolean) => void;
  disabledDate?: (date: Dayjs) => boolean;
}> = ({ date, onDateChange, category, onCategoryChange, onCreatingChange, disabledDate }) => {
  const { selectProps: categorySelect } = useSelect<ShiftCategory>({
    resource: 'shift-categories',
    optionLabel: (item) => shiftCategoryLabel(item),
    optionValue: '_id',
    pagination: { pageSize: 100, mode: 'server' },
  });
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState<[Dayjs, Dayjs] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onCreatingChange?.(creatingNew);
  }, [creatingNew, onCreatingChange]);

  const createThenUse = async () => {
    if (!newTime) return;
    setSaving(true);
    try {
      const [start, end] = newTime;
      const res = await axiosInstance.post(`${API_URL}/shift-categories`, {
        name: newName.trim() || undefined,
        startTime: start.format('HH:mm'),
        endTime: end.format('HH:mm'),
      });
      onCategoryChange(res.data._id);
      setCreatingNew(false);
      setNewName('');
      setNewTime(null);
      invalidate({ resource: 'shift-categories', invalidates: ['list'] });
      notify?.({ type: 'success', message: 'ສ້າງກະໃໝ່ແລ້ວ' });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ສ້າງກະໃໝ່ບໍ່ສຳເລັດ' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DatePicker
        format="DD/MM/YYYY"
        value={date}
        onChange={(v) => onDateChange(v)}
        style={{ width: '100%' }}
        allowClear={false}
        disabledDate={disabledDate}
      />
      {!creatingNew ? (
        <>
          <Select
            {...categorySelect}
            placeholder="ເລືອກກະທີ່ມີ"
            style={{ width: '100%' }}
            value={category}
            onChange={(v: any) => onCategoryChange(v)}
          />
          <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setCreatingNew(true)}>
            + ສ້າງກະໃໝ່
          </Button>
        </>
      ) : (
        <div style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: 12, width: '100%' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            ສ້າງກະໃໝ່
          </Typography.Text>
          <Input
            placeholder="ຊື່ໝວດໝູ່ (ບໍ່ບັງຄັບ)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <TimePicker.RangePicker
            format="HH:mm"
            minuteStep={15}
            order={false}
            style={{ width: '100%', marginBottom: 8 }}
            value={newTime}
            onChange={(v) => setNewTime(v as [Dayjs, Dayjs] | null)}
          />
          <Space>
            <Button type="primary" size="small" loading={saving} disabled={!newTime} onClick={createThenUse}>
              ສ້າງ ແລະ ເລືອກໃຊ້
            </Button>
            <Button size="small" onClick={() => setCreatingNew(false)}>
              ຍົກເລີກ, ເລືອກຈາກລາຍການ
            </Button>
          </Space>
        </div>
      )}
    </>
  );
};
