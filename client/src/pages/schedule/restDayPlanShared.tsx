import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useCustom, useInvalidate, useNotification, useWarnAboutChange } from '@refinedev/core';
import { Alert, Button, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Employee, RestDayPlanPreview, RestDayPlanResult, RestDayPlanRow, RestDayScheduleRow } from '../../types';
import { API_URL, axiosInstance } from '../../providers/axios';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { groupRestRowsByEmployee, restDaysOn } from '../../utils/restDays';

// ວາງແຜນວັນພັກ's planning pieces (used by covers.tsx in planner mode): what's set
// around the plan's Monday, the picks not saved yet, and checking then saving
// them (routes/restDayHistory.js planMany).

export const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

// Monday first, the way the week is counted for rest days.
export const restDaysLabel = (days: number[] | undefined) =>
  days?.length
    ? [...days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_OPTIONS[d].label)
        .join(', ')
    : 'ບໍ່ມີ';

const ACTION_TAG: Record<Exclude<RestDayPlanRow['action'], 'none'>, { color: string; label: string }> = {
  change: { color: 'blue', label: 'ປ່ຽນ' },
  replace: { color: 'blue', label: 'ແທນແຜນເດີມ' },
  cancel: { color: 'orange', label: 'ຍົກເລີກແຜນເດີມ' },
};

const personLabel = (row: RestDayPlanRow) => `${row.employeeCode ?? ''} ${row.name ?? ''}`.trim();

export type RestDayPlanChange = { employee: string; restDays: number[] };

// Each person's rest days around the plan's Monday: what applies the day before
// it, and any change already waiting on it. Fetches nothing while `start` is null.
export function useRestDayPlanSchedule(start: string | null) {
  const dayBefore = start ? dayjs(start).subtract(1, 'day').format('YYYY-MM-DD') : '';
  const { data, isLoading, refetch } = useCustom<RestDayScheduleRow[]>({
    url: `${API_URL}/rest-day-history/schedule`,
    method: 'get',
    config: { query: { from: dayBefore, to: start } },
    queryOptions: { enabled: !!start },
  });
  const rowsByEmployee = useMemo(() => groupRestRowsByEmployee(data?.data), [data?.data]);
  const beforeOf = (emp: Employee) => restDaysOn(rowsByEmployee.get(emp._id), emp.defaultRestDay, dayBefore);
  const waitingOf = (emp: Employee) =>
    (rowsByEmployee.get(emp._id) ?? [])
      .filter((r) => r.effectiveDate === start)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .pop();
  const plannedOf = (emp: Employee) => waitingOf(emp)?.newRestDay ?? beforeOf(emp);
  return { rowsByEmployee, isLoading, refetch, beforeOf, waitingOf, plannedOf };
}

