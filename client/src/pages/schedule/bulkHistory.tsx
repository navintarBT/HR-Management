import { useEffect, useState } from 'react';
import { useCustom } from '@refinedev/core';
import { Drawer, Segmented, Table, Tag, Typography, Space, Grid } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { BulkEditAction, BulkEditItem, BulkEditRound, BulkEditSide } from '../../types';

const ACTION_LABEL: Record<BulkEditAction, string> = {
  department: 'ຍ້າຍພະແນກ',
  position: 'ຍ້າຍຕຳແໜ່ງ',
  shift: 'ຍ້າຍກະ',
};
const ACTION_COLOR: Record<BulkEditAction, string> = { department: 'geekblue', position: 'purple', shift: 'cyan' };
const FIELD_LABEL: Record<keyof BulkEditSide, string> = { department: 'ພະແນກ', position: 'ຕຳແໜ່ງ', shift: 'ໂມງເຂົ້າວຽກ' };
const SOURCE_LABEL: Record<string, string> = { employee: 'ໜ້າພະນັກງານ', planner: 'ຕັ້ງຄ່າແຜນວຽກ' };
const PAGE_SIZE = 20;

// What a round is about, shown first; the other fields only where they changed
// too (a department move clears a position the new department doesn't have).
function changedFields(action: BulkEditAction, item: BulkEditItem): (keyof BulkEditSide)[] {
  const main = action;
  const others = (['department', 'position', 'shift'] as const).filter(
    (f) => f !== main && item.after && (item.after[f] ?? null) !== (item.before?.[f] ?? null)
  );
  return [main, ...others];
}

const StatusTag: React.FC<{ item: BulkEditItem; finished: boolean }> = ({ item, finished }) => {
  if (item.status === 'ok') return <Tag color="green">ສຳເລັດ</Tag>;
  if (item.status === 'failed') return <Tag color="red">ບໍ່ສຳເລັດ</Tag>;
  if (item.status === 'skipped') return <Tag>ຂ້າມ</Tag>;
  if (item.status === 'cancelled') return <Tag color="default">ຍົກເລີກແລ້ວ</Tag>;
  return <Tag color="orange">{finished ? 'ບໍ່ຮູ້ຜົນ' : 'ກຳລັງດຳເນີນ'}</Tag>;
};

const Change: React.FC<{ round: BulkEditRound; item: BulkEditItem }> = ({ round, item }) => {
  const fromDate = round.action === 'shift' && round.target.effectiveDate ? ` (ຈາກ ${dayjs(round.target.effectiveDate).format('DD/MM/YYYY')})` : '';
  const fields = changedFields(round.action, item);
  return (
    <Space direction="vertical" size={0}>
      {fields.map((f) => (
        <span key={f}>
          {fields.length > 1 && <Typography.Text type="secondary">{FIELD_LABEL[f]}: </Typography.Text>}
          <Typography.Text type="secondary">{item.before?.[f] ?? '-'}</Typography.Text>
          <ArrowRightOutlined style={{ fontSize: 10, margin: '0 6px' }} />
          {item.status === 'ok' ? (
            <Typography.Text strong>
              {item.after?.[f] ?? '-'}
              {f === 'shift' ? fromDate : ''}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">{f === round.action ? round.target.label ?? '-' : '-'}</Typography.Text>
          )}
        </span>
      ))}
    </Space>
  );
};

const Result: React.FC<{ round: BulkEditRound; item: BulkEditItem }> = ({ round, item }) => (
  <Space direction="vertical" size={0}>
    <StatusTag item={item} finished={!!round.finishedAt} />
    {item.message && (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {item.message}
      </Typography.Text>
    )}
  </Space>
);

