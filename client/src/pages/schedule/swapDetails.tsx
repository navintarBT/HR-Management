import { useCustom } from '@refinedev/core';
import { Alert, Button, Descriptions, Empty, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import type { Position, PositionSwapDetails, PositionSwapPerson, PositionSwapShift, ScheduledPositionSwap } from '../../types';

// ລາຍລະອຽດ of one swap on ສະຫຼັບກະ: who it moves (or moved) and from which
// side, their regular shift before and after, what they had on the swap date
// itself and their rest day (server: utils/positionSwap.js swapDetails).

const positionName = (p: Position | string | undefined) => (p && typeof p === 'object' ? p.name : 'ຕຳແໜ່ງນີ້ຖືກລຶບໄປແລ້ວ');
const positionId = (p: Position | string | undefined) => (p && typeof p === 'object' ? p._id : p);

function hours(s?: PositionSwapShift | null) {
  if (!s) return null;
  if (!s.startTime || !s.endTime) return 'ບໍ່ໄດ້ກຳນົດ';
  return `${s.startTime}-${s.endTime}`;
}

const dayName = (d: number) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d);
const restLabel = (days: number[]) => (days.length ? days.map(dayName).join(', ') : 'ບໍ່ມີ');
const sameDays = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();

const personName = (p: PositionSwapPerson) =>
  `${p.employee.firstName ?? ''} ${p.employee.lastName ?? ''}`.trim() || p.employee.nameEn || '-';

const ShiftChange: React.FC<{ previous: PositionSwapShift | null; next: PositionSwapShift | null }> = ({ previous, next }) => {
  const before = hours(previous);
  const after = hours(next);
  if (!before && !after) return <Typography.Text type="secondary">-</Typography.Text>;
  const names = [previous?.categoryName, next?.categoryName];
  if (before === after) {
    return (
      <Space size={4} wrap>
        <Typography.Text>{after}</Typography.Text>
        <Typography.Text type="secondary">(ບໍ່ປ່ຽນ)</Typography.Text>
      </Space>
    );
  }
  return (
    <Space direction="vertical" size={0}>
      <Space size={6} wrap>
        <Typography.Text type="secondary">{before ?? '-'}</Typography.Text>
        <ArrowRightOutlined style={{ fontSize: 11 }} />
        <Typography.Text strong>{after ?? '-'}</Typography.Text>
      </Space>
      {names[0] && names[1] && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {names[0]} → {names[1]}
        </Typography.Text>
      )}
    </Space>
  );
};

const SwapDay: React.FC<{ day: PositionSwapPerson['swapDay'] }> = ({ day }) => {
  if (!day) return <Typography.Text type="secondary">-</Typography.Text>;
  const time = day.startTime && day.endTime ? `${day.startTime}-${day.endTime}` : '';
  if (day.kind === 'kept') return <Tag>ເຮັດກະເກົ່າ {time}</Tag>;
  if (day.kind === 'extended') return <Tag color="orange">ເຮັດຕໍ່ເນື່ອງ {time}</Tag>;
  if (day.kind === 'off') return <Tag color="blue">ບໍ່ມີກະ</Tag>;
  // Their rest day: nothing was put on it, they start the new shift on their next working day.
  if (day.kind === 'rest') return <Tag color="purple">ວັນພັກ</Tag>;
  return <Tag color="purple">ຕັ້ງໄວ້ເອງ{time ? ` ${time}` : ''}</Tag>;
};

const RestDay: React.FC<{ rest: PositionSwapPerson['restDay'] }> = ({ rest }) => {
  if (!rest) return <Typography.Text type="secondary">-</Typography.Text>;
  if (sameDays(rest.before, rest.after)) {
    return (
      <Space size={4} wrap>
        <Typography.Text>{restLabel(rest.after)}</Typography.Text>
        <Typography.Text type="secondary">(ບໍ່ປ່ຽນ)</Typography.Text>
      </Space>
    );
  }
  return (
    <Space size={6} wrap>
      <Typography.Text type="secondary">{restLabel(rest.before)}</Typography.Text>
      <ArrowRightOutlined style={{ fontSize: 11 }} />
      <Typography.Text strong>{restLabel(rest.after)}</Typography.Text>
    </Space>
  );
};

