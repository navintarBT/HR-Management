import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useGetIdentity, useInvalidate, useNotification, useList, useCustom } from '@refinedev/core';
import { Button, Space, Typography, Modal, Select, DatePicker, Table, Tag, Popconfirm } from 'antd';
import { RetweetOutlined, EditOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { Department, Employee, Identity, Position, ScheduledPositionSwap } from '../../types';

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'ລໍຖ້າ', color: 'gold' },
  applied: { label: 'ສະຫຼັບແລ້ວ', color: 'green' },
  cancelled: { label: 'ຍົກເລີກແລ້ວ', color: 'default' },
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
  const canWrite = identity?.role === 'admin' || identity?.role === 'manager';

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
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          <Space wrap>
            <Select
              {...departmentASelect}
              placeholder="ພະແນກ (ກອງ A)"
              allowClear
              style={{ width: 180 }}
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
              style={{ width: 220 }}
              value={posA}
              onChange={(v: any) => setPosA(v)}
            />
          </Space>
          <Typography.Text type="secondary">↔</Typography.Text>
          <Space wrap>
            <Select
              {...departmentBSelect}
              placeholder="ພະແນກ (ກອງ B)"
              allowClear
              style={{ width: 180 }}
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
              style={{ width: 220 }}
              value={posB}
              onChange={(v: any) => setPosB(v)}
            />
          </Space>
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
          </>
        )}
      </Modal>

      {canWrite && (
        <>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            ລາຍການສະຫຼັບຕຳແໜ່ງທີ່ຕັ້ງໄວ້
          </Typography.Title>
          <Table
            dataSource={scheduledSwaps}
            rowKey="_id"
            pagination={false}
            locale={{ emptyText: 'ຍັງບໍ່ມີລາຍການ' }}
          >
            <Table.Column
              title="ຕຳແໜ່ງ A"
              render={(_, r: ScheduledPositionSwap) => (typeof r.positionA === 'object' ? r.positionA.name : '-')}
            />
            <Table.Column
              title="ຕຳແໜ່ງ B"
              render={(_, r: ScheduledPositionSwap) => (typeof r.positionB === 'object' ? r.positionB.name : '-')}
            />
            <Table.Column
              title="ວັນທີ່ມີຜົນ"
              render={(_, r: ScheduledPositionSwap) => dayjs(r.effectiveDate).format('DD/MM/YYYY')}
            />
            <Table.Column
              title="ສະຖານະ"
              render={(_, r: ScheduledPositionSwap) => (
                <Tag color={SCHEDULE_STATUS[r.status]?.color}>{SCHEDULE_STATUS[r.status]?.label ?? r.status}</Tag>
              )}
            />
            <Table.Column
              title="ຈັດການ"
              render={(_, r: ScheduledPositionSwap) =>
                r.status === 'pending' ? (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditSwap(r)} />
                    <Popconfirm title="ຍົກເລີກລາຍການນີ້?" onConfirm={() => cancelScheduledSwap(r._id)}>
                      <Button size="small" danger>
                        ຍົກເລີກ
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : null
              }
            />
          </Table>
        </>
      )}
    </List>
  );
};