const People: React.FC<{ round: BulkEditRound; compact: boolean }> = ({ round, compact }) => {
  if (compact) {
    return (
      <div className="bulk-history-people">
        {round.items.map((item) => (
          <div key={item.employee} style={{ padding: '6px 0', borderBottom: '1px solid var(--app-border-color, #f0f0f0)' }}>
            <Space size={6} wrap>
              <Typography.Text strong>{item.employeeCode ?? '-'}</Typography.Text>
              <span>{item.name ?? '-'}</span>
              <StatusTag item={item} finished={!!round.finishedAt} />
            </Space>
            <div>
              <Change round={round} item={item} />
            </div>
            {item.message && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {item.message}
              </Typography.Text>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <Table<BulkEditItem>
      className="bulk-history-people"
      rowKey="employee"
      size="small"
      dataSource={round.items}
      pagination={false}
      scroll={{ x: 'max-content' }}
    >
      <Table.Column<BulkEditItem> title="ລະຫັດ" dataIndex="employeeCode" width={80} render={(v) => v ?? '-'} />
      <Table.Column<BulkEditItem> title="ຊື່" dataIndex="name" width={160} render={(v) => v ?? '-'} />
      <Table.Column<BulkEditItem> title="ກ່ອນ → ຫຼັງ" render={(_, item) => <Change round={round} item={item} />} />
      <Table.Column<BulkEditItem> title="ຜົນ" width={200} render={(_, item) => <Result round={round} item={item} />} />
    </Table>
  );
};

// ປະຫວັດການແກ້ໄຂ: every round of ແກ້ໄຂກະແບບກຸ່ມ — and every single ຍ້າຍກະ
// from the employee page or ຕັ້ງຄ່າແຜນວຽກ — newest first: who moved whom, when,
// to what, and what each person had before (server/src/routes/bulkEdits.js).
export const BulkEditHistory: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<BulkEditAction | 'all'>('all');
  const screens = Grid.useBreakpoint();
  const { data, isFetching, refetch } = useCustom<{ data: BulkEditRound[]; total: number }>({
    url: `${API_URL}/bulk-edits`,
    method: 'get',
    config: { query: { page, pageSize: PAGE_SIZE, ...(action !== 'all' ? { action } : {}) } },
    queryOptions: { enabled: open },
  });
  // Opened again after another round: show it.
  useEffect(() => {
    if (open) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const rounds = data?.data?.data ?? [];
  const total = data?.data?.total ?? 0;
  // A phone gets one stacked column instead of four side by side.
  const compact = !screens.md;
  const what = (r: BulkEditRound) => (
    <Space size={4} wrap>
      <Tag color={ACTION_COLOR[r.action]}>{ACTION_LABEL[r.action]}</Tag>
      <span>→ {r.target.label ?? '-'}</span>
      {r.source && SOURCE_LABEL[r.source] && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          (ຈາກ{SOURCE_LABEL[r.source]})
        </Typography.Text>
      )}
      {r.action === 'shift' && r.target.effectiveDate && (
        <Typography.Text type="secondary">ມີຜົນ {dayjs(r.target.effectiveDate).format('DD/MM/YYYY')}</Typography.Text>
      )}
    </Space>
  );
  const howMany = (r: BulkEditRound) => {
    const count = (st: BulkEditItem['status']) => r.items.filter((i) => i.status === st).length;
    return (
      <Space size={4} wrap>
        <span style={{ whiteSpace: 'nowrap' }}>{r.items.length} ຄົນ</span>
        {count('ok') > 0 && <Tag color="green">✓ {count('ok')}</Tag>}
        {count('failed') > 0 && <Tag color="red">✗ {count('failed')}</Tag>}
        {count('skipped') > 0 && <Tag>ຂ້າມ {count('skipped')}</Tag>}
        {count('cancelled') > 0 && <Tag>ຍົກເລີກ {count('cancelled')}</Tag>}
        {count('pending') > 0 && <Tag color="orange">? {count('pending')}</Tag>}
      </Space>
    );
  };
  const when = (r: BulkEditRound) => <span style={{ whiteSpace: 'nowrap' }}>{dayjs(r.createdAt).format('DD/MM/YYYY HH:mm')}</span>;

  return (
    <Drawer
      title="ປະຫວັດການແກ້ໄຂ ພະແນກ / ຕຳແໜ່ງ / ກະ"
      open={open}
      onClose={onClose}
      width={screens.md ? 980 : '100%'}
      className="bulk-history-drawer"
      destroyOnClose
    >
      <Segmented
        style={{ marginBottom: 12 }}
        value={action}
        onChange={(v) => {
          setAction(v as BulkEditAction | 'all');
          setPage(1);
        }}
        options={[
          { label: 'ທັງໝົດ', value: 'all' },
          { label: ACTION_LABEL.department, value: 'department' },
          { label: ACTION_LABEL.position, value: 'position' },
          { label: ACTION_LABEL.shift, value: 'shift' },
        ]}
      />
      <Table<BulkEditRound>
        className="bulk-history-rounds"
        rowKey="_id"
        size="small"
        loading={isFetching}
        dataSource={rounds}
        scroll={compact ? undefined : { x: 'max-content' }}
        locale={{ emptyText: 'ຍັງບໍ່ມີປະຫວັດ' }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: setPage, showSizeChanger: false, size: 'small' }}
        expandable={{ expandedRowRender: (round) => <People round={round} compact={compact} /> }}
      >
        {compact ? (
          <Table.Column<BulkEditRound>
            title="ການແກ້ໄຂ"
            render={(_, r) => (
              <Space direction="vertical" size={2}>
                <Space size={6} wrap>
                  {when(r)}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.byEmail ?? '-'}
                  </Typography.Text>
                </Space>
                {what(r)}
                {howMany(r)}
              </Space>
            )}
          />
        ) : (
          [
            <Table.Column<BulkEditRound> key="when" title="ວັນເວລາ" width={130} render={(_, r) => when(r)} />,
            <Table.Column<BulkEditRound> key="what" title="ການແກ້ໄຂ" render={(_, r) => what(r)} />,
            <Table.Column<BulkEditRound> key="count" title="ຈຳນວນ" width={190} render={(_, r) => howMany(r)} />,
            <Table.Column<BulkEditRound> key="by" title="ຜູ້ແກ້ໄຂ" dataIndex="byEmail" render={(v) => v ?? '-'} />,
          ]
        )}
      </Table>
    </Drawer>
  );
};