// What a whole group did on the swap date, when they all did the same.
function groupDayLine(people: PositionSwapPerson[], date: string) {
  const kinds = new Set(people.map((p) => p.swapDay?.kind ?? 'none'));
  if (kinds.size !== 1) return null;
  const day = people[0].swapDay;
  const d = dayjs(date).format('DD/MM');
  if (day?.kind === 'extended') {
    return `ມື້ສະຫຼັບ ${d}: ເຮັດວຽກຕໍ່ເນື່ອງ ${day.startTime} ຫາ ${day.endTime} ມື້ຖັດໄປ ເພື່ອບໍ່ໃຫ້ວຽກຂາດຄົນ`;
  }
  if (day?.kind === 'off') return `ມື້ສະຫຼັບ ${d}: ບໍ່ມີກະ — ກະເກົ່າຮອບສຸດທ້າຍຈົບຕອນເຊົ້າມື້ນັ້ນ`;
  if (day?.kind === 'kept') return `ມື້ສະຫຼັບ ${d}: ຍັງເຮັດກະເກົ່າ`;
  return null;
}

const Group: React.FC<{
  title: string;
  people: PositionSwapPerson[];
  swap: ScheduledPositionSwap;
  // Where each of them should be now: the other position while the swap is in
  // place, back where they were once it's undone. Not checked for a preview.
  expectedNow?: string;
}> = ({ title, people, swap, expectedNow }) => {
  const shifts = (pick: (p: PositionSwapPerson) => string | null) => [...new Set(people.map(pick).filter(Boolean))].join(', ') || '-';
  const before = shifts((p) => hours(p.previous));
  const after = shifts((p) => hours(p.next));
  const dayLine = groupDayLine(people, swap.effectiveDate);
  // Every one of them had the swap date set for them: the new shift starts the day after.
  const startsNextDay = people.length > 0 && people.every((p) => p.swapDay && p.swapDay.kind !== 'set');
  const newStart = dayjs(swap.effectiveDate).add(startsNextDay ? 1 : 0, 'day').format('DD/MM/YYYY');
  return (
    <div className="swap-detail-group" style={{ marginBottom: 20 }}>
      <Space size={8} wrap style={{ marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 15 }}>
          {title}
        </Typography.Text>
        <Tag>{people.length} ຄົນ</Tag>
      </Space>
      {people.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ display: 'block' }}>
            ກະປະຈຳ: {before === after ? `${after} (ບໍ່ປ່ຽນ)` : `${before} → ${after}`}
            {before !== after && ` · ເລີ່ມກະໃໝ່ວັນທີ ${newStart}`}
          </Typography.Text>
          {dayLine && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {dayLine}
            </Typography.Text>
          )}
        </div>
      )}
      <Table<PositionSwapPerson>
        dataSource={people}
        rowKey={(p) => p.employee._id}
        size="small"
        pagination={false}
        scroll={{ x: 720 }}
        locale={{ emptyText: 'ບໍ່ມີໃຜ' }}
      >
        <Table.Column<PositionSwapPerson> title="ລະຫັດ" width={90} render={(_, p) => p.employee.employeeCode ?? '-'} />
        <Table.Column<PositionSwapPerson>
          title="ຊື່"
          render={(_, p) => {
            const now = p.employee.position;
            const elsewhere = expectedNow && now?._id !== expectedNow;
            return (
              <Space size={4} wrap>
                <span>{personName(p)}</span>
                {p.employee.status && p.employee.status !== 'active' && <Tag>ບໍ່ໄດ້ເຮັດວຽກແລ້ວ</Tag>}
                {elsewhere && <Tag color="gold">ຕອນນີ້ຢູ່ {now?.name ?? 'ບໍ່ມີຕຳແໜ່ງ'}</Tag>}
              </Space>
            );
          }}
        />
        <Table.Column<PositionSwapPerson> title="ກະປະຈຳ (ເກົ່າ → ໃໝ່)" render={(_, p) => <ShiftChange previous={p.previous} next={p.next} />} />
        <Table.Column<PositionSwapPerson>
          title={`ມື້ສະຫຼັບ (${dayjs(swap.effectiveDate).format('DD/MM')})`}
          render={(_, p) => <SwapDay day={p.swapDay} />}
        />
        <Table.Column<PositionSwapPerson> title="ວັນພັກ" render={(_, p) => <RestDay rest={p.restDay} />} />
      </Table>
    </div>
  );
};

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'ລໍຖ້າ', color: 'gold' },
  applied: { label: 'ສະຫຼັບແລ້ວ', color: 'green' },
  cancelled: { label: 'ຍົກເລີກແລ້ວ', color: 'default' },
  reverted: { label: 'ຍ້ອນກັບແລ້ວ', color: 'purple' },
};

