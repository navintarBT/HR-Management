import { useEffect, useMemo, useRef, useState } from 'react';
import { useInvalidate, useNotification } from '@refinedev/core';
import { Button, Modal, Popconfirm, Select, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Employee, RestDayChangePlan, RestDayHistory } from '../../types';
import { API_URL, axiosInstance } from '../../providers/axios';
import { WEEKDAY_OPTIONS } from '../../utils/weekdays';
import { upcomingMondays, mondayOptionLabel, effectiveRestrictedRestDays, REST_DAY_FROM_THE_START } from '../../utils/restDays';

// How many changes already in effect the dialog lists, latest first.
const PAST_SHOWN = 5;

// A row from before effective dates existed took effect the day it was made
// (as on ປະຫວັດປ່ຽນວັນພັກ).
const effectiveDateOf = (r: RestDayHistory) => r.effectiveDate ?? dayjs(r.createdAt).format('YYYY-MM-DD');

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

// Monday first, the way the week is counted for rest days.
const restDaysLabel = (days: number[]) =>
  days.length
    ? [...days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_OPTIONS[d].label)
        .join(', ')
    : 'ບໍ່ມີວັນພັກປະຈຳ';

// ຕັ້ງວັນພັກປະຈຳອາທິດ for one person (moved from ຕັ້ງຄ່າແຜນວຽກ to ວາງແຜນວັນພັກ
// on 15/11/2026, with all of moving rest days). Open with `employee`;
// `onSaved` refreshes what the page shows (with the date a saved change starts).
export const RecurringRestDialog: React.FC<{ employee: Employee | null; onClose: () => void; onSaved: (effectiveDate?: string) => void }> = ({
  employee,
  onClose,
  onSaved,
}) => {
  const recurringRestFor = employee;
  const setRecurringRestFor = (next: Employee | null) => {
    if (!next) onClose();
  };
  const todayKey = dayjs().format('YYYY-MM-DD');
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  // A recurring weekly rest day — set once here and it applies to every
  // matching weekday automatically, with no per-day clicking and no Shift
  // rows. A change starts on a coming Monday only (next Monday unless another
  // is picked), for everyone, so every week rests on one pattern; days up to
  // today are history — listed, never changed (agreed 15/11/2026). The server
  // checks that (restDaySchedule.js startOfChange), and the dialog shows what
  // saving does, with any change still waiting to take effect, beforehand.
  // Changes not in effect yet, earliest first; null while loading.
  const [waitingRestChanges, setWaitingRestChanges] = useState<RestDayChangePlan['pending'] | null>(null);
  // Changes already in effect, latest first — only to look at.
  const [pastRestChanges, setPastRestChanges] = useState<RestDayHistory[]>([]);
  // The Monday it starts (YYYY-MM-DD); null until loaded.
  const [restStart, setRestStart] = useState<string | null>(null);
  // The days picked in the dialog; null until the waiting changes are in.
  const [recurringRestDay, setRecurringRestDay] = useState<number[] | null>(null);
  // Once days are picked by hand, moving the start date keeps them.
  const [restDaysTouched, setRestDaysTouched] = useState(false);
  const [restPlan, setRestPlan] = useState<{ days: number[]; start: string; plan?: RestDayChangePlan; error?: string } | null>(null);
  const [restReload, setRestReload] = useState(0);
  const [savingRestDay, setSavingRestDay] = useState(false);

  // What's set for the start date picked: the waiting change on or before it,
  // else what applies today. The picker starts there, so nothing changes until
  // a day is actually picked.
  const restDaysSetFor = (start: string | null, waiting = waitingRestChanges) => {
    const from = start ?? todayKey;
    const inForce = (waiting ?? []).filter((c) => c.effectiveDate <= from);
    return inForce.length ? inForce[inForce.length - 1].newRestDay : recurringRestFor?.defaultRestDay ?? [];
  };
  const plannedRestDays = useMemo(() => restDaysSetFor(restStart), [recurringRestFor, waitingRestChanges, restStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whose dialog the last load was for — a reload after cancelling a waiting
  // change keeps the date picked; opening the dialog starts afresh.
  const restLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recurringRestFor) {
      restLoadedFor.current = null;
      return;
    }
    let stale = false;
    setWaitingRestChanges(null);
    setPastRestChanges([]);
    setRecurringRestDay(null);
    setRestPlan(null);
    axiosInstance
      .get<RestDayHistory[]>(`${API_URL}/rest-day-history`, {
        params: { employee: recurringRestFor._id, _sort: 'effectiveDate', _order: 'desc', _start: 0, _end: 30 },
      })
      .then(({ data }) => {
        if (!stale) setPastRestChanges(data.filter((r) => effectiveDateOf(r) <= todayKey).slice(0, PAST_SHOWN));
      })
      .catch(() => undefined);
    // What's waiting doesn't depend on the days asked about, and asking about
    // none can't trip over the position's ຂໍ້ຈຳກັດວັນພັກ.
    axiosInstance
      .post<RestDayChangePlan>(`${API_URL}/rest-day-history/preview`, { employee: recurringRestFor._id, restDays: [] })
      .then(({ data }) => {
        if (stale) return;
        const waiting = [...data.replaces, ...data.pending].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
        // Fresh, it starts next Monday — the soonest a change can.
        const reloading = restLoadedFor.current === recurringRestFor._id && restStart;
        restLoadedFor.current = recurringRestFor._id;
        const start = reloading ? restStart : data.defaultStart;
        setWaitingRestChanges(waiting);
        setRestStart(start);
        setRestDaysTouched(false);
        setRecurringRestDay(restDaysSetFor(start, waiting));
      })
      .catch((err) => {
        if (stale) return;
        setWaitingRestChanges([]);
        setRestStart(upcomingMondays(dayjs())[0].format('YYYY-MM-DD'));
        setRecurringRestDay(recurringRestFor.defaultRestDay ?? []);
        notify?.({ type: 'error', message: err?.response?.data?.message || 'ໂຫຼດການປ່ຽນວັນພັກບໍ່ສຳເລັດ' });
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringRestFor, restReload]);

  const pickRestStart = (start: string) => {
    setRestStart(start);
    if (!restDaysTouched) setRecurringRestDay(restDaysSetFor(start));
  };
  const pickRestDays = (days: number[]) => {
    setRestDaysTouched(true);
    setRecurringRestDay(days);
  };

  // What saving the picked days from the picked date would do, asked again
  // whenever either changes.
  useEffect(() => {
    if (!recurringRestFor || !recurringRestDay || !restStart || sameDays(recurringRestDay, plannedRestDays)) return;
    let stale = false;
    const days = recurringRestDay;
    const start = restStart;
    axiosInstance
      .post<RestDayChangePlan>(`${API_URL}/rest-day-history/preview`, {
        employee: recurringRestFor._id,
        restDays: days,
        effectiveDate: start,
      })
      .then(({ data }) => {
        if (!stale) setRestPlan({ days, start, plan: data });
      })
      .catch((err) => {
        if (!stale) setRestPlan({ days, start, error: err?.response?.data?.message || 'ກວດການປ່ຽນວັນພັກບໍ່ສຳເລັດ' });
      });
    return () => {
      stale = true;
    };
  }, [recurringRestFor, recurringRestDay, restStart, plannedRestDays]);

  const restDayChanged = !!recurringRestDay && !sameDays(recurringRestDay, plannedRestDays);
  // Only the answer for the days and date picked right now — an older one is
  // still on its way out while the next is asked.
  const currentRestPlan =
    restDayChanged && restPlan && restPlan.start === restStart && sameDays(restPlan.days, recurringRestDay!) ? restPlan : null;
  // A pick that lands on what's already in force that day only cancels the
  // waiting change(s) it replaces — with none, there's nothing to save.
  const canSaveRestDay = !!currentRestPlan?.plan && !(currentRestPlan.plan.unchanged && !currentRestPlan.plan.replaces.length);
  const shownRestPlan = currentRestPlan?.plan;
  const clearingRestDay = restDayChanged && recurringRestDay!.length === 0;

  const restStartOptions = useMemo(
    () => upcomingMondays(dayjs()).map((monday) => ({ value: monday.format('YYYY-MM-DD'), label: mondayOptionLabel(monday) })),
    []
  );

  const restrictedDaysForRecurring = effectiveRestrictedRestDays(recurringRestFor);
  const weekdayOptionsForRecurringRest = useMemo(
    () => WEEKDAY_OPTIONS.map((opt) => ({ ...opt, disabled: restrictedDaysForRecurring.includes(opt.value) })),
    [restrictedDaysForRecurring]
  );

  const afterRestDayChange = (effectiveDate?: string) => {
    onSaved(effectiveDate);
    invalidate({ resource: 'employees', invalidates: ['list'] });
    invalidate({ resource: 'leaves', invalidates: ['list'] });
  };

  // Queued shifts on a new rest day are listed in the dialog itself
  // (plan.conflicts), so saving needs no second confirm.
  const saveRecurringRest = async () => {
    if (!recurringRestFor || !recurringRestDay || !restStart || !canSaveRestDay) return;
    setSavingRestDay(true);
    try {
      const { data } = await axiosInstance.post<RestDayChangePlan>(`${API_URL}/rest-day-history`, {
        employee: recurringRestFor._id,
        restDays: recurringRestDay,
        effectiveDate: restStart,
      });
      notify?.({
        type: 'success',
        message: data.unchanged ? 'ຍົກເລີກການປ່ຽນທີ່ລໍຖ້າແລ້ວ' : `ບັນທຶກສຳເລັດ — ມີຜົນແຕ່ ${dayjs(data.effectiveDate).format('DD/MM/YYYY')}`,
      });
      setRecurringRestFor(null);
      afterRestDayChange(data.unchanged ? undefined : data.effectiveDate);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSavingRestDay(false);
    }
  };

  // Only a change that hasn't taken effect yet can be cancelled — one in
  // effect is changed by picking new days instead.
  const cancelWaitingRestChange = async (id: string) => {
    try {
      await axiosInstance.delete(`${API_URL}/rest-day-history/${id}`);
      notify?.({ type: 'success', message: 'ຍົກເລີກການປ່ຽນວັນພັກທີ່ລໍຖ້າແລ້ວ' });
      afterRestDayChange();
      setRestReload((n) => n + 1);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    }
  };


  return (
      <Modal
        title={recurringRestFor ? `ຕັ້ງວັນພັກປະຈຳອາທິດ — ${recurringRestFor.firstName} ${recurringRestFor.lastName}` : ''}
        open={!!recurringRestFor}
        onOk={saveRecurringRest}
        onCancel={() => setRecurringRestFor(null)}
        confirmLoading={savingRestDay}
        okText={clearingRestDay ? 'ຢືນຢັນຍົກເລີກວັນພັກປະຈຳ' : 'ບັນທຶກ'}
        okButtonProps={{ disabled: !canSaveRestDay, danger: clearingRestDay }}
        cancelText="ປິດ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ເລືອກວັນໃນອາທິດທີ່ຄົນນີ້ພັກປະຈຳ (ເລືອກໄດ້ຫຼາຍວັນ) — ລະບົບຈະຕັ້ງເປັນວັນພັກໃຫ້ທຸກວັນນັ້ນອັດຕະໂນມັດ ນັບແຕ່ວັນທີ່ມີຜົນເປັນຕົ້ນໄປ ໂດຍບໍ່ຕ້ອງກົດເລືອກທີລະວັນ — ມື້ທີ່ຜ່ານມາແລ້ວຍັງຄືເກົ່າ
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          ວັນພັກປະຈຸບັນ: <Typography.Text strong>{restDaysLabel(recurringRestFor?.defaultRestDay ?? [])}</Typography.Text>
        </Typography.Paragraph>
        {!!waitingRestChanges?.length && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f9f0ff', borderRadius: 6 }}>
            <Typography.Text strong>ລໍຖ້າມີຜົນ</Typography.Text>
            {waitingRestChanges.map((c) => (
              <div key={c._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                <span>
                  ແຕ່ {dayjs(c.effectiveDate).format('dddd DD/MM/YYYY')}: {restDaysLabel(c.newRestDay)}
                </span>
                <Popconfirm
                  title="ຍົກເລີກການປ່ຽນນີ້?"
                  okText="ຍົກເລີກການປ່ຽນ"
                  cancelText="ບໍ່"
                  onConfirm={() => cancelWaitingRestChange(c._id)}
                >
                  <Button size="small" type="link" danger>
                    ຍົກເລີກ
                  </Button>
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
        {pastRestChanges.length > 0 && (
          <div className="rest-past-changes" style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(0, 0, 0, 0.03)', borderRadius: 6 }}>
            <Typography.Text strong>ປະຫວັດ — ມີຜົນແລ້ວ (ເບິ່ງຢ່າງດຽວ)</Typography.Text>
            {pastRestChanges.map((r) => (
              <div key={r._id} style={{ marginTop: 4 }}>
                <Typography.Text type="secondary">
                  {effectiveDateOf(r) === REST_DAY_FROM_THE_START ? 'ຕັ້ງແຕ່ເລີ່ມຕົ້ນ' : `ແຕ່ ${dayjs(effectiveDateOf(r)).format('dddd DD/MM/YYYY')}`}:{' '}
                  {restDaysLabel(r.newRestDay ?? [])}
                </Typography.Text>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <Typography.Text>ເລີ່ມມີຜົນແຕ່</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            options={restStartOptions}
            loading={!restStart}
            disabled={!restStart}
            value={restStart ?? undefined}
            onChange={(v: string) => pickRestStart(v)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ເລີ່ມໄດ້ແຕ່ວັນຈັນລ່ວງໜ້າ — ແຕ່ລະອາທິດຈຶ່ງພັກຕາມແບບດຽວກັນທັງອາທິດ. ມື້ທີ່ຜ່ານມາແລ້ວແກ້ບໍ່ໄດ້ ເບິ່ງໄດ້ແຕ່ປະຫວັດ
          </Typography.Text>
        </div>
        <Typography.Text>ວັນພັກ</Typography.Text>
        <Select
          mode="multiple"
          style={{ width: '100%', marginTop: 4 }}
          options={weekdayOptionsForRecurringRest}
          placeholder="ບໍ່ມີວັນພັກປະຈຳ"
          loading={!recurringRestDay}
          disabled={!recurringRestDay}
          value={recurringRestDay ?? []}
          onChange={(v) => pickRestDays(v)}
        />
        {restrictedDaysForRecurring.length > 0 && (
          <Typography.Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
            ຕຳແໜ່ງນີ້ຫ້າມພັກ: {restrictedDaysForRecurring.map((d: number) => WEEKDAY_OPTIONS[d].label).join(', ')}
          </Typography.Paragraph>
        )}
        {restDayChanged && (
          <div style={{ marginTop: 12, padding: '8px 12px', border: '1px solid var(--app-border-color, #d9d9d9)', borderRadius: 6 }}>
            {!currentRestPlan && <Typography.Text type="secondary">ກຳລັງກວດ…</Typography.Text>}
            {currentRestPlan?.error && <Typography.Text type="danger">{currentRestPlan.error}</Typography.Text>}
            {shownRestPlan && (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {shownRestPlan.unchanged ? (
                  <Typography.Text type={shownRestPlan.replaces.length ? undefined : 'secondary'}>
                    {shownRestPlan.replaces.length
                      ? `ຈະຍົກເລີກການປ່ຽນທີ່ລໍຖ້າຢູ່ — ວັນພັກຍັງເປັນ ${restDaysLabel(shownRestPlan.restDays)} ຄືເກົ່າ`
                      : 'ບໍ່ມີຫຍັງປ່ຽນ — ວັນພັກເປັນແບບນີ້ຢູ່ແລ້ວ'}
                  </Typography.Text>
                ) : (
                  <>
                    <div>
                      {shownRestPlan.restDays.length ? `ພັກ ${restDaysLabel(shownRestPlan.restDays)}` : 'ຍົກເລີກວັນພັກປະຈຳ'} ມີຜົນແຕ່{' '}
                      <Typography.Text strong>{dayjs(shownRestPlan.effectiveDate).format('dddd DD/MM/YYYY')}</Typography.Text>
                    </div>
                    {shownRestPlan.redirected && (
                      <Typography.Text type="warning">
                        ຕຳແໜ່ງນີ້ຫ້າມພັກບາງວັນທີ່ເລືອກ — ຈະບັນທຶກເປັນ: {restDaysLabel(shownRestPlan.restDays)}
                      </Typography.Text>
                    )}
                    {shownRestPlan.replaces.length > 0 && (
                      <Typography.Text type="secondary">
                        ແທນການປ່ຽນທີ່ລໍຖ້າຢູ່:{' '}
                        {shownRestPlan.replaces
                          .map((r) => `${restDaysLabel(r.newRestDay)} ແຕ່ ${dayjs(r.effectiveDate).format('DD/MM/YYYY')}`)
                          .join('; ')}
                      </Typography.Text>
                    )}
                    {shownRestPlan.conflicts.length > 0 && (
                      <div>
                        <Typography.Text type="warning">ມື້ຕໍ່ໄປນີ້ມີຄິວເຮັດວຽກຈັດໄວ້ແລ້ວ ຈະບໍ່ໄດ້ພັກຈົນກວ່າຈະລຶບຄິວອອກ:</Typography.Text>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                          {shownRestPlan.conflicts.map((c) => (
                            <li key={c.date}>
                              {dayjs(c.date).format('dddd DD/MM/YYYY')}
                              {c.startTime && c.endTime ? ` (${c.startTime}-${c.endTime})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {clearingRestDay && (
                      <Typography.Text type="danger">ຫຼັງຈາກນັ້ນຈະບໍ່ມີວັນພັກປະຈຳອາທິດອີກ — ຕ້ອງໄປຕັ້ງວັນພັກເອງທີລະວັນຖ້າຕ້ອງການ</Typography.Text>
                    )}
                  </>
                )}
                {canSaveRestDay && shownRestPlan.leavesAffected > 0 && (
                  <Typography.Text type="secondary">ໃບລາ {shownRestPlan.leavesAffected} ໃບ ຈະຖືກຄິດມື້ລາໃໝ່ຕາມວັນພັກໃໝ່</Typography.Text>
                )}
              </Space>
            )}
          </div>
        )}
        {/* Clearing the picker by hand works too — this is the findable way,
            and either way saving asks again with a red button. */}
        {plannedRestDays.length > 0 && !!recurringRestDay?.length && (
          <Button danger style={{ marginTop: 12 }} onClick={() => pickRestDays([])}>
            ຍົກເລີກວັນພັກປະຈຳ
          </Button>
        )}
      </Modal>
  );
};
