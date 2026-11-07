import { useMemo, useState } from 'react';
import { useCustom, useInvalidate, useNotification } from '@refinedev/core';
import { Alert, Modal, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Employee, RestDayPlanPreview, RestDayPlanResult, RestDayPlanRow, RestDayScheduleRow } from '../../types';
import { API_URL, axiosInstance } from '../../providers/axios';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { groupRestRowsByEmployee, restDaysOn } from '../../utils/restDays';

// What ວາງແຜນວັນພັກ and the planning on ຕັ້ງຄ່າແຜນວຽກ have in common, so the two
// can't drift apart: what's set around the plan's Monday, and checking then
// saving it (routes/restDayHistory.js planMany).

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