// Checks a plan with the server, shows what saving it would do, and saves it
// on confirmation. Render `reviewModal` somewhere on the page.
export function useRestDayPlanReview(start: string, onSaved: () => void) {
  const [changes, setChanges] = useState<RestDayPlanChange[]>([]);
  const [review, setReview] = useState<RestDayPlanPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const { open: notify } = useNotification();
  const invalidate = useInvalidate();

  const checkPlan = async (planChanges: RestDayPlanChange[]) => {
    setChanges(planChanges);
    setChecking(true);
    try {
      const { data } = await axiosInstance.post<RestDayPlanPreview>(`${API_URL}/rest-day-history/bulk/preview`, {
        effectiveDate: start,
        changes: planChanges,
      });
      setReview(data);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ກວດແຜນວັນພັກບໍ່ສຳເລັດ' });
    } finally {
      setChecking(false);
    }
  };

  const savePlan = async () => {
    setSaving(true);
    try {
      const { data } = await axiosInstance.post<RestDayPlanResult>(`${API_URL}/rest-day-history/bulk`, { effectiveDate: start, changes });
      notify?.({
        type: 'success',
        message: [
          `ບັນທຶກແຜນວັນພັກແລ້ວ — ມີຜົນແຕ່ ${dayjs(data.effectiveDate).format('DD/MM/YYYY')}`,
          `ປ່ຽນ ${data.changed} ຄົນ`,
          data.cancelled ? `ຍົກເລີກແຜນເດີມ ${data.cancelled} ຄົນ` : '',
          data.leavesRecalculated ? `ຄິດໃບລາໃໝ່ ${data.leavesRecalculated} ໃບ` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      });
      setReview(null);
      invalidate({ resource: 'rest-day-history', invalidates: ['list'] });
      invalidate({ resource: 'leaves', invalidates: ['list'] });
      onSaved();
    } catch (err: any) {
      const errors = err?.response?.data?.errors as RestDayPlanRow[] | undefined;
      if (errors?.length) setReview((r) => (r ? { ...r, errors } : r));
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSaving(false);
    }
  };

  const reviewRows = review?.rows.filter((r) => r.action !== 'none') ?? [];
  const redirected = reviewRows.filter((r) => r.redirected);
  const withConflicts = reviewRows.filter((r) => r.conflicts?.length);
  const leavesToRecalculate = reviewRows.reduce((sum, r) => sum + (r.leavesAffected ?? 0), 0);
  const cancelCount = reviewRows.filter((r) => r.action === 'cancel').length;

  const reviewModal = (
    <Modal
      title={`ກວດແຜນວັນພັກ — ມີຜົນແຕ່ ${dayjs(start).format('dddd DD/MM/YYYY')}`}
      open={!!review}
      width={760}
      onCancel={() => setReview(null)}
      onOk={savePlan}
      confirmLoading={saving}
      okText="ບັນທຶກ"
      cancelText="ກັບໄປແກ້"
      okButtonProps={{ disabled: !!review?.errors.length || !reviewRows.length }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text>
          {[
            `ຈະປ່ຽນ ${reviewRows.length - cancelCount} ຄົນ`,
            cancelCount ? `ຍົກເລີກແຜນເດີມ ${cancelCount} ຄົນ` : '',
            leavesToRecalculate ? `ໃບລາຈະຖືກຄິດມື້ລາໃໝ່ ${leavesToRecalculate} ໃບ` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography.Text>
        {!!review?.errors.length && (
          <Alert
            type="error"
            showIcon
            message="ບັນທຶກບໍ່ໄດ້ — ແກ້ແຖວເຫຼົ່ານີ້ກ່ອນ (ຍັງບໍ່ໄດ້ບັນທຶກຫຍັງ)"
            description={review.errors.map((r) => (
              <div key={r.employee}>
                {personLabel(r)}: {r.error}
              </div>
            ))}
          />
        )}
        {redirected.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="ຕຳແໜ່ງຫ້າມພັກບາງວັນທີ່ເລືອກ — ຈະບັນທຶກເປັນວັນສຳຮອງຂອງຕຳແໜ່ງ"
            description={redirected.map((r) => (
              <div key={r.employee}>
                {personLabel(r)}: {restDaysLabel(r.restDays)}
              </div>
            ))}
          />
        )}
        {withConflicts.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="ມີຄິວເຮັດວຽກຈັດໄວ້ໃນວັນພັກໃໝ່ — ຈະບໍ່ໄດ້ພັກມື້ນັ້ນຈົນກວ່າຈະລຶບຄິວອອກ"
            description={withConflicts.map((r) => (
              <div key={r.employee}>
                {personLabel(r)}: {r.conflicts!.map((c) => dayjs(c.date).format('DD/MM')).join(', ')}
              </div>
            ))}
          />
        )}
        <Table dataSource={reviewRows} rowKey="employee" size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }}>
          <Table.Column title="ລະຫັດ" dataIndex="employeeCode" width={80} />
          <Table.Column title="ຊື່" dataIndex="name" />
          <Table.Column title="ກ່ອນ" width={120} render={(_, r: RestDayPlanRow) => restDaysLabel(r.before)} />
          <Table.Column title="ແຕ່ວັນຈັນນັ້ນ" width={120} render={(_, r: RestDayPlanRow) => <Typography.Text strong>{restDaysLabel(r.restDays)}</Typography.Text>} />
          <Table.Column
            title=""
            width={130}
            render={(_, r: RestDayPlanRow) => (r.action !== 'none' ? <Tag color={ACTION_TAG[r.action].color}>{ACTION_TAG[r.action].label}</Tag> : null)}
          />
        </Table>
      </Space>
    </Modal>
  );

  return { checkPlan, checking, reviewModal };
}

