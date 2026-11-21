import { useMemo, useState } from 'react';
import { useCustom } from '@refinedev/core';
import { Drawer, DatePicker, Space, Tag, Typography, Image, Empty, Spin, Button, Checkbox } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceDaily, ScanEvidence } from '../types';
import { API_URL } from '../providers/axios';

export interface HistoryPerson {
  _id: string;
  employeeCode?: string | null;
  name: string;
}

const WEEKDAY = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];
const STATUS: Record<string, { color: string; label: string }> = {
  present: { color: 'green', label: 'ມາວຽກ' },
  late: { color: 'orange', label: 'ຊ້າ' },
  incomplete: { color: 'purple', label: 'ສະແກນຄັ້ງດຽວ' },
  absent: { color: 'red', label: 'ຂາດວຽກ' },
  leave: { color: 'blue', label: 'ລາ' },
  substituted: { color: 'cyan', label: 'ມາແທນ' },
};
const KIND_LABEL = { in: 'ເຂົ້າ', out: 'ອອກ' } as const;
const src = (path: string) => `${API_URL}${path}`;
// A time on the shift-day itself reads HH:mm; one on another calendar day
// (an overnight out) carries its date.
const timeOn = (value: string | null | undefined, dateKey: string) => {
  if (!value) return '-';
  const d = dayjs(value);
  return d.format('YYYY-MM-DD') === dateKey ? d.format('HH:mm') : d.format('DD/MM HH:mm');
};

