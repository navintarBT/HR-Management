import { useCustom } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { Row, Col, Card, Statistic, Typography, Skeleton, Empty, List, Tag, Avatar, Button } from 'antd';
import {
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  SwapOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { DashboardSummary } from '../../types';
import { palette, categorical } from '../../theme/palette';
import { AttendanceStatusTag, LeaveTypeTag } from '../../components/StatusTags';

const colorForPosition = (name: string) => categorical[name.charCodeAt(name.length - 1) % categorical.length];

const statCards = [
  { key: 'totalEmployees', label: 'ພະນັກງານທັງໝົດ', icon: <TeamOutlined />, color: palette.primary },
  { key: 'presentToday', label: 'ມາເຮັດວຽກມື້ນີ້', icon: <CheckCircleOutlined />, color: palette.success },
  { key: 'lateToday', label: 'ມາຊ້າມື້ນີ້', icon: <ClockCircleOutlined />, color: palette.warning },
  { key: 'onLeaveToday', label: 'ລາມື້ນີ້', icon: <CalendarOutlined />, color: palette.leave },
  { key: 'absentToday', label: 'ຂາດງານມື້ນີ້', icon: <CloseCircleOutlined />, color: palette.error },
  { key: 'pendingLeaves', label: 'ຄໍາຂໍລາລໍຖ້າອະນຸມັດ', icon: <FileTextOutlined />, color: palette.info },
] as const;

export const DashboardPage: React.FC = () => {
  const { data, isLoading } = useCustom<DashboardSummary>({
    url: `${API_URL}/dashboard/summary`,
    method: 'get',
    config: { query: { days: 14 } },
  });

  const summary = data?.data;

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        ແດຊບອດສະຫຼຸບພາບລວມ
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        ຂໍ້ມູນ ປະຈໍາວັນທີ {dayjs().format('DD MMMM YYYY')}
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        {statCards.map((card) => (
          <Col xs={24} sm={12} md={8} lg={4} key={card.key}>
            <Card
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ body: { padding: 20 } }}
              hoverable
            >
              {isLoading ? (
                <Skeleton active paragraph={false} />
              ) : (
                <>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: `${card.color}1a`,
                      color: card.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      marginBottom: 10,
                    }}
                  >
                    {card.icon}
                  </div>
                  <Statistic value={summary ? summary[card.key] : 0} valueStyle={{ fontSize: 26, fontWeight: 600 }} />
                  <Typography.Text type="secondary">{card.label}</Typography.Text>
                </>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="ແນວໂນ້ມການເຂົ້າວຽກຍ້ອນຫຼັງ 14 ວັນ"
        style={{ borderRadius: 12, marginTop: 24 }}
        styles={{ body: { paddingTop: 8 } }}
      >
        {isLoading ? (
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
              <XAxis
                dataKey="date"
                tickFormatter={(v) => dayjs(v).format('D MMM')}
                tick={{ fontSize: 12 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={(v) => dayjs(v as string).format('DD MMM YYYY')}
                formatter={(value: number, name: string) =>
                  [value, ({ present: 'ມາເຮັດວຽກ', late: 'ມາຊ້າ', absent: 'ຂາດງານ', leave: 'ລາ' } as Record<string, string>)[name] ?? name]
                }
              />
              <Legend
                formatter={(value) =>
                  ({ present: 'ມາເຮັດວຽກ', late: 'ມາຊ້າ', absent: 'ຂາດງານ', leave: 'ລາ' } as Record<string, string>)[value] ??
                  value
                }
              />
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
            style={{ borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: '0 24px', maxHeight: 420, overflowY: 'auto' } }}
          >
            {isLoading ? (
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
                          <Tag color={colorForPosition(shift.positionName)} style={{ marginInlineEnd: 0 }}>
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
            title="ລາຍການລໍຖ້າອະນຸມັດ"
            extra={
              <Link to="/leaves">
                <Button type="link" size="small" icon={<ArrowRightOutlined />} iconPosition="end">
                  ເບິ່ງທັງໝົດ
                </Button>
              </Link>
            }
            style={{ borderRadius: 12, height: '100%' }}
            styles={{ body: { padding: '0 24px', maxHeight: 420, overflowY: 'auto' } }}
          >
            {isLoading ? (
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
    </div>
  );
};