// The Monday being planned from and the rest days picked, not saved yet. Lives
// outside the page's state so a click redraws that person's row, and starting
// to plan redraws no cell at all, instead of every cell in the table.
export function createPlanDraft() {
  let monday: string | null = null;
  let edits: Record<string, number[]> = {};
  const everyone = new Set<() => void>();
  const byEmployee = new Map<string, Set<() => void>>();
  const emit = (employeeId?: string) => {
    everyone.forEach((listener) => listener());
    if (employeeId) byEmployee.get(employeeId)?.forEach((listener) => listener());
    else byEmployee.forEach((listeners) => listeners.forEach((listener) => listener()));
  };
  // New arrays, so the rows with picks draw again and no others.
  const refresh = () => {
    edits = Object.fromEntries(Object.entries(edits).map(([employeeId, days]) => [employeeId, [...days]]));
    emit();
  };
  return {
    monday: () => monday,
    setMonday(next: string | null) {
      monday = next;
      refresh();
    },
    refresh,
    all: () => edits,
    get: (employeeId: string): number[] | undefined => edits[employeeId],
    set(employeeId: string, days: number[] | undefined) {
      const next = { ...edits };
      if (days) next[employeeId] = days;
      else delete next[employeeId];
      edits = next;
      emit(employeeId);
    },
    clear() {
      edits = {};
      emit();
    },
    subscribeAll(listener: () => void) {
      everyone.add(listener);
      return () => {
        everyone.delete(listener);
      };
    },
    subscribe(employeeId: string, listener: () => void) {
      const listeners = byEmployee.get(employeeId) ?? new Set<() => void>();
      byEmployee.set(employeeId, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type PlanDraft = ReturnType<typeof createPlanDraft>;

// A day that follows what's picked for this person. Wraps every day, planning or
// not: swapping it in only on starting to plan rebuilt thousands of cells at once.
export const PlannedCell: React.FC<{ draft: PlanDraft; employeeId: string; render: (picked: number[] | undefined) => React.ReactNode }> = ({
  draft,
  employeeId,
  render,
}) => {
  const subscribe = useCallback((listener: () => void) => draft.subscribe(employeeId, listener), [draft, employeeId]);
  const picked = useSyncExternalStore(subscribe, () => draft.get(employeeId));
  return <>{render(picked)}</>;
};

// The save bar of ວາງແຜນວັນພັກ (covers.tsx, planner mode): from the week's Monday,
// how many people so far, and the way on to the check and save below.
export const RestDayPlanBar: React.FC<{
  draft: PlanDraft;
  start: string;
  employeeById: Map<string, Employee>;
  plannedOf: (emp: Employee) => number[];
  ready: boolean;
  onSaved: () => void;
  onExit?: () => void;
}> = ({ draft, start, employeeById, plannedOf, ready, onSaved, onExit }) => {
  // Here, not on the page: the dialog's state then doesn't redraw the whole table.
  const { checkPlan, checking, reviewModal } = useRestDayPlanReview(start, onSaved);
  const edits = useSyncExternalStore(
    useCallback((listener: () => void) => draft.subscribeAll(listener), [draft]),
    draft.all
  );
  const changes = ready
    ? Object.entries(edits).flatMap(([employee, restDays]) => {
        const emp = employeeById.get(employee);
        return emp && !sameDays(restDays, plannedOf(emp)) ? [{ employee, restDays }] : [];
      })
    : [];
  const { setWarnWhen } = useWarnAboutChange();
  useEffect(() => {
    setWarnWhen(changes.length > 0);
    return () => setWarnWhen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes.length]);

  // Nothing picked yet: no bar (on a phone it would hide a good part of the table).
  if (!Object.keys(edits).length && !checking) return reviewModal;

  return (
    // Floats over the page: the save stays in reach however far down the list you
    // are, and nothing moves, which would make the table lay itself out again.
    <div
      className="rest-plan-bar"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        width: 'max-content',
        maxWidth: 'calc(100vw - 32px)',
        padding: '8px 12px',
        background: '#e6f4ff',
        border: '1px solid #91caff',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
      }}
    >
      <Space wrap>
        <Typography.Text strong>ຍ້າຍວັນພັກ — ມີຜົນແຕ່ {dayjs(start).format('dddd DD/MM/YYYY')}</Typography.Text>
        <Button disabled={!Object.keys(edits).length} onClick={() => draft.clear()}>
          ລ້າງການແກ້ໄຂ
        </Button>
        <Button type="primary" disabled={!changes.length} loading={checking} onClick={() => checkPlan(changes)}>
          ກວດ ແລະ ບັນທຶກ ({changes.length} ຄົນ)
        </Button>
        {onExit && (
          <Popconfirm title={`ຖິ້ມການແກ້ໄຂ ${changes.length} ຄົນ?`} okText="ຖິ້ມ" cancelText="ບໍ່" disabled={!changes.length} onConfirm={onExit}>
            <Button onClick={() => !changes.length && onExit()}>ອອກ</Button>
          </Popconfirm>
        )}
      </Space>
      <div style={{ marginTop: 6, fontSize: 12, color: '#595959' }}>
        ກົດຊ່ອງວັນ: ຍ້າຍວັນພັກໄປວັນນັ້ນ · ກົດ Ctrl ຄ້າງໄວ້: ເພີ່ມອີກວັນ · ກົດວັນພັກອີກເທື່ອ: ເອົາອອກ — ຍັງບໍ່ບັນທຶກຈົນກວ່າຈະກົດ ກວດ ແລະ ບັນທຶກ
      </div>
      {reviewModal}
    </div>
  );
};
