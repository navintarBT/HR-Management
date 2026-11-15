import { useEffect, useMemo, useState } from 'react';
import { useList, useNotification } from '@refinedev/core';
import { Alert, Checkbox, DatePicker, Modal, Segmented, Select, Space, Table, Tag, TimePicker, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { DayTimePlan, ShiftCategory } from '../../types';
import { shiftCategoryLabel } from '../../components/ShiftChangeAhead';

type Person = DayTimePlan['people'][number];

// The longest run of days one round takes (server/src/utils/dayTimeRounds.js).
const MAX_DAYS = 31;

const dayLabel = (date: string) => dayjs(date).format('ddd DD/MM');

// ປັບເວລາສະເພາະມື້ on ແກ້ໄຂກະແບບກຸ່ມ (2026-11-16): one working time for the
// people picked, on one day or a run of days — their regular shift stays as
// it is. What it would do is asked as soon as days and a time are in (who gets
// it, who's left out and why), and that is what saving does.
export const DayTimeDialog: React.FC<{ open: boolean; employeeIds: string[]; onClose: () => void; onSaved: () => void }> = ({
  open,
  employeeIds,
  onClose,
  onSaved,
}) => {
  const { open: notify } = useNotification();
  const [mode, setMode] = useState<'one' | 'range'>('one');
  const [day, setDay] = useState<Dayjs | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [category, setCategory] = useState<string>();
  const [time, setTime] = useState<[Dayjs, Dayjs] | null>(null);
  // ບັນທຶກເວລາເຂົ້າ-ອອກຕາມເວລານີ້: the days over are recorded as worked at the
  // time itself, scans set aside (for whoever scanned that day).
  const [asWorked, setAsWorked] = useState(false);
  const [preview, setPreview] = useState<{ key: string; plan?: DayTimePlan; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('one');
    setDay(null);
    setRange(null);
    setCategory(undefined);
    setTime(null);
    setAsWorked(false);
    setPreview(null);
  }, [open]);

  const { data: categoriesData } = useList<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 200 },
    queryOptions: { enabled: open },
  });
  const categories = categoriesData?.data ?? [];
  const pickCategory = (id?: string) => {
    setCategory(id);
    const c = categories.find((x) => x._id === id);
    if (c) setTime([dayjs(`2000-01-01T${c.startTime}`), dayjs(`2000-01-01T${c.endTime}`)]);
  };
  // Typing a time of its own lets go of the shift it was taken from.
  const pickTime = (value: [Dayjs, Dayjs] | null) => {
    setTime(value);
    const c = categories.find((x) => x._id === category);
    if (c && (!value || value[0].format('HH:mm') !== c.startTime || value[1].format('HH:mm') !== c.endTime)) setCategory(undefined);
  };

  const from = mode === 'one' ? day : range?.[0] ?? null;
  const to = mode === 'one' ? day : range?.[1] ?? null;
  const request = useMemo(() => {
    if (!from || !to || !time || !employeeIds.length) return null;
    return {
      employees: employeeIds,
      from: from.format('YYYY-MM-DD'),
      to: to.format('YYYY-MM-DD'),
      startTime: time[0].format('HH:mm'),
      endTime: time[1].format('HH:mm'),
      category,
      asWorked,
    };
  }, [from, to, time, employeeIds, category, asWorked]);
  const requestKey = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!open || !request || !requestKey) return;
    let stale = false;
    const timer = setTimeout(() => {
      axiosInstance
        .post<DayTimePlan>(`${API_URL}/bulk-edits/day-time/preview`, request)
        .then(({ data }) => !stale && setPreview({ key: requestKey, plan: data }))
        .catch((err) => !stale && setPreview({ key: requestKey, error: err?.response?.data?.message || 'ກວດບໍ່ສຳເລັດ' }));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestKey]);

  const current = preview && preview.key === requestKey ? preview : null;
  const plan = current?.plan;
  const skippedByReason = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plan?.people ?? []) for (const d of p.days) if (!d.set && !d.rejudge && d.reason) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    return [...counts];
  }, [plan]);
  const peopleSet = (plan?.people ?? []).filter((p) => p.days.some((d) => d.set || d.rejudge)).length;
  // Days the save does something on: a time of their own, or judged again by their shift.
  const doCount = (plan?.setCount ?? 0) + (plan?.rejudgeCount ?? 0);

  const save = async () => {
    if (!request || !doCount) return;
    setSaving(true);
    try {
      const { data } = await axiosInstance.post<{
        setCount: number;
        rejudgeCount: number;
        skipCount: number;
        pastCount: number;
        asWorkedCount?: number;
      }>(`${API_URL}/bulk-edits/day-time`, request);
      const judged = data.pastCount + data.rejudgeCount;
      notify?.({
        type: 'success',
        message: `${data.setCount ? `ປັບເວລາ ${plan!.time} ແລ້ວ ${data.setCount} ມື້` : 'ບັນທຶກແລ້ວ'}${data.skipCount ? ` · ຂ້າມ ${data.skipCount} ມື້` : ''}`,
        description:
          [
            data.asWorkedCount ? `ບັນທຶກເຂົ້າ-ອອກຕາມເວລານີ້ ${data.asWorkedCount} ມື້` : '',
            judged ? `ຕັດສິນການສະແກນໃໝ່ແລ້ວ ${judged} ມື້` : '',
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSaving(false);
    }
  };

  // Days done that can't be recorded as worked, and why.
  const asWorkedNotes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plan?.people ?? []) for (const d of p.days) if (d.asWorkedNote) counts.set(d.asWorkedNote, (counts.get(d.asWorkedNote) ?? 0) + 1);
    return [...counts];
  }, [plan]);

  const beforeOf = (p: Person) => [...new Set(p.days.filter((d) => d.set || d.rejudge).map((d) => d.before))].join(', ');

  return (
    <Modal
      title={`ປັບເວລາສະເພາະມື້ — ${employeeIds.length} ຄົນ`}
      open={open}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      okText={doCount ? `ບັນທຶກ (${doCount} ມື້)` : 'ບັນທຶກ'}
      okButtonProps={{ disabled: !doCount }}
      cancelText="ປິດ"
      width={760}
      destroyOnClose
      className="day-time-dialog"
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          ໃຊ້ເວລານີ້ສະເພາະມື້ທີ່ເລືອກ ແທນເວລາປົກກະຕິ — ກະປະຈຳບໍ່ປ່ຽນ. ມື້ທີ່ຜ່ານມາແລ້ວ ການສະແກນຂອງມື້ນັ້ນຈະຖືກຕັດສິນໃໝ່ຕາມເວລາໃໝ່.
          ຍົກເລີກໄດ້ທັງຮອບທີ່ ປະຫວັດການແກ້ໄຂ ຫຼື ທີລະຄົນທີ່ ຕັ້ງຄ່າແຜນວຽກ (ຄືນຄ່າປົກກະຕິ).
        </Typography.Text>
        <Space wrap align="center">
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'one' | 'range')}
            options={[
              { label: 'ມື້ດຽວ', value: 'one' },
              { label: 'ຫຼາຍມື້', value: 'range' },
            ]}
          />
          {mode === 'one' ? (
            <DatePicker className="day-time-date" value={day} onChange={setDay} format="DD/MM/YYYY" placeholder="ເລືອກວັນທີ" />
          ) : (
            <DatePicker.RangePicker
              className="day-time-range"
              value={range}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              format="DD/MM/YYYY"
              placeholder={['ແຕ່ວັນທີ', 'ຫາວັນທີ']}
            />
          )}
        </Space>
        <Space wrap align="center">
          <Select
            className="day-time-category"
            style={{ width: 240 }}
            placeholder="ເລືອກຈາກກະ (ຕື່ມເວລາໃຫ້)"
            allowClear
            showSearch
            optionFilterProp="label"
            value={category}
            onChange={(v) => pickCategory(v)}
            options={categories.map((c) => ({ value: c._id, label: shiftCategoryLabel(c) }))}
          />
          <Typography.Text type="secondary">ຫຼື ໃສ່ເວລາເອງ</Typography.Text>
          <TimePicker.RangePicker
            className="day-time-time"
            value={time}
            onChange={(v) => pickTime(v && v[0] && v[1] ? [v[0], v[1]] : null)}
            format="HH:mm"
            minuteStep={5}
            order={false}
            placeholder={['ເຂົ້າ', 'ອອກ']}
          />
        </Space>
        <div>
          <Checkbox className="day-time-as-worked" checked={asWorked} onChange={(e) => setAsWorked(e.target.checked)}>
            ບັນທຶກເວລາເຂົ້າ-ອອກຕາມເວລານີ້ເລີຍ (ບໍ່ເອົາເວລາສະແກນ — ບໍ່ນັບຊ້າ / ອອກກ່ອນ)
          </Checkbox>
          {asWorked && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ສະເພາະມື້ທີ່ຜ່ານມາແລ້ວ ແລະ ຄົນທີ່ມີການສະແກນມື້ນັ້ນ — ຄົນທີ່ບໍ່ໄດ້ສະແກນຍັງເປັນຂາດ. ການສະແກນຈິງບໍ່ຖືກລຶບ: ຍົກເລີກທັງຮອບແລ້ວກັບມາໃຊ້ຄືເກົ່າ
              </Typography.Text>
            </div>
          )}
        </div>
        {mode === 'range' && range && range[1].diff(range[0], 'day') + 1 > MAX_DAYS && (
          <Typography.Text type="danger">ເລືອກໄດ້ສູງສຸດ {MAX_DAYS} ມື້ຕໍ່ຮອບ</Typography.Text>
        )}

        {request && !current && <Typography.Text type="secondary">ກຳລັງກວດ…</Typography.Text>}
        {current?.error && <Alert type="error" showIcon message={current.error} />}
        {plan && (
          <>
            <Alert
              className="day-time-summary"
              type={doCount ? 'info' : 'warning'}
              showIcon
              message={
                doCount
                  ? `ຈະໃຊ້ເວລາ ${plan.time}: ${doCount} ມື້ (${peopleSet} ຄົນ)${plan.skipCount ? ` · ຂ້າມ ${plan.skipCount} ມື້` : ''}`
                  : 'ບໍ່ມີມື້ໃດໃຫ້ປັບ — ທຸກມື້ທີ່ເລືອກຖືກຂ້າມ'
              }
              description={
                <Space direction="vertical" size={2}>
                  {plan.asWorked && (
                    <span>
                      ບັນທຶກເຂົ້າ-ອອກຕາມເວລານີ້ເລີຍ: {plan.asWorkedCount} ມື້
                      {asWorkedNotes.length > 0 && ` (ບໍ່ໄດ້: ${asWorkedNotes.map(([note, n]) => `${note}${n > 1 ? ` ${n}` : ''}`).join(' · ')})`}
                    </span>
                  )}
                  {plan.pastCount > 0 && <span>ມື້ທີ່ຜ່ານມາແລ້ວ {plan.pastCount} ມື້ — ຈະຕັດສິນການສະແກນໃໝ່ຕາມເວລາໃໝ່</span>}
                  {plan.rejudgeCount > 0 && (
                    <span>
                      {plan.rejudgeCount} ມື້ເວລາຄືກະປົກກະຕິຢູ່ແລ້ວ — ຈະຕັດສິນການສະແກນມື້ນັ້ນໃໝ່ຕາມກະ
                      {!plan.asWorked && ' (ບໍ່ມີຫຍັງໃຫ້ຍົກເລີກພາຍຫຼັງ)'}
                    </span>
                  )}
                  {skippedByReason.length > 0 && (
                    <span>
                      ຂ້າມ: {skippedByReason.map(([reason, n]) => `${reason}${n > 1 ? ` (${n})` : ''}`).join(' · ')}
                    </span>
                  )}
                </Space>
              }
            />
            <Table<Person>
              className="day-time-people"
              rowKey="employee"
              size="small"
              dataSource={plan.people}
              pagination={plan.people.length > 50 ? { pageSize: 50, size: 'small', showSizeChanger: false } : false}
              // Long reasons wrap inside the dialog instead of scrolling it sideways.
              scroll={{ y: 320 }}
            >
              <Table.Column<Person> title="ລະຫັດ" dataIndex="employeeCode" width={80} render={(v) => v ?? '-'} />
              <Table.Column<Person> title="ຊື່" dataIndex="name" width={170} render={(v) => v ?? '-'} />
              <Table.Column<Person>
                title="ເວລາ"
                width={190}
                render={(_, p) =>
                  p.days.some((d) => d.set || d.rejudge) ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <Typography.Text type="secondary">{beforeOf(p)}</Typography.Text>
                      <ArrowRightOutlined style={{ fontSize: 10, margin: '0 6px' }} />
                      <Typography.Text strong>{plan.time}</Typography.Text>
                    </span>
                  ) : (
                    '-'
                  )
                }
              />
              <Table.Column<Person>
                title="ຜົນ"
                render={(_, p) => {
                  const set = p.days.filter((d) => d.set);
                  const rejudged = p.days.filter((d) => d.rejudge);
                  const worked = p.days.filter((d) => d.asWorked);
                  const notWorked = p.days.filter((d) => d.asWorkedNote);
                  // Left-out days grouped by why, with their dates on a run of days.
                  const skipped = new Map<string, string[]>();
                  for (const d of p.days) if (!d.set && !d.rejudge) skipped.set(d.reason ?? '-', [...(skipped.get(d.reason ?? '-') ?? []), d.date]);
                  return (
                    <Space direction="vertical" size={0}>
                      {set.length > 0 && (
                        <Tag color="green">{plan.dates.length > 1 ? `ປັບ ${set.length} ມື້` : 'ປັບ'}</Tag>
                      )}
                      {rejudged.length > 0 && (
                        <Tag color="blue">{plan.dates.length > 1 ? `ຕັດສິນໃໝ່ຕາມກະ ${rejudged.length} ມື້` : 'ຕັດສິນໃໝ່ຕາມກະ'}</Tag>
                      )}
                      {worked.length > 0 && (
                        <Tag color="purple">{plan.dates.length > 1 ? `ບັນທຶກຕາມເວລານີ້ ${worked.length} ມື້` : 'ບັນທຶກຕາມເວລານີ້'}</Tag>
                      )}
                      {notWorked.map((d) => (
                        <Typography.Text key={`w${d.date}`} type="secondary" style={{ fontSize: 12 }}>
                          {plan.dates.length > 1 ? `${dayLabel(d.date)}: ` : ''}
                          {d.asWorkedNote}
                        </Typography.Text>
                      ))}
                      {[...skipped].map(([reason, dates]) => (
                        <Typography.Text key={reason} type="secondary" style={{ fontSize: 12 }}>
                          ຂ້າມ — {reason}
                          {plan.dates.length > 1 ? `: ${dates.map(dayLabel).join(', ')}` : ''}
                        </Typography.Text>
                      ))}
                    </Space>
                  );
                }}
              />
            </Table>
          </>
        )}
      </Space>
    </Modal>
  );
};
