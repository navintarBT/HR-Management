import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useList, useCustom, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Select, Button, Space, Typography, Modal, Input, Tag, Popconfirm } from 'antd';
import { ApartmentOutlined, IdcardOutlined, ClockCircleOutlined, SearchOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { API_URL, axiosInstance } from '../../providers/axios';
import type { Employee, Department, Position, ScheduledShiftChange, BulkEditAction, BulkEditRound } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { useAbsenceSeverityPrompt } from '../../components/AbsenceSeverityPrompt';
import {
  ShiftChangeFields,
  scheduleShiftChange,
  cancelScheduledShiftChange,
  shiftCategoryLabel,
} from '../../components/ShiftChangeAhead';
import { BulkEditHistory } from './bulkHistory';

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// Same resolution rule as ຕັ້ງຄ່າແຜນວຽກ and the employee show page — a linked
// category is a live reference (editing the category later updates this too),
// defaultShiftStart/End is the fallback for a manual time with no category.
function resolveDefaultShiftTime(employee: Employee): { start: string; end: string } | null {
  const category = employee.defaultShiftCategory;
  if (category && typeof category === 'object') return { start: category.startTime, end: category.endTime };
  if (employee.defaultShiftStart && employee.defaultShiftEnd) return { start: employee.defaultShiftStart, end: employee.defaultShiftEnd };
  return null;
}

// This page manages employees in GROUPS — permanently moving them to a
// different department/position, or moving their regular shift from a chosen
// date (the same ຍ້າຍກະລ່ວງໜ້າ as ຕັ້ງຄ່າແຜນວຽກ). Day-to-day per-person
// adjustments (a single rest day, a one-off time change) belong on
// ຕັ້ງຄ່າແຜນວຽກ instead.
export const BulkShiftEditPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { selectProps: departmentSelect, query: departmentQuery } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allDepartments = departmentQuery?.data?.data ?? [];

  const { selectProps: positionSelect, query: positionQuery } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allPositions = positionQuery?.data?.data ?? [];

  const positionOptionsForFilter = useMemo(() => {
    if (!departmentFilter) return undefined;
    return allPositions
      .filter((p) => (p.departments ?? []).some((d) => idOf(d) === departmentFilter))
      .map((p) => ({ label: p.name, value: p._id }));
  }, [allPositions, departmentFilter]);

  const filters = useMemo(() => {
    const f: any[] = [{ field: 'status', operator: 'eq', value: 'active' }];
    if (search) f.push({ field: 'q', operator: 'eq', value: search });
    if (departmentFilter) f.push({ field: 'department', operator: 'eq', value: departmentFilter });
    if (positionFilter) f.push({ field: 'position', operator: 'eq', value: positionFilter });
    return f;
  }, [search, departmentFilter, positionFilter]);

  const { data: employeesData, isLoading, refetch } = useList<Employee>({
    resource: 'employees',
    filters,
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const employees = employeesData?.data ?? [];

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const refreshAll = () => {
    setSelectedIds([]);
    invalidate({ resource: 'employees', invalidates: ['list'] });
    refetch();
  };

  // ປະຫວັດການແກ້ໄຂ: every press of ຍ້າຍ below is one round, opened before
  // anyone is moved and passed along with each move — the server only takes a
  // department/position/shift move that belongs to one (routes/bulkEdits.js) —
  // then closed with who didn't go through and why.
  const [historyOpen, setHistoryOpen] = useState(false);
  const startRound = async (action: BulkEditAction, target: string, ids: string[], effectiveDate?: string) => {
    try {
      const { data } = await axiosInstance.post<BulkEditRound>(`${API_URL}/bulk-edits`, { action, target, employees: ids, effectiveDate });
      return data._id;
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ເລີ່ມບັນທຶກປະຫວັດບໍ່ໄດ້ — ຍັງບໍ່ໄດ້ຍ້າຍໃຜ' });
      return null;
    }
  };
  type RoundResult = { employee: string; status: 'ok' | 'failed' | 'skipped'; message?: string };
  const reasonOf = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason as any)?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ' : undefined;
  const resultsOf = (ids: string[], settled: PromiseSettledResult<unknown>[]): RoundResult[] =>
    ids.map((id, i) => (settled[i].status === 'fulfilled' ? { employee: id, status: 'ok' } : { employee: id, status: 'failed', message: reasonOf(settled[i]) }));
  const finishRound = (roundId: string, results: RoundResult[]) =>
    axiosInstance.post(`${API_URL}/bulk-edits/${roundId}/finish`, { results }).catch(() => undefined);

  // ---- 1. ຍ້າຍພະແນກ ----
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [moveDepartment, setMoveDepartment] = useState<string>();
  const [movingDept, setMovingDept] = useState(false);

  const submitMoveDepartment = async () => {
    if (!moveDepartment || !selectedIds.length) return;
    const target = allDepartments.find((d) => d._id === moveDepartment);
    setMovingDept(true);
    const ids = [...selectedIds];
    const roundId = await startRound('department', moveDepartment, ids);
    if (!roundId) {
      setMovingDept(false);
      return;
    }
    const results = await Promise.allSettled(
      ids.map((id) => {
        const emp = employees.find((e) => e._id === id);
        const positionStillValid =
          emp?.position &&
          allPositions.find((p) => p._id === idOf(emp.position))?.departments?.some((d) => idOf(d) === moveDepartment);
        return axiosInstance.patch(`${API_URL}/employees/${id}`, {
          department: moveDepartment,
          supervisor: target?.head ? idOf(target.head) : null,
          ...(positionStillValid ? {} : { position: null, positionHead: null }),
          bulkEditRound: roundId,
        });
      })
    );
    await finishRound(roundId, resultsOf(ids, results));
    setMovingDept(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ຍ້າຍພະແນກສຳເລັດ ${results.length - failCount}/${results.length} ຄົນ`,
    });
    setDeptModalOpen(false);
    setMoveDepartment(undefined);
    refreshAll();
  };

  // ---- 2. ຍ້າຍຕຳແໜ່ງ ----
  const [positionModalOpen, setPositionModalOpen] = useState(false);
  const [movePosition, setMovePosition] = useState<string>();
  const [movingPosition, setMovingPosition] = useState(false);

  // Their absences already on file keep the tier they were recorded with —
  // ask (only if any this month would change) whether the new position's
  // rules should apply to them too; keeping the old tiers is the default.
  const { prompt: askAbsenceSeverity, modal: absenceSeverityModal } = useAbsenceSeverityPrompt();

  const submitMovePosition = async () => {
    if (!movePosition || !selectedIds.length) return;
    const target = allPositions.find((p) => p._id === movePosition);
    setMovingPosition(true);
    const ids = [...selectedIds];
    const roundId = await startRound('position', movePosition, ids);
    if (!roundId) {
      setMovingPosition(false);
      return;
    }
    const results = await Promise.allSettled(
      ids.map((id) =>
        axiosInstance.patch(`${API_URL}/employees/${id}`, {
          position: movePosition,
          positionHead: target?.head ? idOf(target.head) : null,
          bulkEditRound: roundId,
        })
      )
    );
    await finishRound(roundId, resultsOf(ids, results));
    setMovingPosition(false);
    const failCount = results.filter((r) => r.status === 'rejected').length;
    notify?.({
      type: failCount ? 'error' : 'success',
      message: `ຍ້າຍຕຳແໜ່ງສຳເລັດ ${results.length - failCount}/${results.length} ຄົນ`,
    });
    setPositionModalOpen(false);
    setMovePosition(undefined);
    refreshAll();
    const moved = ids.filter((_, i) => results[i].status === 'fulfilled');
    if (moved.length) {
      askAbsenceSeverity(
        { employees: moved },
        { applyByDefault: false, reason: `ຍ້າຍ ${moved.length} ຄົນໄປຕຳແໜ່ງ "${target?.name ?? ''}" ແລ້ວ` }
      );
    }
  };

  // ---- 3. ຍ້າຍກະ (ປ່ຽນກະປະຈຳ) ----
  // The same ຍ້າຍກະລ່ວງໜ້າ as ຕັ້ງຄ່າແຜນວຽກ, once for each person picked: from
  // the start date their regular shift is the new one, and the days before
  // keep the shift they had. Until that date it waits, shown under their time.
  const [modal, modalContext] = Modal.useModal();
  const { data: shiftChangesData, refetch: refetchShiftChanges } = useCustom<ScheduledShiftChange[]>({
    url: `${API_URL}/scheduled-shift-changes`,
    method: 'get',
    config: { query: { status: 'pending' } },
    errorNotification: false,
  });
  const waitingByEmployee = useMemo(() => {
    const map: Record<string, ScheduledShiftChange[]> = {};
    for (const c of shiftChangesData?.data ?? []) {
      if (c.status !== 'pending') continue;
      const id = idOf(c.employee);
      if (id) (map[id] ??= []).push(c);
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return map;
  }, [shiftChangesData?.data]);

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [moveCategory, setMoveCategory] = useState<string>();
  const [moveDate, setMoveDate] = useState<Dayjs | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [movingShift, setMovingShift] = useState(false);

  const openMoveShift = () => {
    setMoveCategory(undefined);
    setMoveDate(dayjs().add(1, 'day'));
    setCreatingCategory(false);
    setShiftModalOpen(true);
  };

  const personLabel = (id: string) => {
    const e = employees.find((x) => x._id === id);
    return e ? `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.replace(/\s+/g, ' ').trim() : id;
  };

  const submitMoveShift = async () => {
    if (!selectedIds.length || !moveCategory || !moveDate) return;
    const effectiveDate = moveDate.format('YYYY-MM-DD');
    // Already on that shift with nothing else waiting: there's nothing to move.
    const alreadyOn = selectedIds.filter((id) => {
      const emp = employees.find((e) => e._id === id);
      return !!emp && idOf(emp.defaultShiftCategory) === moveCategory && !waitingByEmployee[id]?.length;
    });
    const toMove = selectedIds.filter((id) => !alreadyOn.includes(id));
    setMovingShift(true);
    const roundId = await startRound('shift', moveCategory, [...selectedIds], effectiveDate);
    if (!roundId) {
      setMovingShift(false);
      return;
    }
    const results = await Promise.allSettled(toMove.map((id) => scheduleShiftChange(id, moveCategory, effectiveDate, roundId)));
    await finishRound(roundId, [
      ...resultsOf(toMove, results),
      ...alreadyOn.map((id): RoundResult => ({ employee: id, status: 'skipped', message: 'ຢູ່ກະນີ້ແລ້ວ' })),
    ]);
    setMovingShift(false);

    const failedBy = new Map<string, string[]>();
    const failedIds: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') return;
      const reason = (r.reason as any)?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ';
      failedBy.set(reason, [...(failedBy.get(reason) ?? []), personLabel(toMove[i])]);
      failedIds.push(toMove[i]);
    });
    const moved = toMove.length - failedIds.length;
    const skippedNote = alreadyOn.length ? ` (${alreadyOn.length} ຄົນຢູ່ກະນີ້ແລ້ວ)` : '';
    if (moved || !failedIds.length) {
      notify?.({
        type: 'success',
        message: moved
          ? `ຕັ້ງການຍ້າຍກະລ່ວງໜ້າແລ້ວ ${moved}/${selectedIds.length} ຄົນ — ມີຜົນວັນທີ ${moveDate.format('DD/MM/YYYY')}${skippedNote}`
          : 'ທຸກຄົນທີ່ເລືອກຢູ່ກະນີ້ແລ້ວ',
      });
    }
    if (failedIds.length) {
      modal.warning({
        title: `ຍ້າຍກະບໍ່ໄດ້ ${failedIds.length} ຄົນ — ວັນທີ ${moveDate.format('DD/MM/YYYY')}`,
        width: 560,
        content: (
          <div className="move-shift-failures">
            {[...failedBy].map(([reason, names]) => (
              <div key={reason} style={{ marginBottom: 8 }}>
                <Typography.Text strong>{reason}</Typography.Text>
                <div>{names.join(', ')}</div>
              </div>
            ))}
            <Typography.Text type="secondary">ຍັງເລືອກຄົນເຫຼົ່ານີ້ໄວ້ — ລອງວັນອື່ນໄດ້</Typography.Text>
          </div>
        ),
      });
    }
    setShiftModalOpen(false);
    setSelectedIds(failedIds);
    invalidate({ resource: 'employees', invalidates: ['list'] });
    invalidate({ resource: 'shifts', invalidates: ['list'] });
    refetch();
    refetchShiftChanges();
  };

  const cancelShiftChange = async (id: string) => {
    try {
      await cancelScheduledShiftChange(id);
      notify?.({ type: 'success', message: 'ຍົກເລີກການຍ້າຍກະລ່ວງໜ້າແລ້ວ' });
      invalidate({ resource: 'shifts', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    }
    refetchShiftChanges();
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ແກ້ໄຂກະແບບກຸ່ມ"
      breadcrumb={false}
      headerButtons={
        <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
          ປະຫວັດການແກ້ໄຂ
        </Button>
      }
    >
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(v) => setSearch(v)}
          />
          <Select
            {...departmentSelect}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 180 }}
            value={departmentFilter}
            onChange={(v: any) => {
              setDepartmentFilter(v);
              const stillValid =
                !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some((d) => idOf(d) === v);
              if (!stillValid) setPositionFilter(undefined);
            }}
          />
          <Select
            {...positionSelect}
            options={positionOptionsForFilter}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            style={{ width: 180 }}
            value={positionFilter}
            onChange={(v: any) => setPositionFilter(v)}
          />
        </Space>

        <Space wrap style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {selectedIds.length ? `ເລືອກແລ້ວ ${selectedIds.length} ຄົນ` : 'ຕິກເລືອກພະນັກງານໃນຕາຕະລາງ ເພື່ອຈັດການແບບກຸ່ມ'}
          </Typography.Text>
          <Button icon={<ApartmentOutlined />} disabled={!selectedIds.length} onClick={() => setDeptModalOpen(true)}>
            ຍ້າຍພະແນກ
          </Button>
          <Button icon={<IdcardOutlined />} disabled={!selectedIds.length} onClick={() => setPositionModalOpen(true)}>
            ຍ້າຍຕຳແໜ່ງ
          </Button>
          <Button icon={<ClockCircleOutlined />} disabled={!selectedIds.length} onClick={openMoveShift}>
            ຍ້າຍກະ (ປ່ຽນກະປະຈຳ)
          </Button>
        </Space>
      </div>

      <Table
        rowKey="_id"
        dataSource={employees}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
      >
        <Table.Column title="ລະຫັດພະນັກງານ" dataIndex="employeeCode" width={110} />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          width={180}
          render={(_, record: Employee) => `${record.firstName ?? ''} ${record.lastName ?? ''}`}
        />
        <Table.Column
          title="ພະແນກ"
          width={140}
          render={(_, record: Employee) => (typeof record.department === 'object' ? record.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, record: Employee) => (typeof record.position === 'object' ? record.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ໂມງເຂົ້າວຽກ"
          width={200}
          render={(_, record: Employee) => {
            const t = resolveDefaultShiftTime(record);
            const waiting = waitingByEmployee[record._id] ?? [];
            return (
              <>
                <div>{t ? `${t.start} - ${t.end}` : '-'}</div>
                {waiting.map((c) => (
                  <Popconfirm
                    key={c._id}
                    title="ຍົກເລີກການຍ້າຍກະລ່ວງໜ້ານີ້?"
                    description="ວັນທີ່ນີ້ຈະເລີກເປັນຈຸດເລີ່ມຕົ້ນຂອງກະໃໝ່ ແລະ ກະເກົ່າຈະກັບມາເໝືອນເດີມ"
                    okText="ຍົກເລີກ"
                    cancelText="ບໍ່"
                    onConfirm={() => cancelShiftChange(c._id)}
                  >
                    <Tag color="blue" className="waiting-shift-change" style={{ cursor: 'pointer', marginTop: 4 }} title="ກົດເພື່ອຍົກເລີກ">
                      ຈາກ {dayjs(c.effectiveDate).format('DD/MM')} → {shiftCategoryLabel(c.newShiftCategory)}
                    </Tag>
                  </Popconfirm>
                ))}
              </>
            );
          }}
        />
        <Table.Column
          title="ວັນພັກປະຈຳ"
          width={110}
          render={(_, record: Employee) =>
            record.defaultRestDay?.length
              ? record.defaultRestDay.map((d) => WEEKDAY_OPTIONS.find((w) => w.value === d)?.label ?? '-').join(', ')
              : '-'
          }
        />
      </Table>

      <Modal
        title={`ຍ້າຍພະແນກ — ${selectedIds.length} ຄົນ`}
        open={deptModalOpen}
        onCancel={() => setDeptModalOpen(false)}
        onOk={submitMoveDepartment}
        confirmLoading={movingDept}
        okText="ຍ້າຍ"
        okButtonProps={{ disabled: !moveDepartment }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຫົວໜ້າງານ (ຫົວໜ້າພະແນກ) ຈະຖືກປັບໃຫ້ຕົງກັບພະແນກໃໝ່ອັດຕະໂນມັດ — ຖ້າຕຳແໜ່ງເດີມບໍ່ຂຶ້ນກັບພະແນກໃໝ່ ຈະຖືກລ້າງອອກ (ໄປຕັ້ງໃໝ່ໄດ້ຈາກ "ຍ້າຍຕຳແໜ່ງ")
        </Typography.Paragraph>
        <Select
          {...departmentSelect}
          placeholder="ພະແນກໃໝ່"
          style={{ width: '100%' }}
          value={moveDepartment}
          onChange={(v: any) => setMoveDepartment(v)}
        />
      </Modal>

      <Modal
        title={`ຍ້າຍຕຳແໜ່ງ — ${selectedIds.length} ຄົນ`}
        open={positionModalOpen}
        onCancel={() => setPositionModalOpen(false)}
        onOk={submitMovePosition}
        confirmLoading={movingPosition}
        okText="ຍ້າຍ"
        okButtonProps={{ disabled: !movePosition }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">ຫົວໜ້າຕຳແໜ່ງ ຈະຖືກປັບໃຫ້ຕົງກັບຕຳແໜ່ງໃໝ່ອັດຕະໂນມັດ</Typography.Paragraph>
        <Select
          {...positionSelect}
          placeholder="ຕຳແໜ່ງໃໝ່"
          style={{ width: '100%' }}
          value={movePosition}
          onChange={(v: any) => setMovePosition(v)}
        />
      </Modal>

      <Modal
        title={`ຍ້າຍກະ — ${selectedIds.length} ຄົນ`}
        open={shiftModalOpen}
        onCancel={() => setShiftModalOpen(false)}
        onOk={submitMoveShift}
        confirmLoading={movingShift}
        okText="ຢືນຢັນຍ້າຍກະລ່ວງໜ້າ"
        okButtonProps={{ disabled: creatingCategory || !moveCategory || !moveDate }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>
            ຍ້າຍກະລ່ວງໜ້າໃຫ້ {selectedIds.length} ຄົນທີ່ເລືອກ — ມີຜົນນັບແຕ່ວັນທີ່ເລືອກລຸ່ມນີ້ເປັນຕົ້ນໄປ
          </Typography.Text>
          <Typography.Text type="secondary">
            ແບບດຽວກັບ "ຍ້າຍກະລ່ວງໜ້າ" ໃນໜ້າ ຕັ້ງຄ່າແຜນວຽກ: ມື້ກ່ອນວັນທີ່ເລືອກຍັງໃຊ້ກະເກົ່າ, ຍົກເລີກໄດ້ກ່ອນເຖິງວັນ
          </Typography.Text>
          <ShiftChangeFields
            date={moveDate}
            onDateChange={setMoveDate}
            category={moveCategory}
            onCategoryChange={setMoveCategory}
            onCreatingChange={setCreatingCategory}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
          />
        </Space>
      </Modal>
      {modalContext}
      {absenceSeverityModal}
      <BulkEditHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </List>
  );
};
