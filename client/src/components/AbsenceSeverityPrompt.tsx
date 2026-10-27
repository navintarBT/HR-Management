import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSelect } from '@refinedev/antd';
import { Modal, DatePicker, Table, Typography, Space, Select, Button, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../providers/axios';
import type { AbsenceSeverityChange, Position } from '../types';

// An absence's ວັນຫ້າມຂາດ / ມື້ທຳມະດາ tier is locked when it's recorded
// (server/src/utils/absenceSeverity.js), so changing a rule or moving someone
// to another position no longer rewrites absences already on file. This is
// the deliberate way to carry a change over to them: after a rule change or a
// position move it asks — only when some absence this month would actually
// change — and ຄິດລະດັບໃໝ່ does the same for any range on demand.

type Scope = { positions?: string[]; employees?: string[] };
type AfterChange = {
  mode: 'afterChange';
  scope: Scope;
  // A rule change usually means "this is the rule now", so applying from the
  // start of the month is offered first; a position move keeps the old tiers
  // by default (those days were worked in the old position).
  applyByDefault: boolean;
  reason: string;
  onDone?: () => void;
};
type Request = (AfterChange | { mode: 'recalc' }) & { id: number };

async function fetchChanges(scope: Scope, from: string, to: string, apply = false): Promise<AbsenceSeverityChange[]> {
  const res = await axiosInstance.post(`${API_URL}/attendance-daily/absence-severity`, { ...scope, from, to, apply });
  return res.data.changes;
}

const tierLabel = (tier: AbsenceSeverityChange['from']) => tier ?? 'ບໍ່ຕັດເງິນ';

export function useAbsenceSeverityPrompt() {
  const [request, setRequest] = useState<Request | null>(null);

  const prompt = async (scope: Scope, options: Omit<AfterChange, 'mode' | 'scope'>) => {
    try {
      const changes = await fetchChanges(scope, dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'));
      if (!changes.length) {
        options.onDone?.();
        return;
      }
      setRequest({ mode: 'afterChange', scope, ...options, id: Date.now() });
    } catch {
      // Asking is a courtesy on top of a save that already went through.
      options.onDone?.();
    }
  };

  const openRecalc = () => setRequest({ mode: 'recalc', id: Date.now() });

  const close = () => {
    const done = request?.mode === 'afterChange' ? request.onDone : undefined;
    setRequest(null);
    done?.();
  };

  const modal = request ? <AbsenceSeverityModal key={request.id} request={request} onClose={close} /> : null;
  return { prompt, openRecalc, modal };
}

const PromptContext = createContext<ReturnType<typeof useAbsenceSeverityPrompt> | null>(null);

// For a page with several rule tables — one dialog shared by all of them.
export function AbsenceSeverityPromptProvider({ children }: { children: ReactNode }) {
  const value = useAbsenceSeverityPrompt();
  return (
    <PromptContext.Provider value={value}>
      {children}
      {value.modal}
    </PromptContext.Provider>
  );
}

export function useAbsenceSeverityPromptContext() {
  const value = useContext(PromptContext);
  if (!value) throw new Error('useAbsenceSeverityPromptContext outside AbsenceSeverityPromptProvider');
  return value;
}

export function AbsenceSeverityRecalcButton() {
  const { openRecalc } = useAbsenceSeverityPromptContext();
  return <Button onClick={openRecalc}>ຄິດລະດັບໃໝ່</Button>;
}

function AbsenceSeverityModal({ request, onClose }: { request: Request; onClose: () => void }) {
  const isRecalc = request.mode === 'recalc';
  const [from, setFrom] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [to, setTo] = useState<Dayjs>(() => dayjs());
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [changes, setChanges] = useState<AbsenceSeverityChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const { selectProps: positionSelect } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
    queryOptions: { enabled: isRecalc },
  });

  const scope: Scope = isRecalc ? { positions: positionIds } : request.scope;
  const scopeKey = JSON.stringify(scope);
  const fromKey = from.format('YYYY-MM-DD');
  const toKey = (isRecalc ? to : dayjs()).format('YYYY-MM-DD');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChanges(scope, fromKey, toKey)
      .then((c) => !cancelled && setChanges(c))
      .catch(() => !cancelled && setChanges([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, fromKey, toKey]);

  const apply = async () => {
    setApplying(true);
    try {
      const applied = await fetchChanges(scope, fromKey, toKey, true);
      message.success(`ປ່ຽນລະດັບການຕັດເງິນແລ້ວ ${applied.length} ລາຍການ`);
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ');
    } finally {
      setApplying(false);
    }
  };

  const applyFirst = isRecalc || (request.mode === 'afterChange' && request.applyByDefault);
  const applyButton = (
    <Button key="apply" type={applyFirst ? 'primary' : 'default'} loading={applying} disabled={loading || !changes.length} onClick={apply}>
      ນຳໃຊ້ກັບ {changes.length} ລາຍການ
    </Button>
  );
  const skipButton = (
    <Button key="skip" type={applyFirst ? 'default' : 'primary'} onClick={onClose}>
      {isRecalc ? 'ປິດ' : 'ບໍ່ໃຊ້ — ຮັກສາລະດັບເກົ່າ'}
    </Button>
  );

  return (
    <Modal
      open
      width={680}
      title={isRecalc ? 'ຄິດລະດັບການຕັດເງິນຂອງ ຂ ໃໝ່' : 'ໃຊ້ກົດໃໝ່ກັບ ຂ ທີ່ມີຢູ່ແລ້ວບໍ?'}
      onCancel={onClose}
      footer={[skipButton, applyButton]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {isRecalc
            ? 'ຄິດລະດັບ X2/X3 ຂອງ ຂ ໃນຊ່ວງທີ່ເລືອກ ຕາມກົດ ແລະ ຕຳແໜ່ງປັດຈຸບັນ — ເບິ່ງລາຍການກ່ອນ ແລ້ວຈຶ່ງກົດນຳໃຊ້'
            : `${request.mode === 'afterChange' ? request.reason : ''} — ລະດັບຂອງ ຂ ທີ່ບັນທຶກໄປແລ້ວຈະບໍ່ປ່ຽນເອງ. ຖ້າຢາກໃຫ້ກົດໃໝ່ມີຜົນກັບ ຂ ເຫຼົ່ານີ້ນຳ ໃຫ້ກົດນຳໃຊ້:`}
        </Typography.Text>
        <Space wrap>
          {isRecalc ? (
            <>
              <DatePicker.RangePicker
                value={[from, to]}
                format="DD/MM/YYYY"
                allowClear={false}
                onChange={(v) => {
                  if (v?.[0] && v?.[1]) {
                    setFrom(v[0]);
                    setTo(v[1]);
                  }
                }}
              />
              <Select
                {...positionSelect}
                mode="multiple"
                allowClear
                placeholder="ທຸກຕຳແໜ່ງ"
                style={{ minWidth: 240 }}
                value={positionIds}
                onChange={(v: any) => setPositionIds(v ?? [])}
              />
            </>
          ) : (
            <>
              <Typography.Text>ໃຊ້ຕັ້ງແຕ່ວັນທີ</Typography.Text>
              <DatePicker
                value={from}
                format="DD/MM/YYYY"
                allowClear={false}
                disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                onChange={(v) => v && setFrom(v)}
              />
            </>
          )}
        </Space>
        <Table
          dataSource={changes}
          rowKey="_id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'ບໍ່ມີ ຂ ທີ່ຈະປ່ຽນໃນຊ່ວງນີ້' }}
        >
          <Table.Column title="ລະຫັດ" dataIndex="employeeCode" width={80} />
          <Table.Column title="ຊື່" dataIndex="employeeName" />
          <Table.Column title="ວັນທີ" width={110} render={(_, c: AbsenceSeverityChange) => dayjs(c.date).format('DD/MM/YYYY')} />
          <Table.Column title="ປັດຈຸບັນ" width={100} render={(_, c: AbsenceSeverityChange) => tierLabel(c.from)} />
          <Table.Column
            title="ຈະເປັນ"
            width={100}
            render={(_, c: AbsenceSeverityChange) => <Typography.Text strong>{tierLabel(c.to)}</Typography.Text>}
          />
        </Table>
      </Space>
    </Modal>
  );
}
