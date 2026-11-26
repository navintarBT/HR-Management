import { useMemo } from 'react';
import { useCustom } from '@refinedev/core';
import { Alert, Button, Modal, Space, Spin, Tag, Typography } from 'antd';
import { CommentOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AttendanceDaily, Employee, ScanEvidence } from '../../types';
import { API_URL } from '../../providers/axios';
import { ScanEvidenceView } from '../../components/ScanEvidenceView';

// What ສະຫຼຸບເງິນເດືອນ already worked out about one cell, handed over as plain
// facts — the page owns the rules (classifyDay and friends), this only shows
// them next to what really happened that day.
export interface DayFacts {
  employee: Employee;
  dateKey: string;
  label: string;
  meaning: string;
  colors: { bg: string; text: string };
  // The bar under the cell, if it has one, and what it means.
  flag?: { color: string; text: string };
  // Why the cell reads as it does: the rest day in force, the leave, the tier…
  reasons: string[];
  shift?: string;
  daily?: AttendanceDaily;
}

// One punch around the day (server: GET /attendance-logs/day).
interface DayScan {
  _id: string;
  timestamp: string;
  deviceId: string | null;
  deviceName: string | null;
  manual: boolean;
  voided: boolean;
  note: string | null;
  editedBy: string | null;
  inWindow: boolean;
}
interface DayScans {
  windowStart: string;
  windowEnd: string;
  scans: DayScan[];
}

const hm = (v?: string | null) => (v ? dayjs(v).format('HH:mm') : '--:--');
// A time on another calendar day than the shift-day says which.
const at = (v: string, dateKey: string) => (dayjs(v).format('YYYY-MM-DD') === dateKey ? hm(v) : `${hm(v)} (${dayjs(v).format('DD/MM')})`);
const sameMinute = (a?: string | null, b?: string | null) => !!a && !!b && dayjs(a).isSame(dayjs(b), 'minute');

const STATUS_TEXT: Record<AttendanceDaily['status'], string> = {
  present: 'ມາເຮັດວຽກ',
  late: 'ມາຊ້າ',
  absent: 'ຂາດວຽກ',
  leave: 'ລາ',
  incomplete: 'ສະແກນຄັ້ງດຽວ',
  substituted: 'ມີຄົນມາແທນ',
};

function sourceTag(s: DayScan) {
  if (s.manual) return <Tag color="orange">HR ປ້ອນເອງ</Tag>;
  if (s.deviceId === 'SIMULATOR') return <Tag>ຈຳລອງ</Tag>;
  const name = s.deviceName || (s.deviceId ? `…${s.deviceId.slice(-4)}` : '?');
  return <Tag color="green">ເຄື່ອງສະແກນ {name}</Tag>;
}

// "Did they really scan?" — answered first, in one line, before the details.
function verdict(daily: AttendanceDaily | undefined, counted: DayScan[], replaced: DayScan[]) {
  const device = counted.filter((s) => !s.manual && s.deviceId !== 'SIMULATOR');
  const manual = counted.filter((s) => s.manual);
  const replacedTimes = replaced.map((s) => hm(s.timestamp)).join(', ');
  if (daily?.autoFilledReason) return { type: 'info' as const, text: `ລົງເວລາແທນ ເພາະລະບົບສະແກນເສຍ: ${daily.autoFilledReason}` };
  if (daily?.disciplinaryNote) return { type: 'error' as const, text: `ບັນທຶກເປັນຂາດວຽກແບບລົງໂທດ: ${daily.disciplinaryNote}` };
  if (manual.length && !device.length) {
    return {
      type: 'warning' as const,
      text: replaced.length ? `ເວລາມື້ນີ້ HR ປ້ອນເອງ ແທນສະແກນຈາກເຄື່ອງ (ເຄື່ອງບັນທຶກໄວ້ ${replacedTimes})` : 'ເວລາມື້ນີ້ HR ປ້ອນເອງ — ບໍ່ມີສະແກນຈາກເຄື່ອງ',
    };
  }
  if (manual.length) return { type: 'warning' as const, text: `ມີທັງສະແກນຈາກເຄື່ອງ ${device.length} ຄັ້ງ ແລະ ເວລາທີ່ HR ປ້ອນເອງ` };
  if (device.length === 1) return { type: 'warning' as const, text: 'ສະແກນຈາກເຄື່ອງແທ້ — ແຕ່ຄັ້ງດຽວ (ບໍ່ມີເຂົ້າ ຫຼື ອອກ)' };
  if (device.length) return { type: 'success' as const, text: `ສະແກນຈາກເຄື່ອງແທ້ ${device.length} ຄັ້ງ` };
  if (daily?.status === 'substituted') return { type: 'info' as const, text: 'ບໍ່ມີການສະແກນ — ມີຄົນມາແທນ' };
  return { type: 'error' as const, text: 'ບໍ່ມີການສະແກນໃນມື້ນີ້' };
}

