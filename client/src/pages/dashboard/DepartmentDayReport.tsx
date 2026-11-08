import { useEffect, useMemo, useState } from 'react';
import { useCustom } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, DatePicker, Empty, Skeleton, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, ArrowRightOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL } from '../../providers/axios';
import { palette, tint } from '../../theme/palette';
import { LeaveTypeTag } from '../../components/StatusTags';
import type { DepartmentDayBucket, DepartmentDayGroup, DepartmentDayPerson, DepartmentDayReport, DepartmentDaySwap } from '../../types';

// ລາຍງານແຕ່ລະພະແນກ on the dashboard: for one day, how many in each department
// came, were absent, resting, on leave or not in yet — and who — plus the
// ສະຫຼັບກະ still waiting that touch each department (server:
// routes/dashboard.js /department-day).

const BUCKETS: { key: DepartmentDayBucket; label: string; color: string }[] = [
  { key: 'came', label: 'ມາ', color: palette.success },
  { key: 'absent', label: 'ຂາດ', color: palette.error },
  { key: 'rest', label: 'ພັກ', color: '#64748B' },
  { key: 'leave', label: 'ລາ', color: palette.leave },
  { key: 'pending', label: 'ຍັງບໍ່ມາ', color: palette.warning },
  { key: 'other', label: 'ບໍ່ມີຂໍ້ມູນ', color: '#94A3B8' },
];
const BUCKET = Object.fromEntries(BUCKETS.map((b) => [b.key, b])) as Record<DepartmentDayBucket, (typeof BUCKETS)[number]>;

function CountChip({ bucket, value, extra }: { bucket: DepartmentDayBucket; value: number; extra?: string }) {
  if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
  const { color } = BUCKET[bucket];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ background: tint(color, 0.12), color, borderRadius: 6, padding: '1px 10px', fontWeight: 600 }}>{value}</span>
      {extra && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {extra}
        </Typography.Text>
      )}
    </span>
  );
}

function PersonLine({ person, bucket }: { person: DepartmentDayPerson; bucket: DepartmentDayBucket }) {
  const details: React.ReactNode[] = [];
  if (bucket === 'came' && person.firstIn) details.push(`ເຂົ້າ ${dayjs(person.firstIn).format('HH:mm')}`);
  if (bucket === 'pending' && person.shift) details.push(`ກະ ${person.shift}`);
  return (
    <div className="dept-day-person" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2, padding: '3px 0' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 42 }}>
        {person.employeeCode}
      </Typography.Text>
      <Typography.Text strong>{person.name}</Typography.Text>
      {person.position && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          · {person.position}
        </Typography.Text>
      )}
      {details.map((d) => (
        <Typography.Text key={String(d)} style={{ fontSize: 12 }}>
          · {d}
        </Typography.Text>
      ))}
      {bucket === 'leave' && person.leaveType && <LeaveTypeTag type={person.leaveType} />}
      {bucket === 'pending' &&
        (person.overdue ? (
          <Tag color="orange" style={{ marginInlineEnd: 0 }}>
            ເລີຍເວລາເຂົ້າແລ້ວ
          </Tag>
        ) : (
          <Tag style={{ marginInlineEnd: 0 }}>ຍັງບໍ່ຮອດເວລາ</Tag>
        ))}
      {person.note && (
        <Tag color={person.late ? 'orange' : undefined} style={{ marginInlineEnd: 0 }}>
          {person.note}
        </Tag>
      )}
    </div>
  );
}

function SwapLine({ swap }: { swap: DepartmentDaySwap }) {
  return (
    <div style={{ padding: '2px 0' }}>
      <Tag color="gold">{dayjs(swap.effectiveDate).format('DD/MM/YYYY')}</Tag>
      <Typography.Text>
        {swap.positionA} ({swap.peopleA} ຄົນ) ⇄ {swap.positionB} ({swap.peopleB} ຄົນ)
      </Typography.Text>
    </div>
  );
}

