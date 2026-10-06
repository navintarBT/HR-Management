import { useEffect, useState } from 'react';
import { useCustom, useList, useGetIdentity } from '@refinedev/core';
import { Link } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Skeleton,
  Empty,
  List,
  Tag,
  Avatar,
  Button,
  Badge,
  Alert,
} from 'antd';
import {
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  SwapOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  PercentageOutlined,
  MedicineBoxOutlined,
  ApartmentOutlined,
  GiftOutlined,
  WarningOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type {
  DashboardSummary,
  DashboardOrgComposition,
  DashboardDataQuality,
  Identity,
  Overtime,
  MedicineExpense,
  Holiday,
  ScheduledPositionSwap,
  RestDayHistory,
} from '../../types';
import { palette, categorical, tint } from '../../theme/palette';
import { AttendanceStatusTag, LeaveTypeTag, employeeStatusMap } from '../../components/StatusTags';

const CARD_RADIUS = 12;
const CARD_BODY_PADDING = 20;
const LIST_MAX_HEIGHT = 420;

// Sums every character code instead of just the last character — the old
// version collided whenever two position names happened to end the same way.
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash += name.charCodeAt(i);
  return categorical[hash % categorical.length];
}

function formatDelta(delta: number, goodDirection: 'up' | 'down' | 'neutral', unit = ''): React.ReactNode {
  if (!Number.isFinite(delta) || Math.round(delta * 10) === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        ເທົ່າມື້ວານ
      </Typography.Text>
    );
  }
  const isUp = delta > 0;
  const isGood = goodDirection === 'neutral' ? null : (goodDirection === 'up') === isUp;
  const color = isGood === null ? undefined : isGood ? palette.success : palette.error;
  const rounded = Math.abs(Math.round(delta * 10) / 10);
  return (
    <Typography.Text style={{ fontSize: 12, color }} type={color ? undefined : 'secondary'}>
      {isUp ? '↑' : '↓'} {rounded}
      {unit} ຈາກມື້ວານ
    </Typography.Text>
  );
}

const DATA_QUALITY_LABELS: Record<keyof DashboardDataQuality, string> = {
  missingPosition: 'ບໍ່ມີຕຳແໜ່ງ',
  missingDepartment: 'ບໍ່ມີພະແນກ',
  missingHireDate: 'ບໍ່ມີວັນທີ່ເລີ່ມງານ',
  missingEmploymentType: 'ບໍ່ມີປະເພດການຈ້າງ',
  missingEmail: 'ບໍ່ມີອີເມວ',
  missingReportingLine: 'ບໍ່ມີຫົວໜ້າງານ/ຕຳແໜ່ງ',
  missingRestDay: 'ບໍ່ມີວັນພັກປະຈຳ',
  missingDeviceCode: 'ບໍ່ມີລະຫັດສະແກນ',
  stuckDrafts: 'ຍັງເປັນຮ່າງ (draft)',
  resignedNoTerminationDate: 'ລາອອກແຕ່ບໍ່ມີວັນທີ່ອອກ',
  missingPayInfo: 'ບໍ່ມີເງິນເດືອນ/ວັນພັກປະຈຳປີ',
};

const TREND_LABELS: Record<string, string> = { present: 'ມາເຮັດວຽກ', late: 'ມາຊ້າ', absent: 'ຂາດວຽກ', leave: 'ລາ' };