export const DayDetailModal: React.FC<{
  facts: DayFacts | null;
  onClose: () => void;
  // Off to ປະຫວັດການສະແກນ, to that person's row and day.
  onEdit: (facts: DayFacts) => void;
  // The cell's comments are a window of their own: this one closes and that
  // one opens. `comments`: how many and whether confirmed, '' when none.
  onComments: (facts: DayFacts) => void;
  comments: string;
}> = ({ facts, onClose, onEdit, onComments, comments }) => {
  const open = !!facts;
  const employeeId = facts?.employee._id;
  const dateKey = facts?.dateKey ?? '';

  const { data: scansData, isLoading: scansLoading } = useCustom<DayScans>({
    url: `${API_URL}/attendance-logs/day`,
    method: 'get',
    config: { query: { employee: employeeId, date: dateKey } },
    queryOptions: { enabled: open && !!employeeId },
  });
  const { data: evidenceData, isLoading: evidenceLoading } = useCustom<ScanEvidence[]>({
    url: `${API_URL}/evidence`,
    method: 'get',
    config: { query: { employee: employeeId, from: dateKey, to: dateKey } },
    queryOptions: { enabled: open && !!employeeId },
  });

  const slots = useMemo(() => {
    const map: Partial<Record<'in' | 'out', ScanEvidence>> = {};
    for (const e of evidenceData?.data ?? []) if (e.employee === employeeId && e.date === dateKey) map[e.kind] = e;
    return map;
  }, [evidenceData?.data, employeeId, dateKey]);

  if (!facts) return <Modal open={false} footer={null} onCancel={onClose} />;
  const { employee, daily } = facts;
  const scans = scansData?.data?.scans ?? [];
  const counted = scans.filter((s) => s.inWindow && !s.voided);
  const replaced = scans.filter((s) => s.inWindow && s.voided);
  const judged = scansData?.data ? verdict(daily, counted, replaced) : null;
  const photos = (slots.in ? 1 : 0) + (slots.out ? 1 : 0);
  const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={760}
      title={`${employee.employeeCode ?? ''} ${name} — ${dayjs(dateKey).format('dddd DD/MM/YYYY')}`}
      className="payroll-no-print day-detail"
      destroyOnClose
      footer={
        <Space>
          <Button icon={<CommentOutlined />} onClick={() => onComments(facts)} className="day-detail-comments">
            ຄອມເມັ້ນ{comments ? ` (${comments})` : ''}
          </Button>
          <Button onClick={onClose}>ປິດ</Button>
          <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit(facts)} className="day-detail-edit">
            ໄປແກ້ໄຂໃນ ປະຫວັດການສະແກນ
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="start" size={12}>
          <div
            style={{
              minWidth: 44,
              textAlign: 'center',
              padding: '6px 8px',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 16,
              background: facts.colors.bg === 'transparent' ? '#fafafa' : facts.colors.bg,
              color: facts.colors.text === 'inherit' ? undefined : facts.colors.text,
              border: '1px solid #f0f0f0',
            }}
          >
            {facts.label || '·'}
          </div>
          <div style={{ lineHeight: 1.6 }}>
            <Typography.Text strong>{facts.meaning}</Typography.Text>
            {facts.flag && (
              <div>
                <span style={{ display: 'inline-block', width: 22, height: 4, borderRadius: 2, background: facts.flag.color, verticalAlign: 'middle', marginRight: 6 }} />
                <Typography.Text style={{ color: facts.flag.color }}>{facts.flag.text}</Typography.Text>
              </div>
            )}
            {facts.reasons.map((r) => (
              <div key={r}>
                <Typography.Text type="secondary">{r}</Typography.Text>
              </div>
            ))}
            {facts.shift && (
              <div>
                <Typography.Text type="secondary">{facts.shift}</Typography.Text>
              </div>
            )}
          </div>
        </Space>

        {scansLoading || !judged ? (
          <Spin size="small" />
        ) : (
          <Alert
            className="day-detail-verdict"
            type={judged.type}
            showIcon
            message={
              <span>
                {judged.text}
                <span style={{ marginLeft: 8, opacity: 0.8 }}>
                  · ຮູບຫຼັກຖານ: {evidenceLoading ? '…' : photos === 2 ? 'ຄົບ ເຂົ້າ-ອອກ' : photos === 1 ? (slots.in ? 'ມີແຕ່ເຂົ້າ' : 'ມີແຕ່ອອກ') : 'ບໍ່ມີ'}
                </span>
              </span>
            }
          />
        )}

        <div>
          <Typography.Text strong>ທີ່ໃຊ້ຄິດມື້ນີ້</Typography.Text>
          <div style={{ marginTop: 4 }}>
            {daily ? (
              <Space wrap size={[16, 4]}>
                <span>ເຂົ້າ {daily.firstIn ? at(daily.firstIn, dateKey) : '--:--'}</span>
                <span>ອອກ {daily.lastOut ? at(daily.lastOut, dateKey) : '--:--'}</span>
                {daily.workedHours > 0 && <span>ເຮັດ {daily.workedHours.toFixed(1)} ຊມ</span>}
                <Tag color={daily.status === 'absent' ? 'red' : daily.status === 'late' ? 'orange' : daily.status === 'incomplete' ? 'purple' : 'green'}>
                  {STATUS_TEXT[daily.status]}
                  {daily.status === 'late' && daily.lateMinutes ? ` ${daily.lateMinutes} ນາທີ` : ''}
                  {daily.status === 'absent' && daily.absenceSeverity ? ` ${daily.absenceSeverity}` : ''}
                </Tag>
              </Space>
            ) : (
              <Typography.Text type="secondary">ບໍ່ມີບັນທຶກການເຂົ້າວຽກຂອງມື້ນີ້</Typography.Text>
            )}
          </div>
        </div>

        <div>
          <Typography.Text strong>ການສະແກນ</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {scansData?.data ? `ນັບໃຫ້ມື້ນີ້: ${at(scansData.data.windowStart, dateKey)} – ${at(scansData.data.windowEnd, dateKey)}` : ''}
          </Typography.Text>
          <div style={{ marginTop: 4 }} className="day-detail-scans">
            {scansLoading ? (
              <Spin size="small" />
            ) : scans.length === 0 ? (
              <Typography.Text type="secondary">ບໍ່ມີການສະແກນຈັກຄັ້ງ</Typography.Text>
            ) : (
              scans.map((s) => {
                const before = dayjs(s.timestamp).isBefore(scansData?.data?.windowStart);
                const role = s.inWindow && !s.voided ? (sameMinute(s.timestamp, daily?.firstIn) ? 'ເຂົ້າ' : sameMinute(s.timestamp, daily?.lastOut) ? 'ອອກ' : null) : null;
                return (
                  <div
                    key={s._id}
                    data-scan={s.inWindow ? (s.voided ? 'replaced' : 'counted') : 'other-day'}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: s.inWindow && !s.voided ? 1 : 0.55 }}
                  >
                    <span style={{ width: 92, fontVariantNumeric: 'tabular-nums', textDecoration: s.voided ? 'line-through' : undefined }}>{at(s.timestamp, dateKey)}</span>
                    {sourceTag(s)}
                    {role && <Tag color="blue">{role}</Tag>}
                    {s.voided && <Tag>ຖືກແທນດ້ວຍການແກ້ໄຂ</Tag>}
                    {!s.inWindow && <Tag>{before ? 'ນັບໃຫ້ມື້ກ່ອນ' : 'ນັບໃຫ້ມື້ຖັດໄປ'}</Tag>}
                    {s.manual && (s.note || s.editedBy) && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {[s.note, s.editedBy].filter(Boolean).join(' · ')}
                      </Typography.Text>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <Typography.Text strong>ຮູບຫຼັກຖານຈາກແອັບພະນັກງານ</Typography.Text>
          <div style={{ marginTop: 6 }}>{evidenceLoading ? <Spin size="small" /> : <ScanEvidenceView slots={slots} />}</div>
        </div>

      </Space>
    </Modal>
  );
};