// One person's days, a month at a time: what the scanner recorded (status,
// in/out, late/early) beside the photos they sent from the app for that day.
// Opened from ບັນຊີແອັບພະນັກງານ and the employee's own page.
export const AppDayHistory: React.FC<{ person: HistoryPerson | null; onClose: () => void }> = ({ person, onClose }) => {
  const [month, setMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [onlyActive, setOnlyActive] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');
  const from = month.startOf('month').format('YYYY-MM-DD');
  const monthEnd = month.endOf('month').format('YYYY-MM-DD');
  const to = monthEnd < today ? monthEnd : today;
  const enabled = !!person && from <= today;

  const { data: dailyData, isLoading: dailyLoading } = useCustom<AttendanceDaily[]>({
    url: `${API_URL}/attendance-daily/range`,
    method: 'get',
    config: { query: { from, to, employee: person?._id } },
    queryOptions: { enabled },
  });
  const { data: evidenceData, isLoading: evidenceLoading } = useCustom<ScanEvidence[]>({
    url: `${API_URL}/evidence`,
    method: 'get',
    config: { query: { from, to, employee: person?._id } },
    queryOptions: { enabled },
  });

  const days = useMemo(() => {
    if (!enabled) return [];
    const dailyOf = new Map((dailyData?.data ?? []).map((d) => [d.date, d]));
    const evidenceOf = new Map<string, Partial<Record<'in' | 'out', ScanEvidence>>>();
    for (const e of evidenceData?.data ?? []) evidenceOf.set(e.date, { ...evidenceOf.get(e.date), [e.kind]: e });
    const list = [];
    for (let d = dayjs(to); d.format('YYYY-MM-DD') >= from; d = d.subtract(1, 'day')) {
      const key = d.format('YYYY-MM-DD');
      list.push({ key, day: d, daily: dailyOf.get(key), evidence: evidenceOf.get(key) ?? {} });
    }
    return list;
  }, [enabled, dailyData?.data, evidenceData?.data, from, to]);

  const shown = onlyActive ? days.filter((d) => d.daily || d.evidence.in || d.evidence.out) : days;
  const withPhotos = days.filter((d) => d.evidence.in || d.evidence.out).length;
  const bothPhotos = days.filter((d) => d.evidence.in && d.evidence.out).length;
  const worked = days.filter((d) => d.daily && ['present', 'late', 'incomplete'].includes(d.daily.status)).length;

  const photo = (e: ScanEvidence | undefined, kind: 'in' | 'out') => (
    <div style={{ width: 96, textAlign: 'center' }} className={`history-photo history-photo-${kind}`}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        ຮູບ{KIND_LABEL[kind]}
      </Typography.Text>
      {e ? (
        <>
          <Image.PreviewGroup items={[src(e.photoUrl), ...e.history.map((h) => src(h.photoUrl))]}>
            <Image
              src={src(e.thumbUrl)}
              preview={{ src: src(e.photoUrl) }}
              width={96}
              height={72}
              style={{ objectFit: 'cover', borderRadius: 6 }}
            />
          </Image.PreviewGroup>
          <div style={{ fontSize: 11, lineHeight: 1.4 }}>ຖ່າຍ {e.takenAt ? dayjs(e.takenAt).format('HH:mm') : '-'}</div>
          <Space size={2} wrap style={{ justifyContent: 'center' }}>
            {e.backdated && <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>ຍ້ອນຫຼັງ</Tag>}
            {e.editedAt && <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11 }}>ແກ້ໄຂ</Tag>}
            {e.duplicate && <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11 }}>ຮູບຊ້ຳ</Tag>}
          </Space>
        </>
      ) : (
        <div style={{ width: 96, height: 72, borderRadius: 6, border: '1px dashed #d9d9d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#999' }}>
          ບໍ່ມີຮູບ
        </div>
      )}
    </div>
  );

  return (
    <Drawer
      open={!!person}
      onClose={onClose}
      width="min(640px, 100vw)"
      title={`ປະຫວັດລາຍວັນ — ${person?.employeeCode ?? '-'} ${person?.name ?? ''}`}
      className="app-day-history"
      destroyOnClose
      // Esc closes a photo opened large, not the whole history behind it.
      keyboard={false}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<LeftOutlined />} onClick={() => setMonth(month.subtract(1, 'month'))} aria-label="ເດືອນກ່ອນ" />
        <DatePicker
          picker="month"
          value={month}
          allowClear={false}
          format="MM/YYYY"
          disabledDate={(d) => d.isAfter(dayjs(), 'month')}
          onChange={(d) => d && setMonth(d.startOf('month'))}
        />
        <Button
          icon={<RightOutlined />}
          onClick={() => setMonth(month.add(1, 'month'))}
          disabled={!month.isBefore(dayjs(), 'month')}
          aria-label="ເດືອນຖັດໄປ"
        />
        <Checkbox checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="history-only-active">
          ສະເພາະມື້ທີ່ມີຂໍ້ມູນ
        </Checkbox>
      </Space>
      <Space wrap style={{ marginBottom: 12 }} className="history-summary">
        <Tag>ມາວຽກ {worked} ມື້</Tag>
        <Tag color="purple">ມີຮູບ {withPhotos} ມື້</Tag>
        <Tag color="green">ຄົບ ເຂົ້າ-ອອກ {bothPhotos} ມື້</Tag>
      </Space>
      {dailyLoading || evidenceLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : !shown.length ? (
        <Empty description="ບໍ່ມີຂໍ້ມູນໃນເດືອນນີ້" />
      ) : (
        <div className="history-days">
          {shown.map(({ key, day, daily, evidence }) => {
            const status = daily ? STATUS[daily.status] : undefined;
            return (
              <div
                key={key}
                className="history-day"
                data-date={key}
                style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0', alignItems: 'flex-start' }}
              >
                <div style={{ width: 92, flexShrink: 0 }}>
                  <Typography.Text strong>{day.format('DD/MM')}</Typography.Text>
                  <div style={{ fontSize: 12, color: '#888' }}>{WEEKDAY[day.day()]}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }} className="history-scan">
                  {daily ? (
                    <>
                      <Tag color={status?.color}>{status?.label ?? daily.status}</Tag>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        ເຂົ້າ <b>{timeOn(daily.firstIn, key)}</b> · ອອກ <b>{timeOn(daily.lastOut, key)}</b>
                      </div>
                      {daily.shiftStart && daily.shiftEnd && (
                        <div style={{ fontSize: 12, color: '#888' }}>
                          ກະ {daily.shiftStart}-{daily.shiftEnd}
                        </div>
                      )}
                      <Space size={4} wrap style={{ marginTop: 2 }}>
                        {daily.lateMinutes > 0 && <Typography.Text type="warning" style={{ fontSize: 12 }}>ຊ້າ {daily.lateMinutes} ນາທີ</Typography.Text>}
                        {daily.earlyLeaveMinutes > 0 && <Typography.Text type="warning" style={{ fontSize: 12 }}>ອອກກ່ອນ {daily.earlyLeaveMinutes} ນາທີ</Typography.Text>}
                      </Space>
                      {daily.disciplinaryNote && <div style={{ fontSize: 12, color: '#cf1322' }}>{daily.disciplinaryNote}</div>}
                    </>
                  ) : (
                    <Typography.Text type="secondary">ບໍ່ມີການສະແກນ</Typography.Text>
                  )}
                </div>
                {photo(evidence.in, 'in')}
                {photo(evidence.out, 'out')}
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
};