export const DashboardPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin' || identity?.role === 'manager';

  const todayKey = dayjs().format('YYYY-MM-DD');
  // Overtime.date/MedicineExpense.date are real Date fields, so the server
  // compares them against these as UTC midnight — a day wider on each side
  // than the calendar range we actually want, to absorb the timezone offset
  // (otherwise "today"'s own entries get cut off for any timezone ahead of
  // UTC). The precise cutoff is reapplied client-side below once the real
  // per-record date is in hand.
  const monthRangeQueryStart = dayjs().startOf('month').subtract(1, 'day').format('YYYY-MM-DD');
  const monthRangeQueryEnd = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month');
  const dayEnd = dayjs().endOf('day');
  const inMonthToDate = (value: string) => {
    const d = dayjs(value);
    return d.valueOf() >= monthStart.valueOf() && d.valueOf() <= dayEnd.valueOf();
  };

  const summaryQuery = useCustom<DashboardSummary>({
    url: `${API_URL}/dashboard/summary`,
    method: 'get',
    config: { query: { days: 14 } },
  });
  const summary = summaryQuery.data?.data;

  const orgQuery = useCustom<DashboardOrgComposition>({
    url: `${API_URL}/dashboard/org-composition`,
    method: 'get',
    queryOptions: { enabled: isAdmin },
  });
  const org = orgQuery.data?.data;

  const qualityQuery = useCustom<DashboardDataQuality>({
    url: `${API_URL}/dashboard/data-quality`,
    method: 'get',
    queryOptions: { enabled: isAdmin },
  });
  const quality = qualityQuery.data?.data;

  const otQuery = useList<Overtime>({
    resource: 'overtime',
    filters: [
      { field: 'status', operator: 'eq', value: 'approved' },
      { field: 'date', operator: 'gte', value: monthRangeQueryStart },
      { field: 'date', operator: 'lte', value: monthRangeQueryEnd },
    ],
    pagination: { pageSize: 1000 },
    queryOptions: { enabled: isAdmin },
  });

  const medicineQuery = useList<MedicineExpense>({
    resource: 'medicine-expenses',
    filters: [
      { field: 'date', operator: 'gte', value: monthRangeQueryStart },
      { field: 'date', operator: 'lte', value: monthRangeQueryEnd },
    ],
    pagination: { pageSize: 1000 },
    queryOptions: { enabled: isAdmin },
  });

  const holidaysQuery = useList<Holiday>({
    resource: 'holidays',
    filters: [{ field: 'date', operator: 'gte', value: todayKey }],
    sorters: [{ field: 'date', order: 'asc' }],
    pagination: { pageSize: 50 },
    queryOptions: { enabled: isAdmin },
  });

  const positionSwapsQuery = useList<ScheduledPositionSwap>({
    resource: 'position-swaps',
    pagination: { pageSize: 1000 },
    queryOptions: { enabled: isAdmin },
  });

  const restDayHistoryQuery = useList<RestDayHistory>({
    resource: 'rest-day-history',
    sorters: [{ field: 'createdAt', order: 'desc' }],
    pagination: { pageSize: 3 },
    queryOptions: { enabled: isAdmin },
  });

  const [lastUpdated, setLastUpdated] = useState<ReturnType<typeof dayjs> | null>(null);
  useEffect(() => {
    if (summary) setLastUpdated(dayjs());
  }, [summary]);

  const handleRefresh = () => {
    summaryQuery.refetch();
    if (isAdmin) {
      orgQuery.refetch();
      qualityQuery.refetch();
      otQuery.refetch();
      medicineQuery.refetch();
      holidaysQuery.refetch();
      positionSwapsQuery.refetch();
      restDayHistoryQuery.refetch();
    }
  };

  const trend = summary?.trend ?? [];
  const todayTrend = trend[trend.length - 1];
  const yesterdayTrend = trend[trend.length - 2];
  const rateToday = summary && summary.totalEmployees > 0 ? (summary.presentToday / summary.totalEmployees) * 100 : 0;
  const rateYesterday =
    summary && summary.totalEmployees > 0 && yesterdayTrend ? (yesterdayTrend.present / summary.totalEmployees) * 100 : 0;

  const otItems = (otQuery.data?.data ?? []).filter((ot) => inMonthToDate(ot.date));
  const otHours = otItems.reduce((sum, ot) => {
    const [sh, sm] = ot.startTime.split(':').map(Number);
    const [eh, em] = ot.endTime.split(':').map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60;
    return sum + minutes / 60;
  }, 0);

  const medicineItems = (medicineQuery.data?.data ?? []).filter((m) => inMonthToDate(m.date));
  const medicineTotal = medicineItems.reduce((sum, m) => sum + (m.shopPayAmount || 0), 0);

  const holidayItems = holidaysQuery.data?.data ?? [];
  const nextHoliday = holidayItems[0];
  const endOfMonthKey = dayjs().endOf('month').format('YYYY-MM-DD');
  const holidaysThisMonth = holidayItems.filter((h) => h.date <= endOfMonthKey).length;

  const upcomingSwaps = (positionSwapsQuery.data?.data ?? [])
    .filter((s) => s.status === 'pending' && s.effectiveDate >= todayKey)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const recentRestDayChanges = restDayHistoryQuery.data?.data ?? [];

  const qualityEntries = quality
    ? (Object.keys(DATA_QUALITY_LABELS) as (keyof DashboardDataQuality)[])
        .map((key) => ({ key, label: DATA_QUALITY_LABELS[key], count: quality[key] }))
        .filter((e) => e.count > 0)
    : [];

  type StatCard = { key: string; label: string; icon: React.ReactNode; color: string; value: React.ReactNode; sub?: React.ReactNode; muted?: boolean };

  const statCards: StatCard[] = summary
    ? [
        {
          key: 'totalEmployees',
          label: 'ພະນັກງານທັງໝົດ',
          icon: <TeamOutlined />,
          color: palette.primary,
          value: summary.totalEmployees,
          muted: summary.totalEmployees === 0,
        },
        {
          key: 'presentToday',
          label: 'ມາເຮັດວຽກມື້ນີ້',
          icon: <CheckCircleOutlined />,
          color: palette.success,
          value: summary.presentToday,
          sub: todayTrend && yesterdayTrend ? formatDelta(summary.presentToday - yesterdayTrend.present, 'up') : undefined,
        },
        {
          key: 'attendanceRate',
          label: 'ອັດຕາມາເຮັດວຽກ',
          icon: <PercentageOutlined />,
          color: palette.success,
          value: `${rateToday.toFixed(1)}%`,
          sub: yesterdayTrend ? formatDelta(rateToday - rateYesterday, 'up', '%') : undefined,
        },
        {
          key: 'lateToday',
          label: 'ມາຊ້າມື້ນີ້',
          icon: <ClockCircleOutlined />,
          color: palette.warning,
          value: summary.lateToday,
          sub: todayTrend && yesterdayTrend ? formatDelta(summary.lateToday - yesterdayTrend.late, 'down') : undefined,
        },
        {
          key: 'onLeaveToday',
          label: 'ລາມື້ນີ້',
          icon: <CalendarOutlined />,
          color: palette.leave,
          value: summary.onLeaveToday,
          sub: todayTrend && yesterdayTrend ? formatDelta(summary.onLeaveToday - yesterdayTrend.leave, 'neutral') : undefined,
        },
        {
          key: 'absentToday',
          label: 'ຂາດວຽກມື້ນີ້',
          icon: <CloseCircleOutlined />,
          color: palette.error,
          value: summary.absentToday,
          sub: todayTrend && yesterdayTrend ? formatDelta(summary.absentToday - yesterdayTrend.absent, 'down') : undefined,
        },
        {
          key: 'pendingLeaves',
          label: 'ຄໍາຂໍລາລໍຖ້າອະນຸມັດ',
          icon: <FileTextOutlined />,
          color: palette.info,
          value: summary.pendingLeaves,
        },
        ...(isAdmin
          ? ([
              {
                key: 'otHours',
                label: 'OT ເດືອນນີ້ (ຊົ່ວໂມງ)',
                icon: <ClockCircleOutlined />,
                color: categorical[3],
                value: otQuery.isLoading ? <Skeleton.Input active size="small" /> : otHours.toFixed(1),
                sub: !otQuery.isLoading ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {otItems.length} ລາຍການ
                  </Typography.Text>
                ) : undefined,
              },
              {
                key: 'medicineTotal',
                label: 'ຄ່າຢາເດືອນນີ້',
                icon: <MedicineBoxOutlined />,
                color: categorical[1],
                value: medicineQuery.isLoading ? <Skeleton.Input active size="small" /> : medicineTotal.toLocaleString(),
                sub: !medicineQuery.isLoading ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {medicineItems.length} ລາຍການ
                  </Typography.Text>
                ) : undefined,
              },
            ] as StatCard[])
          : []),
      ]
    : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
            ແດຊບອດສະຫຼຸບພາບລວມ
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            ຂໍ້ມູນ ປະຈໍາວັນທີ {dayjs().format('DD MMMM YYYY')}
          </Typography.Paragraph>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ອັບເດດລ່າສຸດ {lastUpdated.format('HH:mm')}
            </Typography.Text>
          )}
          <Button
            icon={<ReloadOutlined spin={summaryQuery.isFetching} />}
            onClick={handleRefresh}
            size="small"
          >
            ໂຫຼດຂໍ້ມູນໃໝ່
          </Button>
        </div>
      </div>

      {summaryQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="ດຶງຂໍ້ມູນແດຊບອດບໍ່ສຳເລັດ"
          description="ກະລຸນາລອງໂຫຼດຂໍ້ມູນໃໝ່ອີກຄັ້ງ"
          action={
            <Button size="small" danger onClick={() => summaryQuery.refetch()}>
              ລອງໃໝ່
            </Button>
          }
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        {(summaryQuery.isLoading ? Array.from({ length: 6 }) : statCards).map((card: StatCard | unknown, i) => (
          <Card
            key={(card as StatCard)?.key ?? i}
            style={{ borderRadius: CARD_RADIUS, opacity: (card as StatCard)?.muted ? 0.6 : 1 }}
            styles={{ body: { padding: CARD_BODY_PADDING } }}
            hoverable
          >
            {summaryQuery.isLoading || !card ? (
              <Skeleton active paragraph={false} />
            ) : (
              <>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: tint((card as StatCard).color, 0.1),
                    color: (card as StatCard).color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    marginBottom: 10,
                  }}
                >
                  {(card as StatCard).icon}
                </div>
                <Statistic value={(card as StatCard).value as string | number} valueStyle={{ fontSize: 26, fontWeight: 600 }} />
                <Typography.Text type="secondary">{(card as StatCard).label}</Typography.Text>
                <div style={{ marginTop: 4, minHeight: 18 }}>{(card as StatCard).sub}</div>
              </>
            )}
          </Card>
        ))}
      </div>

      <Card
        title="ແນວໂນ້ມການເຂົ້າວຽກຍ້ອນຫຼັງ 14 ວັນ"
        style={{ borderRadius: CARD_RADIUS, marginTop: 24 }}
        styles={{ body: { paddingTop: 8 } }}
      >
        {summaryQuery.isLoading ? (
          <Skeleton active />
        ) : !summary?.trend?.length ? (
          <Empty description="ຍັງບໍ່ມີຂໍ້ມູນ" />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={summary.trend} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="present" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette.success} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={palette.success} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="late" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette.warning} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={palette.warning} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="absent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette.error} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={palette.error} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="leave" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette.leave} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={palette.leave} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => dayjs(v).format('D MMM')} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={(v) => dayjs(v as string).format('DD MMM YYYY')}
                formatter={(value: number, name: string) => [value, TREND_LABELS[name] ?? name]}
              />
              <Legend formatter={(value) => TREND_LABELS[value] ?? value} />
              <Area type="monotone" dataKey="present" stroke={palette.success} fill="url(#present)" strokeWidth={2} />
              <Area type="monotone" dataKey="late" stroke={palette.warning} fill="url(#late)" strokeWidth={2} />
              <Area type="monotone" dataKey="absent" stroke={palette.error} fill="url(#absent)" strokeWidth={2} />
              <Area type="monotone" dataKey="leave" stroke={palette.leave} fill="url(#leave)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <Card
            title="ຕາຕະລາງກະມື້ນີ້"
            extra={
              <Link to="/schedule">
                <Button type="link" size="small" icon={<ArrowRightOutlined />} iconPosition="end">
                  ເບິ່ງຕາຕະລາງກະ
                </Button>
              </Link>
            }
            style={{ borderRadius: CARD_RADIUS, height: '100%' }}
            styles={{ body: { padding: '0 24px', maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' } }}
          >
            {summaryQuery.isLoading ? (
              <Skeleton active style={{ padding: '16px 0' }} />
            ) : !summary?.todayShifts?.length ? (
              <Empty description="ບໍ່ມີກະມື້ນີ້" style={{ padding: '24px 0' }} />
            ) : (
              <List
                dataSource={summary.todayShifts}
                renderItem={(shift) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <span style={{ fontWeight: 500 }}>
                          {shift.employeeName}{' '}
                          <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                            {shift.employeeCode}
                          </Typography.Text>
                        </span>
                      }
                      description={
                        <span>
                          {shift.startTime}–{shift.endTime}
                          {' · '}
                          <Tag color={colorForName(shift.positionName)} style={{ marginInlineEnd: 0 }}>
                            {shift.positionName}
                          </Tag>
                        </span>
                      }
                    />
                    {shift.attendanceStatus ? (
                      <AttendanceStatusTag status={shift.attendanceStatus} />
                    ) : (
                      <Tag>ຍັງບໍ່ໄດ້ສະແກນ</Tag>
                    )}
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                ລາຍການລໍຖ້າອະນຸມັດ{' '}
                {!!summary?.pendingLeaves && <Badge count={summary.pendingLeaves} color={palette.info} />}
              </span>
            }
            extra={
              <Link to="/leaves">
                <Button type="link" size="small" icon={<ArrowRightOutlined />} iconPosition="end">
                  ເບິ່ງທັງໝົດ
                </Button>
              </Link>
            }
            style={{ borderRadius: CARD_RADIUS, height: '100%' }}
            styles={{ body: { padding: '0 24px', maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' } }}
          >
            {summaryQuery.isLoading ? (
              <Skeleton active style={{ padding: '16px 0' }} />
            ) : !summary?.pendingApprovals?.length ? (
              <Empty description="ບໍ່ມີລາຍການລໍຖ້າອະນຸມັດ" style={{ padding: '24px 0' }} />
            ) : (
              <List
                dataSource={summary.pendingApprovals}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar
                          icon={item.kind === 'leave' ? <CalendarOutlined /> : <SwapOutlined />}
                          style={{ backgroundColor: item.kind === 'leave' ? palette.leave : palette.info }}
                        />
                      }
                      title={item.employeeName}
                      description={
                        item.kind === 'leave' ? (
                          <span>
                            {item.leaveType && <LeaveTypeTag type={item.leaveType} />} {item.startDate} - {item.endDate}
                          </span>
                        ) : (
                          <span>
                            ຂໍສະຫຼັບກະ {item.shiftDate} {item.shiftStart}–{item.shiftEnd}
                            {item.toEmployeeName ? ` ກັບ ${item.toEmployeeName}` : ''}
                          </span>
                        )
                      }
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(item.createdAt).format('DD/MM HH:mm')}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={14}>
            <Card
              title="ຈຳນວນພະນັກງານແຍກຕາມພະແນກ"
              extra={<ApartmentOutlined style={{ color: palette.primary }} />}
              style={{ borderRadius: CARD_RADIUS, height: '100%' }}
            >
              {orgQuery.isLoading ? (
                <Skeleton active />
              ) : !org?.byDepartment?.length ? (
                <Empty description="ຍັງບໍ່ມີຂໍ້ມູນ" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, org.byDepartment.length * 36)}>
                  <BarChart data={org.byDepartment} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value: number) => [value, 'ຈຳນວນພະນັກງານ']} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                      {org.byDepartment.map((d, i) => (
                        <Cell key={d.name} fill={categorical[i % categorical.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card title="ສະຖານະພະນັກງານທັງໝົດ" style={{ borderRadius: CARD_RADIUS, height: '100%' }}>
              {orgQuery.isLoading ? (
                <Skeleton active />
              ) : !org?.byStatus?.length ? (
                <Empty description="ຍັງບໍ່ມີຂໍ້ມູນ" />
              ) : (
                <List
                  dataSource={[...org.byStatus].sort((a, b) => b.count - a.count)}
                  renderItem={(row) => {
                    const meta = employeeStatusMap[row.status as keyof typeof employeeStatusMap];
                    return (
                      <List.Item>
                        <Tag color={meta?.color}>{meta?.label ?? row.status}</Tag>
                        <Typography.Text strong style={{ marginLeft: 'auto' }}>
                          {row.count}
                        </Typography.Text>
                      </List.Item>
                    );
                  }}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}

      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={12}>
            <Card
              title="ການປ່ຽນແປງທີ່ກຳລັງມາເຖິງ"
              extra={<GiftOutlined style={{ color: palette.leave }} />}
              style={{ borderRadius: CARD_RADIUS, height: '100%' }}
            >
              {holidaysQuery.isLoading || positionSwapsQuery.isLoading || restDayHistoryQuery.isLoading ? (
                <Skeleton active />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      ວັນພັກຮ້ານຖັດໄປ
                    </Typography.Text>
                    {nextHoliday ? (
                      <div>
                        <Typography.Text strong>{nextHoliday.name}</Typography.Text>{' '}
                        <Typography.Text type="secondary">({dayjs(nextHoliday.date).format('DD MMM YYYY')})</Typography.Text>
                        {holidaysThisMonth > 1 && (
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                            ແລະອີກ {holidaysThisMonth - 1} ວັນໃນເດືອນນີ້
                          </Typography.Text>
                        )}
                      </div>
                    ) : (
                      <div>
                        <Typography.Text type="secondary">ບໍ່ມີວັນພັກຮ້ານທີ່ກຳລັງມາເຖິງ</Typography.Text>
                      </div>
                    )}
                  </div>

                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      ການສະຫຼັບຕຳແໜ່ງທີ່ລໍຖ້າ (7 ວັນຂ້າງໜ້າ)
                    </Typography.Text>
                    {upcomingSwaps.filter((s) => s.effectiveDate <= dayjs().add(7, 'day').format('YYYY-MM-DD')).length === 0 ? (
                      <div>
                        <Typography.Text type="secondary">ບໍ່ມີ</Typography.Text>
                      </div>
                    ) : (
                      upcomingSwaps
                        .filter((s) => s.effectiveDate <= dayjs().add(7, 'day').format('YYYY-MM-DD'))
                        .slice(0, 3)
                        .map((s) => {
                          const posA = typeof s.positionA === 'object' ? s.positionA?.name : '-';
                          const posB = typeof s.positionB === 'object' ? s.positionB?.name : '-';
                          return (
                            <div key={s._id}>
                              <Tag color="gold">{dayjs(s.effectiveDate).format('DD MMM')}</Tag> {posA} ⇄ {posB}
                            </div>
                          );
                        })
                    )}
                  </div>

                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      ປະຫວັດປ່ຽນວັນພັກປະຈຳລ່າສຸດ
                    </Typography.Text>
                    {!recentRestDayChanges.length ? (
                      <div>
                        <Typography.Text type="secondary">ບໍ່ມີ</Typography.Text>
                      </div>
                    ) : (
                      recentRestDayChanges.map((h) => {
                        const emp = typeof h.employee === 'object' ? h.employee : undefined;
                        const empName = emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() : '-';
                        return (
                          <div key={h._id}>
                            <Typography.Text>{empName}</Typography.Text>{' '}
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              ({dayjs(h.createdAt).format('DD MMM')})
                            </Typography.Text>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card
              title="ຄວາມຄົບຖ້ວນຂອງຂໍ້ມູນພະນັກງານ"
              extra={qualityEntries.length ? <WarningOutlined style={{ color: palette.warning } } /> : <CheckOutlined style={{ color: palette.success }} />}
              style={{ borderRadius: CARD_RADIUS, height: '100%' }}
            >
              {qualityQuery.isLoading ? (
                <Skeleton active />
              ) : !qualityEntries.length ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<Typography.Text type="success">ຂໍ້ມູນພະນັກງານຄົບຖ້ວນດີ ✓</Typography.Text>}
                />
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {qualityEntries.map((e) => (
                    <Tag key={e.key} color="warning">
                      {e.label}: {e.count}
                    </Tag>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};
