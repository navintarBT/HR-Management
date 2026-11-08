import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useGetIdentity, useInvalidate, useNotification, useList, useCustom } from '@refinedev/core';
import { Button, Space, Typography, Modal, Select, DatePicker, Table, Tag, Popconfirm, Input, Card, Statistic, Row, Col, Alert } from 'antd';
import { RetweetOutlined, EditOutlined, DeleteOutlined, SwapOutlined, SearchOutlined, RollbackOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { Department, Employee, Identity, Position, ScheduledPositionSwap } from '../../types';
import { SwapDetailsModal } from './swapDetails';

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'ລໍຖ້າ', color: 'gold' },
  applied: { label: 'ສະຫຼັບແລ້ວ', color: 'green' },
  cancelled: { label: 'ຍົກເລີກແລ້ວ', color: 'default' },
  reverted: { label: 'ຍ້ອນກັບແລ້ວ', color: 'purple' },
};

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

function resolveTime(employee: Employee): string {
  const category = employee.defaultShiftCategory;
  if (category && typeof category === 'object') return `${category.startTime}-${category.endTime}`;
  if (employee.defaultShiftStart && employee.defaultShiftEnd) return `${employee.defaultShiftStart}-${employee.defaultShiftEnd}`;
  return '-';
}

// Swaps are admin-driven now — a manager picks who's covering and sets the
// shift directly, rather than an employee filing a request to be approved
// (see the removed employee-initiated flow that used to live on this page
// and on ຕາຕະລາງກະ's own-shift click).
export const ShiftSwapListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';
  const canWrite = isAdmin || identity?.role === 'manager';

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const { data: allPositionsData } = useList<Position>({ resource: 'positions', pagination: { pageSize: 200 } });
  const allPositionsForSwap = allPositionsData?.data ?? [];

  // Filters just narrow which positions show up in the A/B pickers below —
  // there are 60+ positions now, too many to pick from directly.
  const { selectProps: departmentASelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const { selectProps: departmentBSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const [deptFilterA, setDeptFilterA] = useState<string>();
  const [deptFilterB, setDeptFilterB] = useState<string>();

  const positionOptionsA = useMemo(
    () =>
      allPositionsForSwap
        .filter((p) => !deptFilterA || (p.departments ?? []).some((d) => idOf(d) === deptFilterA))
        .map((p) => ({ label: p.name, value: p._id })),
    [allPositionsForSwap, deptFilterA]
  );
  const positionOptionsB = useMemo(
    () =>
      allPositionsForSwap
        .filter((p) => !deptFilterB || (p.departments ?? []).some((d) => idOf(d) === deptFilterB))
        .map((p) => ({ label: p.name, value: p._id })),
    [allPositionsForSwap, deptFilterB]
  );
  const filterByLabel = (input: string, option?: { label: string }) =>
    (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  const [positionSwapOpen, setPositionSwapOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [posA, setPosA] = useState<string>();
  const [posB, setPosB] = useState<string>();
  const [effectiveDate, setEffectiveDate] = useState<Dayjs>(() => dayjs());
  const [swappingPositions, setSwappingPositions] = useState(false);

  const closePositionSwapModal = () => {
    setPositionSwapOpen(false);
    setEditingId(undefined);
    setPosA(undefined);
    setPosB(undefined);
    setDeptFilterA(undefined);
    setDeptFilterB(undefined);
    setEffectiveDate(dayjs());
  };

  // Only a still-pending row is a draft — clear the department filters so the
  // position it's already set to is guaranteed to show up in the dropdown.
  const openEditSwap = (swap: ScheduledPositionSwap) => {
    setEditingId(swap._id);
    setPosA(idOf(swap.positionA));
    setPosB(idOf(swap.positionB));
    setDeptFilterA(undefined);
    setDeptFilterB(undefined);
    setEffectiveDate(dayjs(swap.effectiveDate));
    setPositionSwapOpen(true);
  };

  const {
    data: scheduleData,
    refetch: refetchSchedule,
  } = useCustom<ScheduledPositionSwap[]>({
    url: `${API_URL}/position-swaps`,
    method: 'get',
    queryOptions: { enabled: canWrite },
  });
  const scheduledSwaps = scheduleData?.data ?? [];
  // ລາຍລະອຽດ: read off the list each time, so it follows the swap as it changes.
  const [detailId, setDetailId] = useState<string>();
  const detailSwap = scheduledSwaps.find((s) => s._id === detailId);

  // Swaps deleted from this history whose changes are still in place: put back
  // on the list, they can be undone with ຍ້ອນກັບ like any other.
  type UnrecordedSwap = {
    effectiveDate: string;
    positionA: string;
    positionB: string;
    positionAName: string;
    positionBName: string;
    people: number;
    // The pair can't be told apart from a third position: shown, never put back.
    ambiguous: boolean;
    positions: { id: string; name: string; count: number }[];
  };
  const { data: unrecordedData, refetch: refetchUnrecorded } = useCustom<UnrecordedSwap[]>({
    url: `${API_URL}/position-swaps/unrecorded`,
    method: 'get',
    queryOptions: { enabled: isAdmin },
    // Only an extra on this page: if it can't be loaded (a server still on the
    // code from before it, while a deploy finishes) the page works without it.
    errorNotification: false,
  });
  const unrecordedSwaps = unrecordedData?.data ?? [];
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const restoreSwap = async (swap: UnrecordedSwap) => {
    const keyOf = `${swap.effectiveDate}_${swap.positionA}_${swap.positionB}`;
    setRestoringKey(keyOf);
    try {
      await axiosInstance.post(`${API_URL}/position-swaps/restore`, {
        effectiveDate: swap.effectiveDate,
        positionA: swap.positionA,
        positionB: swap.positionB,
      });
      notify?.({ type: 'success', message: 'ກູ້ຄືນລາຍການແລ້ວ — ກົດ ຍ້ອນກັບ ຢູ່ໃນປະຫວັດ ຖ້າຕ້ອງການຍ້ອນ' });
      refetchSchedule();
      refetchUnrecorded();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ກູ້ຄືນບໍ່ສໍາເລັດ' });
    } finally {
      setRestoringKey(null);
    }
  };

  const { data: empAData } = useList<Employee>({
    resource: 'employees',
    filters: [
      { field: 'status', operator: 'eq', value: 'active' },
      { field: 'position', operator: 'eq', value: posA },
    ],
    sorters: [{ field: 'employeeCode', order: 'asc' }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!posA },
  });
  const empListA = empAData?.data ?? [];

  const { data: empBData } = useList<Employee>({
    resource: 'employees',
    filters: [
      { field: 'status', operator: 'eq', value: 'active' },
      { field: 'position', operator: 'eq', value: posB },
    ],
    sorters: [{ field: 'employeeCode', order: 'asc' }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!posB },
  });
  const empListB = empBData?.data ?? [];

  // A position's own time never changes — everyone who ends up holding it
  // just takes on whatever that position is already set to (see the KTV
  // server positions: every employee in a position shares one time). So the
  // swap isn't a 1-to-1 person pairing — it's "whoever is in A now all move
  // to B and take on B's time, whoever is in B now all move to A and take on
  // A's time." The canonical time for a position is read off its first
  // current member (sorted by employee code) since they're all supposed to
  // already match; an empty position has no time to hand out, so movers into
  // it simply end up with no default shift set (same as a brand-new position).
  function canonicalTimeOf(list: Employee[]) {
    const ref = list[0];
    return {
      label: ref ? resolveTime(ref) : 'ບໍ່ໄດ້ກຳນົດ',
      categoryId: ref ? idOf(ref.defaultShiftCategory) ?? null : null,
      start: ref && !ref.defaultShiftCategory ? ref.defaultShiftStart ?? null : null,
      end: ref && !ref.defaultShiftCategory ? ref.defaultShiftEnd ?? null : null,
    };
  }
  const canonicalA = useMemo(() => canonicalTimeOf(empListA), [empListA]);
  const canonicalB = useMemo(() => canonicalTimeOf(empListB), [empListB]);

  const isImmediate = !effectiveDate.isAfter(dayjs(), 'day');

  // The actual swap (reading who's currently in each position and moving
  // them) always runs on the server — see POST /api/position-swaps — so a
  // future date fires correctly even with the browser closed. Today-or-past
  // applies right away; the server decides which, based on effectiveDate.
  const submitPositionSwap = async () => {
    if (!posA || !posB || posA === posB) return;
    setSwappingPositions(true);
    try {
      const payload = { positionA: posA, positionB: posB, effectiveDate: effectiveDate.format('YYYY-MM-DD') };
      if (editingId) {
        await axiosInstance.patch(`${API_URL}/position-swaps/${editingId}`, payload);
      } else {
        await axiosInstance.post(`${API_URL}/position-swaps`, payload);
      }
      notify?.({
        type: 'success',
        message: isImmediate
          ? 'ສະຫຼັບຕຳແໜ່ງສຳເລັດ'
          : `ຕັ້ງສະຫຼັບຕຳແໜ່ງລ່ວງໜ້າແລ້ວ — ຈະມີຜົນວັນທີ ${effectiveDate.format('DD/MM/YYYY')}`,
      });
      closePositionSwapModal();
      invalidate({ resource: 'employees', invalidates: ['list'] });
      // The swap also creates/replaces today's swap-day Shift pins (see
      // positionSwap.js) — without this, any other open page already showing
      // shift data (ຕາຕະລາງກະ, ປະຫວັດການສະແກນເຂົ້າ-ອອກວຽກ) keeps its stale
      // cached list and never learns those changed.
      invalidate({ resource: 'shifts', invalidates: ['list'] });
      refetchSchedule();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສໍາເລັດ' });
    } finally {
      setSwappingPositions(false);
    }
  };

  const cancelScheduledSwap = async (id: string) => {
    try {
      await axiosInstance.patch(`${API_URL}/position-swaps/${id}/cancel`, {});
      notify?.({ type: 'success', message: 'ຍົກເລີກລາຍການແລ້ວ' });
      refetchSchedule();
    } catch {
      notify?.({ type: 'error', message: 'ຍົກເລີກບໍ່ສໍາເລັດ' });
    }
  };

  // Only offered for a decided row (applied/cancelled) — a still-pending one
  // already has its own "ຍົກເລີກ" action, and deleting it outright would just
  // be a confusing second way to do the same thing.
  const deleteScheduledSwap = async (id: string) => {
    try {
      await axiosInstance.delete(`${API_URL}/position-swaps/${id}`);
      notify?.({ type: 'success', message: 'ລຶບລາຍການແລ້ວ' });
      refetchSchedule();
      refetchUnrecorded();
    } catch {
      notify?.({ type: 'error', message: 'ລຶບບໍ່ສໍາເລັດ' });
    }
  };

  // ຍ້ອນກັບ: as if the swap never happened, from its date on — for a swap set
  // wrong while everyone kept their old shifts (server: positionSwap.js
  // revertPositionSwap). Asks first: it judges their attendance since again.
  const [modal, modalContext] = Modal.useModal();
  const revertSwap = (swap: ScheduledPositionSwap) => {
    const nameOf = (p: Position | string) => (p && typeof p === 'object' ? p.name : '-');
    const date = dayjs(swap.effectiveDate).format('DD/MM/YYYY');
    modal.confirm({
      title: `ຍ້ອນກັບການສະຫຼັບ ${nameOf(swap.positionA)} ⇄ ${nameOf(swap.positionB)} ວັນທີ ${date}?`,
      width: 560,
      content: (
        <Space direction="vertical" size={6}>
          <Typography.Text>ຄືກັບບໍ່ເຄີຍສະຫຼັບ ຕັ້ງແຕ່ວັນທີ {date} ເປັນຕົ້ນໄປ:</Typography.Text>
          <Typography.Text>• ທຸກຄົນທີ່ຖືກສະຫຼັບກັບໄປຕຳແໜ່ງ, ກະປະຈຳ ແລະ ວັນພັກເດີມ</Typography.Text>
          <Typography.Text>• ວັນທີ {date} ບໍ່ມີກະຕໍ່ເນື່ອງ ຫຼື ວັນວ່າງຂອງການສະຫຼັບອີກ</Typography.Text>
          <Typography.Text>• ການສະແກນຕັ້ງແຕ່ {date} ຈະຖືກຄິດໃໝ່ຕາມກະເດີມ — ໃຊ້ເມື່ອພະນັກງານຍັງເຮັດວຽກຕາມກະເດີມແທ້</Typography.Text>
          <Typography.Text type="secondary">ພະນັກງານບໍ່ຕ້ອງເຮັດຫຍັງ. ຫຼັງຈາກນີ້ຕັ້ງວັນສະຫຼັບໃໝ່ໄດ້ຕາມປົກກະຕິ</Typography.Text>
        </Space>
      ),
      okText: 'ຍ້ອນກັບ',
      okButtonProps: { danger: true },
      cancelText: 'ບໍ່',
      onOk: async () => {
        try {
          const { data } = await axiosInstance.post(`${API_URL}/position-swaps/${swap._id}/revert`, {});
          notify?.({
            type: 'success',
            message: [
              `ຍ້ອນກັບແລ້ວ ${data.reverted} ຄົນ`,
              data.skipped ? `${data.skipped} ຄົນຖືກຍ້າຍໄປບ່ອນອື່ນແລ້ວ ຈຶ່ງບໍ່ປ່ຽນ` : '',
              data.laterRestPlans ? `ແຜນວັນພັກທີ່ລະບົບປັບຕອນສະຫຼັບ ${data.laterRestPlans} ລາຍການ — ກວດເບິ່ງຢູ່ ວາງແຜນວັນພັກ` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          });
          invalidate({ resource: 'employees', invalidates: ['list'] });
          invalidate({ resource: 'shifts', invalidates: ['list'] });
          invalidate({ resource: 'attendance-daily', invalidates: ['list'] });
          refetchSchedule();
          refetchUnrecorded();
        } catch (err: any) {
          notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍ້ອນກັບບໍ່ສໍາເລັດ' });
        }
      },
    });
  };

  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>();
  const [historyRange, setHistoryRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [historyDeptFilter, setHistoryDeptFilter] = useState<string>();
  const [historyPosFilter, setHistoryPosFilter] = useState<string>();
  const { selectProps: historyDeptSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const historyPosOptions = useMemo(
    () =>
      allPositionsForSwap
        .filter((p) => !historyDeptFilter || (p.departments ?? []).some((d) => idOf(d) === historyDeptFilter))
        .map((p) => ({ label: p.name, value: p._id })),
    [allPositionsForSwap, historyDeptFilter]
  );

  // A swap always involves two positions — department/position filters match
  // when EITHER side (A or B) matches, so a row shows up under both of the
  // departments/positions it touches.
  const filteredSwaps = useMemo(() => {
    const fromKey = historyRange?.[0].format('YYYY-MM-DD');
    const toKey = historyRange?.[1].format('YYYY-MM-DD');
    const inDept = (pos: ScheduledPositionSwap['positionA']) =>
      !!pos && typeof pos === 'object' && (pos.departments ?? []).some((d) => idOf(d) === historyDeptFilter);
    return scheduledSwaps.filter((s) => {
      if (historyStatusFilter && s.status !== historyStatusFilter) return false;
      if (fromKey && toKey && (s.effectiveDate < fromKey || s.effectiveDate > toKey)) return false;
      if (historyDeptFilter && !inDept(s.positionA) && !inDept(s.positionB)) return false;
      if (historyPosFilter && idOf(s.positionA) !== historyPosFilter && idOf(s.positionB) !== historyPosFilter) return false;
      if (historySearch) {
        const q = historySearch.trim().toLowerCase();
        // A position deleted since comes back null.
        const nameA = s.positionA && typeof s.positionA === 'object' ? s.positionA.name.toLowerCase() : '';
        const nameB = s.positionB && typeof s.positionB === 'object' ? s.positionB.name.toLowerCase() : '';
        if (!nameA.includes(q) && !nameB.includes(q)) return false;
      }
      return true;
    });
  }, [scheduledSwaps, historySearch, historyStatusFilter, historyRange, historyDeptFilter, historyPosFilter]);
  const pendingCount = scheduledSwaps.filter((s) => s.status === 'pending').length;

  return (
    <List
      title="ສະຫຼັບກະ"
      breadcrumb={false}
      headerButtons={
        canWrite ? (
          <Button type="primary" icon={<RetweetOutlined />} onClick={() => { closePositionSwapModal(); setPositionSwapOpen(true); }}>
            ສະຫຼັບຕຳແໜ່ງ
          </Button>
        ) : (
          <></>
        )
      }
    >
      {modalContext}
      <SwapDetailsModal swap={detailSwap} onClose={() => setDetailId(undefined)} />
      {!canWrite && <Typography.Paragraph type="secondary">ການສະຫຼັບກະຈັດການໂດຍຜູ້ຄຸ້ມຄອງເທົ່ານັ້ນ</Typography.Paragraph>}

      <Modal
        title={editingId ? 'ແກ້ໄຂການສະຫຼັບຕຳແໜ່ງ' : 'ສະຫຼັບຕຳແໜ່ງ'}
        open={positionSwapOpen}
        onCancel={closePositionSwapModal}
        onOk={submitPositionSwap}
        confirmLoading={swappingPositions}
        okText={isImmediate ? `ຢືນຢັນສະຫຼັບ (${empListA.length + empListB.length} ຄົນ)` : 'ຕັ້ງລ່ວງໜ້າ'}
        okButtonProps={{ disabled: !posA || !posB || posA === posB }}
        cancelText="ຍົກເລີກ"
        width={640}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ທຸກຄົນທີ່ຢູ່ຕຳແໜ່ງ A ຈະຍ້າຍໄປຕຳແໜ່ງ B ແລະ ໃຊ້ໂມງເຮັດວຽກຂອງຕຳແໜ່ງ B, ສ່ວນທຸກຄົນທີ່ຢູ່ຕຳແໜ່ງ B ຈະຍ້າຍໄປຕຳແໜ່ງ A ແລະ ໃຊ້ໂມງເຮັດວຽກຂອງຕຳແໜ່ງ A — ໂມງຂອງແຕ່ລະຕຳແໜ່ງເອງບໍ່ປ່ຽນ
        </Typography.Paragraph>
        <Row align="middle" gutter={12} style={{ marginBottom: 16 }}>
          <Col span={11}>
            <Card size="small" title="ຕຳແໜ່ງ A" style={{ background: 'var(--app-surface-bg)' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  {...departmentASelect}
                  placeholder="ພະແນກ (ກອງ A)"
                  allowClear
                  style={{ width: '100%' }}
                  value={deptFilterA}
                  onChange={(v: any) => {
                    setDeptFilterA(v);
                    setPosA(undefined);
                  }}
                />
                <Select
                  options={positionOptionsA}
                  showSearch
                  filterOption={filterByLabel}
                  placeholder="ຕຳແໜ່ງ A"
                  style={{ width: '100%' }}
                  value={posA}
                  onChange={(v: any) => setPosA(v)}
                />
              </Space>
            </Card>
          </Col>
          <Col span={2} style={{ textAlign: 'center' }}>
            <SwapOutlined style={{ fontSize: 20, color: 'var(--app-primary, #9F1239)' }} />
          </Col>
          <Col span={11}>
            <Card size="small" title="ຕຳແໜ່ງ B" style={{ background: 'var(--app-surface-bg)' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  {...departmentBSelect}
                  placeholder="ພະແນກ (ກອງ B)"
                  allowClear
                  style={{ width: '100%' }}
                  value={deptFilterB}
                  onChange={(v: any) => {
                    setDeptFilterB(v);
                    setPosB(undefined);
                  }}
                />
                <Select
                  options={positionOptionsB}
                  showSearch
                  filterOption={filterByLabel}
                  placeholder="ຕຳແໜ່ງ B"
                  style={{ width: '100%' }}
                  value={posB}
                  onChange={(v: any) => setPosB(v)}
                />
              </Space>
            </Card>
          </Col>
        </Row>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          <Space wrap align="center">
            <Typography.Text>ວັນທີ່ມີຜົນ:</Typography.Text>
            <DatePicker
              format="DD/MM/YYYY"
              allowClear={false}
              value={effectiveDate}
              disabledDate={(d) => d.isBefore(dayjs(), 'day')}
              onChange={(v) => v && setEffectiveDate(v)}
            />
          </Space>
        </Space>
        {posA && posB && posA === posB && <Typography.Text type="danger">ກະລຸນາເລືອກ 2 ຕຳແໜ່ງທີ່ບໍ່ຊ້ຳກັນ</Typography.Text>}
        {posA && posB && posA !== posB && (
          <>
            {!isImmediate && (
              <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
                ຍັງບໍ່ມີຜົນທັນທີ — ລາຍຊື່ຂ້າງລຸ່ມແມ່ນຄົນທີ່ຢູ່ໃນຕຳແໜ່ງນີ້ ณ ຕອນນີ້, ລະບົບຈະໄປເບິ່ງຄົນທີ່ຢູ່ຈິງອີກເທື່ອໜຶ່ງໃນວັນທີ {effectiveDate.format('DD/MM/YYYY')} ແລ້ວຄ່ອຍສະຫຼັບໃຫ້ອັດຕະໂນມັດ
              </Typography.Paragraph>
            )}
            <Space align="start" size="large" style={{ width: '100%' }}>
              <div style={{ flex: 1 }}>
                <Typography.Text strong>
                  ຕຳແໜ່ງ A → B ({empListA.length} ຄົນ, ໃຊ້ໂມງ {canonicalB.label})
                </Typography.Text>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {empListA.map((e) => (
                    <li key={e._id}>
                      {e.firstName} {e.lastName} <Typography.Text type="secondary">({resolveTime(e)})</Typography.Text>
                    </li>
                  ))}
                  {!empListA.length && <Typography.Text type="secondary">ບໍ່ມີໃຜຢູ່ຕຳແໜ່ງນີ້</Typography.Text>}
                </ul>
              </div>
              <div style={{ flex: 1 }}>
                <Typography.Text strong>
                  ຕຳແໜ່ງ B → A ({empListB.length} ຄົນ, ໃຊ້ໂມງ {canonicalA.label})
                </Typography.Text>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {empListB.map((e) => (
                    <li key={e._id}>
                      {e.firstName} {e.lastName} <Typography.Text type="secondary">({resolveTime(e)})</Typography.Text>
                    </li>
                  ))}
                  {!empListB.length && <Typography.Text type="secondary">ບໍ່ມີໃຜຢູ່ຕຳແໜ່ງນີ້</Typography.Text>}
                </ul>
              </div>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              ໝາຍເຫດ: ສະເພາະມື້ທີ່ມີຜົນ ລະບົບຈະຈັດຕາຕະລາງໃຫ້ອັດຕະໂນມັດເພື່ອບໍ່ໃຫ້ວຽກຂາດຄົນ — ຖ້າ 2 ຕຳແໜ່ງນີ້ໂມງຕໍ່ກັນພໍດີ 24 ຊມ (ເຊັ່ນ ກະເຊົ້າ/ກະແລງ) ຝັ່ງທີ່ອອກຈາກກະເລີ່ມກ່ອນຈະເຮັດວຽກຕໍ່ເນື່ອງໃຫ້ຈົນຮອດຮອບໃໝ່ ອີກຝັ່ງຈະບໍ່ມີກະໃນມື້ນັ້ນ
            </Typography.Paragraph>
          </>
        )}
      </Modal>

      {canWrite && (
        <>
          <Row gutter={12} style={{ marginTop: 24, marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="ທັງໝົດ" value={scheduledSwaps.length} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="ລໍຖ້າ" value={pendingCount} valueStyle={{ color: '#d4a017' }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="ສະຫຼັບແລ້ວ"
                  value={scheduledSwaps.filter((s) => s.status === 'applied').length}
                  valueStyle={{ color: '#389e0d' }}
                />
              </Card>
            </Col>
          </Row>

          <Typography.Title level={5}>ລາຍການສະຫຼັບຕຳແໜ່ງທີ່ຕັ້ງໄວ້</Typography.Title>
          <Space wrap style={{ marginBottom: 12 }}>
            <Input.Search
              placeholder="ຄົ້ນຫາຊື່ຕຳແໜ່ງ"
              allowClear
              style={{ width: 220 }}
              prefix={<SearchOutlined />}
              onSearch={(v) => setHistorySearch(v)}
              onChange={(e) => !e.target.value && setHistorySearch('')}
            />
            <DatePicker.RangePicker
              format="DD/MM/YYYY"
              placeholder={['ວັນທີ່ມີຜົນ ຈາກ', 'ຫາ']}
              value={historyRange}
              onChange={(v) => setHistoryRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
            />
            <Select
              {...historyDeptSelect}
              placeholder="ກອງຕາມພະແນກ"
              allowClear
              style={{ width: 180 }}
              value={historyDeptFilter}
              onChange={(v: any) => {
                setHistoryDeptFilter(v);
                const stillValid =
                  !v ||
                  !historyPosFilter ||
                  allPositionsForSwap.find((p) => p._id === historyPosFilter)?.departments?.some((d) => idOf(d) === v);
                if (!stillValid) setHistoryPosFilter(undefined);
              }}
            />
            <Select
              options={historyPosOptions}
              showSearch
              filterOption={filterByLabel}
              placeholder="ກອງຕາມຕຳແໜ່ງ"
              allowClear
              style={{ width: 200 }}
              value={historyPosFilter}
              onChange={(v: any) => setHistoryPosFilter(v)}
            />
            <Select
              placeholder="ກອງຕາມສະຖານະ"
              allowClear
              style={{ width: 160 }}
              value={historyStatusFilter}
              onChange={(v: any) => setHistoryStatusFilter(v)}
              options={Object.entries(SCHEDULE_STATUS).map(([value, { label }]) => ({ value, label }))}
            />
          </Space>
          {unrecordedSwaps.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`ພົບການສະຫຼັບ ${unrecordedSwaps.length} ລາຍການທີ່ຖືກລຶບອອກຈາກປະຫວັດ ແຕ່ຍັງມີຜົນຢູ່`}
              description={
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Typography.Text type="secondary">ກູ້ຄືນລາຍການກ່ອນ ແລ້ວກົດ ຍ້ອນກັບ ຢູ່ໃນຕາຕະລາງ ຖ້າຕ້ອງການໃຫ້ກັບເປັນແບບເດີມ</Typography.Text>
                  {unrecordedSwaps.map((u) => {
                    const keyOf = `${u.effectiveDate}_${u.positionA}_${u.positionB}`;
                    return (
                      <Space key={keyOf} className="unrecorded-swap" wrap>
                        <Typography.Text strong>{dayjs(u.effectiveDate).format('DD/MM/YYYY')}</Typography.Text>
                        {u.ambiguous ? (
                          <Typography.Text type="secondary">
                            {u.positions.map((p) => `${p.name} (${p.count})`).join(', ')} — ບອກບໍ່ໄດ້ແນ່ນອນວ່າແມ່ນ 2 ຕຳແໜ່ງໃດ, ກູ້ຄືນອັດຕະໂນມັດບໍ່ໄດ້
                          </Typography.Text>
                        ) : (
                          <>
                            <Typography.Text>
                              {u.positionAName} ⇄ {u.positionBName} ({u.people} ຄົນ)
                            </Typography.Text>
                            <Button size="small" loading={restoringKey === keyOf} onClick={() => restoreSwap(u)}>
                              ກູ້ຄືນລາຍການ
                            </Button>
                          </>
                        )}
                      </Space>
                    );
                  })}
                </Space>
              }
            />
          )}
          <Table
            dataSource={filteredSwaps}
            rowKey="_id"
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: scheduledSwaps.length ? 'ບໍ່ພົບລາຍການ' : 'ຍັງບໍ່ມີລາຍການ' }}
          >
            <Table.Column
              title="ຕຳແໜ່ງ A"
              render={(_, r: ScheduledPositionSwap) =>
                r.positionA && typeof r.positionA === 'object' ? r.positionA.name : 'ຕຳແໜ່ງນີ້ຖືກລຶບໄປແລ້ວ'
              }
            />
            <Table.Column
              title="ຕຳແໜ່ງ B"
              render={(_, r: ScheduledPositionSwap) =>
                r.positionB && typeof r.positionB === 'object' ? r.positionB.name : 'ຕຳແໜ່ງນີ້ຖືກລຶບໄປແລ້ວ'
              }
            />
            <Table.Column
              title="ວັນທີ່ມີຜົນ"
              render={(_, r: ScheduledPositionSwap) => dayjs(r.effectiveDate).format('DD/MM/YYYY')}
            />
            <Table.Column
              title="ຈຳນວນທີ່ຍ້າຍ"
              align="center"
              render={(_, r: ScheduledPositionSwap) =>
                r.status === 'applied' || r.status === 'reverted' ? (
                  // Not known for a record put back before it was counted.
                  r.movedFromA == null && r.movedFromB == null ? (
                    '-'
                  ) : (
                    <Button type="link" size="small" onClick={() => setDetailId(r._id)}>
                      {(r.movedFromA ?? 0) + (r.movedFromB ?? 0)} ຄົນ
                    </Button>
                  )
                ) : r.status === 'pending' ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ຮູ້ຕອນສະຫຼັບ
                  </Typography.Text>
                ) : (
                  '-'
                )
              }
            />
            <Table.Column
              title="ຜູ້ສ້າງ"
              render={(_, r: ScheduledPositionSwap) =>
                typeof r.createdBy === 'object' && r.createdBy
                  ? `${r.createdBy.firstName ?? ''} ${r.createdBy.lastName ?? ''}`.trim()
                  : r.createdByEmail || '-'
              }
            />
            <Table.Column
              title="ສະຖານະ"
              render={(_, r: ScheduledPositionSwap) => (
                <Tag color={SCHEDULE_STATUS[r.status]?.color}>{SCHEDULE_STATUS[r.status]?.label ?? r.status}</Tag>
              )}
            />
            <Table.Column
              title="ຈັດການ"
              render={(_, r: ScheduledPositionSwap) => (
                <Space>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailId(r._id)}>
                    ລາຍລະອຽດ
                  </Button>
                  {r.status === 'pending' && (
                    <>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEditSwap(r)} />
                      <Popconfirm title="ຍົກເລີກລາຍການນີ້?" onConfirm={() => cancelScheduledSwap(r._id)}>
                        <Button size="small" danger>
                          ຍົກເລີກ
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {isAdmin && r.status === 'applied' && (
                    <Button size="small" icon={<RollbackOutlined />} onClick={() => revertSwap(r)}>
                      ຍ້ອນກັບ
                    </Button>
                  )}
                  {r.status !== 'pending' && isAdmin && (
                    <Popconfirm
                      title="ລຶບລາຍການປະຫວັດນີ້?"
                      description={r.status === 'applied' ? 'ການສະຫຼັບຍັງມີຜົນຢູ່ — ລຶບແລ້ວຈະບໍ່ມີປຸ່ມ ຍ້ອນກັບ ຈົນກວ່າຈະກູ້ຄືນລາຍການ' : undefined}
                      onConfirm={() => deleteScheduledSwap(r._id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              )}
            />
          </Table>
        </>
      )}
    </List>
  );
};
