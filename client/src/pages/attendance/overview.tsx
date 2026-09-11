import { useCustom } from '@refinedev/core';
import { List, useTable } from '@refinedev/antd';
import { Row, Col, Card, Statistic, Table, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CalendarOutlined, CloseCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { AttendanceLog, DashboardSummary, Employee } from '../../types';
import { SimulateScanButton } from './SimulateScanButton';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { palette } from '../../theme/palette';

const typeMap: Record<string, { label: string; color: string }> = {
  in: { label: 'ເຂົ້າວຽກ', color: 'green' },
  out: { label: 'ອອກວຽກ', color: 'blue' },
  auto: { label: 'ບໍ່ລະບຸ', color: 'default' },
};

export const AttendanceOverviewPage: React.FC = () => {
  const { data } = useCustom<DashboardSummary>({
    url: `${API_URL}/dashboard/summary`,
    method: 'get',
    config: { query: { days: 1 } },
  });
  const summary = data?.data;

  const todayStart = dayjs().startOf('day').toISOString();
  const todayEnd = dayjs().endOf('day').toISOString();

  const { tableProps } = useTable<AttendanceLog>({
    resource: 'attendance-logs',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'timestamp', order: 'desc' }] },
    filters: {
      permanent: [
        { field: 'timestamp', operator: 'gte', value: todayStart },
        { field: 'timestamp', operator: 'lte', value: todayEnd },
      ],
    },
  });

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ພາບລວມການລົງເວລາມື້ນີ້" headerButtons={<SimulateScanButton />} breadcrumb={false}>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="ມາເຮັດວຽກມື້ນີ້"
              value={summary?.presentToday ?? 0}
              prefix={<CheckCircleOutlined style={{ color: palette.success }} />}
              valueStyle={{ color: palette.success }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="ມາຊ້າມື້ນີ້"
              value={summary?.lateToday ?? 0}
              prefix={<ClockCircleOutlined style={{ color: palette.warning }} />}
              valueStyle={{ color: palette.warning }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="ລາມື້ນີ້"
              value={summary?.onLeaveToday ?? 0}
              prefix={<CalendarOutlined style={{ color: palette.leave }} />}
              valueStyle={{ color: palette.leave }}
            />
          </Card>
        </Col>
      </Row>

      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          ປະຫວັດການສະແກນມື້ນີ້
        </Typography.Title>
      </div>
      <Table
        {...tableProps}
        rowKey="_id"
        pagination={false}
        sticky={{ offsetHeader }}
        locale={{ emptyText: 'ຍັງບໍ່ມີການສະແກນມື້ນີ້ — ລອງກົດ "ຈໍາລອງການສະແກນນິ້ວ" ເບິ່ງໄດ້ເລີຍ' }}
      >
        <Table.Column
          title="ພະນັກງານ"
          render={(_, record: AttendanceLog) =>
            typeof record.employee === 'object' && record.employee
              ? `${(record.employee as Employee).firstName} ${(record.employee as Employee).lastName}`
              : record.deviceUserId || '-'
          }
        />
        <Table.Column
          title="ເວລາ"
          dataIndex="timestamp"
          render={(v) => dayjs(v).format('HH:mm:ss')}
        />
        <Table.Column
          title="ປະເພດ"
          dataIndex="type"
          render={(v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.label ?? v}</Tag>}
        />
        <Table.Column title="ອຸປະກອນ" dataIndex="deviceId" />
      </Table>
    </List>
  );
};