// Who, by what they did — one block per kind that has anyone in it.
function DepartmentPeople({ group }: { group: DepartmentDayGroup }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
      {BUCKETS.filter((b) => group.people[b.key].length).map((b) => (
        <div
          key={b.key}
          className={`dept-day-block dept-day-${b.key}`}
          style={{ border: `1px solid ${tint(b.color, 0.35)}`, borderRadius: 8, overflow: 'hidden' }}
        >
          <div style={{ background: tint(b.color, 0.12), color: b.color, fontWeight: 600, padding: '4px 10px' }}>
            {b.label} {group.people[b.key].length} ຄົນ
          </div>
          <div style={{ padding: '4px 10px' }}>
            {group.people[b.key].map((p) => (
              <PersonLine key={p._id} person={p} bucket={b.key} />
            ))}
          </div>
        </div>
      ))}
      {group.swaps.length > 0 && (
        <div className="dept-day-block dept-day-swaps" style={{ border: `1px solid ${tint('#D4A017', 0.5)}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: tint('#D4A017', 0.15), color: '#8A6A00', fontWeight: 600, padding: '4px 10px' }}>
            <SwapOutlined /> ແຜນສະຫຼັບກະທີ່ລໍຖ້າ {group.swaps.length}
          </div>
          <div style={{ padding: '4px 10px' }}>
            {group.swaps.map((s) => (
              <SwapLine key={s._id} swap={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DepartmentDayReportCard({ refreshSignal }: { refreshSignal: number }) {
  const [date, setDate] = useState<Dayjs>(() => dayjs());
  const dateKey = date.format('YYYY-MM-DD');
  const query = useCustom<DepartmentDayReport>({
    url: `${API_URL}/dashboard/department-day`,
    method: 'get',
    config: { query: { date: dateKey } },
    errorNotification: false,
  });
  const report = query.data?.data;
  useEffect(() => {
    if (refreshSignal) query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const [expanded, setExpanded] = useState<string[]>([]);
  const allKeys = useMemo(() => (report?.departments ?? []).map((d) => d._id), [report]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => expanded.includes(k));
  const isToday = dateKey === dayjs().format('YYYY-MM-DD');
  const showOther = !!report?.totals.other;

  // Departments with a swap waiting, by name — the one-line answer to "which".
  const swapDepartments = useMemo(
    () => (report?.departments ?? []).filter((d) => d.swaps.length).map((d) => ({ name: d.name, n: d.swaps.length })),
    [report]
  );

  return (
    <Card
      className="dept-day-card"
      title={
        <span>
          <ApartmentOutlined style={{ color: palette.primary }} /> ລາຍງານແຕ່ລະພະແນກ
        </span>
      }
      extra={
        <Space wrap size={6}>
          <Button size="small" type={isToday ? 'primary' : 'default'} onClick={() => setDate(dayjs())}>
            ມື້ນີ້
          </Button>
          <Button size="small" onClick={() => setDate(dayjs().subtract(1, 'day'))}>
            ມື້ວານ
          </Button>
          <DatePicker
            size="small"
            value={date}
            allowClear={false}
            format="DD/MM/YYYY"
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            onChange={(v) => v && setDate(v)}
          />
        </Space>
      }
      style={{ borderRadius: 12, marginTop: 24 }}
      styles={{ body: { paddingTop: 12 } }}
    >
      {query.isError ? (
        <Alert type="error" showIcon message="ດຶງລາຍງານແຕ່ລະພະແນກບໍ່ສຳເລັດ" action={<Button size="small" onClick={() => query.refetch()}>ລອງໃໝ່</Button>} />
      ) : query.isLoading || !report ? (
        <Skeleton active />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {report.holiday && <Alert type="info" showIcon message={`ຮ້ານປິດ: ${report.holiday}`} />}

          {/* The whole shop, then which departments have a swap coming. */}
          <div className="dept-day-totals" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Typography.Text strong>
              ທັງໝົດ {report.totals.total} ຄົນ{isToday ? ' (ມື້ນີ້)' : ` (${date.format('DD/MM/YYYY')})`}:
            </Typography.Text>
            {BUCKETS.filter((b) => b.key !== 'other' || showOther).map((b) => (
              <span key={b.key} style={{ background: tint(b.color, 0.12), color: b.color, borderRadius: 16, padding: '2px 12px', fontWeight: 600 }}>
                {b.label} {report.totals[b.key]}
                {b.key === 'came' && report.totals.late ? ` (ຊ້າ ${report.totals.late})` : ''}
              </span>
            ))}
          </div>
          <div className="dept-day-swap-summary">
            <Typography.Text type="secondary">ແຜນສະຫຼັບກະທີ່ລໍຖ້າ: </Typography.Text>
            {swapDepartments.length ? (
              swapDepartments.map((d) => (
                <Tag key={d.name} color="gold" icon={<SwapOutlined />}>
                  {d.name} ({d.n})
                </Tag>
              ))
            ) : (
              <Typography.Text type="secondary">ບໍ່ມີ</Typography.Text>
            )}
            <Link to="/schedule/swaps">
              <Button type="link" size="small" icon={<ArrowRightOutlined />} iconPosition="end">
                ເບິ່ງການສະຫຼັບກະ
              </Button>
            </Link>
          </div>

          {!report.departments.length ? (
            <Empty description="ບໍ່ມີພະນັກງານໃນມື້ນີ້" />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ກົດທີ່ພະແນກ ເພື່ອເບິ່ງລາຍຊື່
                </Typography.Text>
                <Button size="small" onClick={() => setExpanded(allOpen ? [] : allKeys)}>
                  {allOpen ? 'ປິດລາຍຊື່ທັງໝົດ' : 'ເປີດລາຍຊື່ທັງໝົດ'}
                </Button>
              </div>
              <Table<DepartmentDayGroup>
                className="dept-day-table"
                dataSource={report.departments}
                rowKey="_id"
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                // With a column pinned, antd sizes the opened list to the visible
                // width instead of the whole scrolling table — on a phone it fits.
                expandable={{
                  fixed: 'left',
                  expandedRowKeys: expanded,
                  onExpandedRowsChange: (keys) => setExpanded(keys as string[]),
                  expandRowByClick: true,
                  expandedRowRender: (group) => <DepartmentPeople group={group} />,
                }}
                rowClassName={() => 'dept-day-row'}
              >
                <Table.Column<DepartmentDayGroup>
                  title="ພະແນກ"
                  fixed="left"
                  render={(_, g) => (
                    <span>
                      <Typography.Text strong>{g.name}</Typography.Text>{' '}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        ({g.total} ຄົນ)
                      </Typography.Text>
                    </span>
                  )}
                />
                {BUCKETS.filter((b) => b.key !== 'other' || showOther).map((b) => (
                  <Table.Column<DepartmentDayGroup>
                    key={b.key}
                    title={<span style={{ color: b.color }}>{b.label}</span>}
                    align="center"
                    render={(_, g) => (
                      <CountChip bucket={b.key} value={g.counts[b.key]} extra={b.key === 'came' && g.late ? `ຊ້າ ${g.late}` : undefined} />
                    )}
                  />
                ))}
                <Table.Column<DepartmentDayGroup>
                  title="ສະຫຼັບກະ"
                  align="center"
                  render={(_, g) =>
                    g.swaps.length ? (
                      <Tooltip title={g.swaps.map((s) => `${dayjs(s.effectiveDate).format('DD/MM')}: ${s.positionA} ⇄ ${s.positionB}`).join(' · ')}>
                        <Tag color="gold" icon={<SwapOutlined />} style={{ marginInlineEnd: 0 }}>
                          {g.swaps.length}
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Typography.Text type="secondary">-</Typography.Text>
                    )
                  }
                />
              </Table>
            </>
          )}
        </Space>
      )}
    </Card>
  );
}