const DetailsBody: React.FC<{ swap: ScheduledPositionSwap }> = ({ swap }) => {
  const { data, isLoading, isError } = useCustom<PositionSwapDetails>({
    url: `${API_URL}/position-swaps/${swap._id}/details`,
    method: 'get',
    queryOptions: { enabled: swap.status !== 'cancelled' },
    errorNotification: false,
  });
  const details = data?.data;
  const nameA = positionName(swap.positionA);
  const nameB = positionName(swap.positionB);
  const date = dayjs(swap.effectiveDate).format('DD/MM/YYYY');
  const createdBy =
    typeof swap.createdBy === 'object' && swap.createdBy
      ? `${swap.createdBy.firstName ?? ''} ${swap.createdBy.lastName ?? ''}`.trim()
      : swap.createdByEmail || '-';

  const fromA = details?.people.filter((p) => p.from === 'A') ?? [];
  const fromB = details?.people.filter((p) => p.from === 'B') ?? [];
  const idA = positionId(swap.positionA);
  const idB = positionId(swap.positionB);
  const expected = (side: 'A' | 'B') => {
    if (swap.status === 'applied') return side === 'A' ? idB : idA;
    if (swap.status === 'reverted') return side === 'A' ? idA : idB;
    return undefined;
  };

  return (
    <>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="ວັນທີ່ມີຜົນ">{date}</Descriptions.Item>
        <Descriptions.Item label="ສະຖານະ">
          <Tag color={STATUS[swap.status]?.color}>{STATUS[swap.status]?.label ?? swap.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="ຜູ້ສ້າງ">{createdBy}</Descriptions.Item>
        <Descriptions.Item label="ສ້າງເມື່ອ">{dayjs(swap.createdAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
        {swap.appliedAt && <Descriptions.Item label="ສະຫຼັບເມື່ອ">{dayjs(swap.appliedAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>}
        {swap.revertedAt && (
          <Descriptions.Item label="ຍ້ອນກັບເມື່ອ">
            {dayjs(swap.revertedAt).format('DD/MM/YYYY HH:mm')}
            {swap.revertedByEmail ? ` (${swap.revertedByEmail})` : ''}
          </Descriptions.Item>
        )}
      </Descriptions>

      {swap.status === 'cancelled' ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ຍົກເລີກກ່ອນຮອດວັນສະຫຼັບ — ບໍ່ມີໃຜຖືກຍ້າຍ" />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : isError || !details ? (
        <Alert type="error" showIcon message="ໂຫຼດລາຍລະອຽດບໍ່ສຳເລັດ" />
      ) : (
        <>
          {details.preview && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="ຍັງບໍ່ທັນສະຫຼັບ"
              description={`ລາຍຊື່ນີ້ແມ່ນຄົນທີ່ຢູ່ໃນ 2 ຕຳແໜ່ງນີ້ຕອນນີ້ — ລະບົບຈະເບິ່ງຄົນທີ່ຢູ່ຈິງອີກເທື່ອໜຶ່ງໃນວັນທີ ${date} ແລ້ວຄ່ອຍສະຫຼັບ`}
            />
          )}
          {swap.status === 'reverted' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`ຍ້ອນກັບແລ້ວ — ຄືກັບບໍ່ເຄີຍສະຫຼັບ ຕັ້ງແຕ່ວັນທີ ${date}`}
              description="ລາຍຊື່ລຸ່ມນີ້ແມ່ນສິ່ງທີ່ການສະຫຼັບນີ້ເຄີຍເຮັດ. ທຸກຄົນກັບໄປຕຳແໜ່ງ, ກະປະຈຳ ແລະ ວັນພັກເດີມແລ້ວ ຍົກເວັ້ນຄົນທີ່ມີປ້າຍ ຕອນນີ້ຢູ່"
            />
          )}
          {!details.preview && !details.people.length ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ບໍ່ມີລາຍຊື່ຄົນທີ່ຖືກຍ້າຍບັນທຶກໄວ້" />
          ) : (
            <>
              <Group title={`${nameA} → ${nameB}`} people={fromA} swap={swap} expectedNow={expected('A')} />
              <Group title={`${nameB} → ${nameA}`} people={fromB} swap={swap} expectedNow={expected('B')} />
            </>
          )}
        </>
      )}
    </>
  );
};

export const SwapDetailsModal: React.FC<{ swap?: ScheduledPositionSwap; onClose: () => void }> = ({ swap, onClose }) => (
  <Modal
    title={swap ? `ລາຍລະອຽດການສະຫຼັບ: ${positionName(swap.positionA)} ⇄ ${positionName(swap.positionB)}` : ''}
    open={!!swap}
    onCancel={onClose}
    width={960}
    footer={<Button onClick={onClose}>ປິດ</Button>}
    destroyOnClose
  >
    {/* Keyed by status too, so it's read again once the swap changes (applied, undone). */}
    {swap && <DetailsBody key={`${swap._id}_${swap.status}`} swap={swap} />}
  </Modal>
);
