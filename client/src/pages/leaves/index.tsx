import { useEffect, useMemo, useState } from 'react';
import { useModalForm, useSelect } from '@refinedev/antd';
import { useGetIdentity, useDelete, useInvalidate, useNotification, useList } from '@refinedev/core';
import { Table, Button, Modal, Form, DatePicker, Input, Select, Space, Typography, Tag, Tooltip, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Employee, Identity, Leave } from '../../types';
import { LeaveStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { withLocalTextFilter } from '../../utils/selectFilters';

const { RangePicker } = DatePicker;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

function hasCompletedOneYear(hireDate?: string) {
  return !!hireDate && dayjs().diff(dayjs(hireDate), 'year') >= 1;
}

// Which tenure branch was actually FROZEN into this specific record's own
// ປ/x1 — not today's live status. A straddling leave is split into 2 records
// (see splitGroupId), each computed against a different tenure status for
// its own dates, so a live "today vs hireDate" check would (wrongly) show
// the same answer for both halves even though their numbers came from
// opposite branches. The two branches are distinguishable from the stored
// fields alone: the "completed" branch always sets deductDaysX2 to the full
// billableDays (so it's > 0 whenever billableDays is), while the "not yet"
// branch always sets it to exactly 0. When billableDays itself is 0, both
// branches produce the same (0, 0) pair — indistinguishable, but harmless
// since the deduction is 0 either way — so that one edge case falls back to
// today's live status just to show *something* plausible.
function wasCompletedOneYearForRecord(record: Leave, hireDate?: string) {
  if (!record.billableDays) return hasCompletedOneYear(hireDate);
  return (record.deductDaysX2 ?? 0) > 0;
}

// Spells out exactly which days of the request landed on a rest day and
// which kind — ວັນພັກປະຈຳ (the employee's own recurring/one-off rest day) or
// ວັນພັກຮ້ານ (a company-wide closure, named). Server-computed and frozen
// alongside billableDays, not derived here.
function formatRestDayOverlaps(overlaps?: Leave['restDayOverlaps']): string {
  if (!overlaps || overlaps.length === 0) return '';
  return overlaps
    .map((o) => {
      const label = o.type === 'holiday' ? `ວັນພັກຮ້ານ${o.holidayName ? ` (${o.holidayName})` : ''}` : 'ວັນພັກປະຈຳ';
      return `${dayjs(o.date).format('DD/MM')}: ${label}`;
    })
    .join(', ');
}

// Shared by both pages below: month nav + a code/name search — same shape as
// the OT summary/manage pages, so the two "ລາຍການ" pages behave the same way.
function useLeaveFilters() {
  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const [search, setSearch] = useState('');
  const monthKey = monthStart.format('YYYY-MM');

  const matchesEmployee = (emp?: Employee) => {
    if (!emp) return false;
    if (search) {
      const q = search.trim().toLowerCase();
      const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.toLowerCase();
      const code = (emp.employeeCode ?? '').toLowerCase();
      if (!name.includes(q) && !code.includes(q)) return false;
    }
    return true;
  };

  const toolbar = (
    <Space wrap>
      <Button icon={<LeftOutlined />} onClick={() => setMonthStart(monthStart.subtract(1, 'month'))} />
      <Button onClick={() => setMonthStart(dayjs().startOf('month'))}>ເດືອນນີ້</Button>
      <Button icon={<RightOutlined />} onClick={() => setMonthStart(monthStart.add(1, 'month'))} />
      <Typography.Text strong>{monthStart.format('MMMM YYYY')}</Typography.Text>
      <Input.Search
        placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
        allowClear
        style={{ width: 220 }}
        prefix={<SearchOutlined />}
        onSearch={(v) => setSearch(v)}
        onChange={(e) => !e.target.value && setSearch('')}
      />
    </Space>
  );

  return { monthStart, monthKey, toolbar, matchesEmployee };
}

// One row per employee — with someone sometimes filing 2-3 leaves in the same
// month, the flat per-request list (ຈັດການ ຄໍາຂໍລາ page) gets long fast. This
// rolls each employee's requests for the selected month into one line, plus
// their running annual balance (which isn't month-scoped — it never resets
// just because the list above is filtered to one month).
export const LeaveSummaryGrid: React.FC = () => {
  const { monthStart, monthKey, toolbar, matchesEmployee } = useLeaveFilters();

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500 },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const { data: leavesData, isLoading: leavesLoading } = useList<Leave>({
    resource: 'leaves',
    pagination: { pageSize: 2000, mode: 'server' },
  });
  const allLeaves = leavesData?.data ?? [];

  const monthSummaryByEmployee = useMemo(() => {
    const map: Record<string, { count: number; rawDays: number; x1: number; x2: number; money: number }> = {};
    for (const l of allLeaves) {
      if (dayjs(l.startDate).format('YYYY-MM') !== monthKey) continue;
      const empId = idOf(l.employee);
      if (!empId) continue;
      if (!map[empId]) map[empId] = { count: 0, rawDays: 0, x1: 0, x2: 0, money: 0 };
      map[empId].count += 1;
      map[empId].rawDays += dayjs(l.endDate).diff(dayjs(l.startDate), 'day') + 1;
      map[empId].x1 += l.deductDaysX1 ?? 0;
      map[empId].x2 += l.deductDaysX2 ?? 0;
      map[empId].money += l.deductAmountTotal ?? 0;
    }
    return map;
  }, [allLeaves, monthKey]);

  // Same annual-balance calculation as the detail list — approved leaves
  // this YEAR, using billableDays (rest days don't eat into the quota).
  const usedDaysByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of allLeaves) {
      if (l.status !== 'approved') continue;
      if (dayjs(l.startDate).year() !== monthStart.year()) continue;
      const empId = idOf(l.employee);
      if (!empId) continue;
      const days = l.billableDays ?? dayjs(l.endDate).diff(dayjs(l.startDate), 'day') + 1;
      map[empId] = (map[empId] ?? 0) + days;
    }
    return map;
  }, [allLeaves, monthStart]);

  // Only list employees who actually filed a leave this month — with 190+
  // staff, a summary meant to answer "who's been on leave" shouldn't be
  // buried under everyone who wasn't.
  const employees = useMemo(
    () => allEmployees.filter(matchesEmployee).filter((emp) => !!monthSummaryByEmployee[emp._id]),
    [allEmployees, matchesEmployee, monthSummaryByEmployee]
  );

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        {toolbar}
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || leavesLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        locale={{ emptyText: 'ບໍ່ມີໃຜລາໃນຊ່ວງນີ້' }}
      >
        <Table.Column title="ລະຫັດ" width={90} dataIndex="employeeCode" />
        <Table.Column title="ຊື່" width={180} render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`} />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column title="ຈຳນວນຄັ້ງ" width={100} render={(_, emp: Employee) => monthSummaryByEmployee[emp._id]?.count ?? 0} />
        <Table.Column
          title="ລວມມື້ທີ່ລາ"
          width={110}
          render={(_, emp: Employee) => `${monthSummaryByEmployee[emp._id]?.rawDays ?? 0} ມື້`}
        />
        <Table.Column
          title="ລວມມື້ທີ່ຕ້ອງຕັດເງີນ x1"
          width={170}
          render={(_, emp: Employee) => {
            const x1 = monthSummaryByEmployee[emp._id]?.x1 ?? 0;
            return x1 > 0 ? <Typography.Text strong>{x1} ມື້</Typography.Text> : `${x1} ມື້`;
          }}
        />
        <Table.Column title="ລວມ ປ" width={100} render={(_, emp: Employee) => `${monthSummaryByEmployee[emp._id]?.x2 ?? 0} ມື້`} />
        <Table.Column
          title="ລວມຈຳນວນເງິນທີ່ຕັດ"
          width={150}
          render={(_, emp: Employee) => {
            const money = monthSummaryByEmployee[emp._id]?.money ?? 0;
            return money > 0 ? <Typography.Text strong>{money.toLocaleString()}</Typography.Text> : '-';
          }}
        />
        <Table.Column
          title="ວັນພັກປະຈຳປີ"
          width={110}
          render={(_, emp: Employee) => (emp.annualLeaveDays != null ? `${emp.annualLeaveDays} ມື້` : '-')}
        />
        <Table.Column title="ລາໄປແລ້ວປີນີ້" width={110} render={(_, emp: Employee) => `${usedDaysByEmployee[emp._id] ?? 0} ມື້`} />
        <Table.Column
          title="ຍັງເຫຼືອ"
          width={100}
          render={(_, emp: Employee) => {
            const total = emp.annualLeaveDays;
            if (total == null) return '-';
            const remaining = total - (usedDaysByEmployee[emp._id] ?? 0);
            return <Typography.Text type={remaining < 0 ? 'danger' : undefined}>{remaining} ມື້</Typography.Text>;
          }}
        />
      </Table>
    </div>
  );
};

export const LeaveDetailList: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canApprove = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const { monthStart, monthKey, toolbar, matchesEmployee } = useLeaveFilters();

  // Fetched unpaginated (a leave list is never huge) so the month view and the
  // code/name search below can both filter client-side — matching the pattern
  // used on the attendance report pages.
  const { data: leavesData, isLoading } = useList<Leave>({
    resource: 'leaves',
    pagination: { pageSize: 2000, mode: 'server' },
    sorters: [{ field: 'startDate', order: 'desc' }],
  });
  const allLeaves = leavesData?.data ?? [];

  const leaves = useMemo(
    () =>
      allLeaves.filter((l) => {
        if (dayjs(l.startDate).format('YYYY-MM') !== monthKey) return false;
        return matchesEmployee(typeof l.employee === 'object' ? l.employee : undefined);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allLeaves, monthKey]
  );

  // ລາໄປແລ້ວຈັກມື້ / ລວມທັງໝົດ — both read from every APPROVED leave an employee
  // has this YEAR, independent of whichever month is currently being viewed
  // above (the annual balance doesn't reset just because the list is filtered
  // to one month). Uses billableDays (server-computed, excludes any day in
  // the request that lands on the employee's own rest day) rather than the
  // raw date span — a rest day was never really taken off work, so it
  // shouldn't eat into the annual leave quota either.
  const usedDaysByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of allLeaves) {
      if (l.status !== 'approved') continue;
      if (dayjs(l.startDate).year() !== monthStart.year()) continue;
      const empId = idOf(l.employee);
      if (!empId) continue;
      const days = l.billableDays ?? dayjs(l.endDate).diff(dayjs(l.startDate), 'day') + 1;
      map[empId] = (map[empId] ?? 0) + days;
    }
    return map;
  }, [allLeaves, monthStart]);

  // A straddling request is stored as 2 linked documents (see
  // Leave.splitGroupId) — this looks each one up by the OTHER one's id so the
  // table can show which pair a row belongs to and what its sibling's dates
  // are, even when the sibling falls in a different month than the one
  // currently being viewed.
  const splitSiblingById = useMemo(() => {
    const byGroup: Record<string, Leave[]> = {};
    for (const l of allLeaves) {
      if (!l.splitGroupId) continue;
      (byGroup[l.splitGroupId] ??= []).push(l);
    }
    const map: Record<string, Leave> = {};
    for (const group of Object.values(byGroup)) {
      if (group.length !== 2) continue; // defensive — a pair should always have exactly 2
      map[group[0]._id] = group[1];
      map[group[1]._id] = group[0];
    }
    return map;
  }, [allLeaves]);

  // Every date already covered by a pending/approved leave, per employee —
  // feeds the date-pickers below so an admin can see (and can't re-pick) a
  // day someone's already on leave, instead of only finding out from the
  // 409 the server would otherwise return on submit.
  const existingRangesByEmployee = useMemo(() => {
    const map: Record<string, { start: Dayjs; end: Dayjs; id: string }[]> = {};
    for (const l of allLeaves) {
      if (l.status === 'rejected') continue;
      const empId = idOf(l.employee);
      if (!empId) continue;
      (map[empId] ??= []).push({ start: dayjs(l.startDate), end: dayjs(l.endDate), id: l._id });
    }
    return map;
  }, [allLeaves]);

  const isDateTakenBy = (employeeId: string | undefined, excludeIds: string[], date: Dayjs) => {
    const ranges = (employeeId ? existingRangesByEmployee[employeeId] : undefined)?.filter((r) => !excludeIds.includes(r.id));
    return !!ranges?.some((r) => !date.isBefore(r.start, 'day') && !date.isAfter(r.end, 'day'));
  };

  // Tints an already-taken date reddish on top of AntD's own disabled
  // (greyed-out) styling, so it reads as "someone's already on leave here"
  // rather than just "unavailable for some unspecified reason."
  const renderTakenCell = (current: unknown, info: { type: string; originNode: React.ReactElement }, employeeId: string | undefined, excludeIds: string[]) => {
    if (info.type !== 'date' || !isDateTakenBy(employeeId, excludeIds, current as Dayjs)) return info.originNode;
    return (
      <Tooltip title="ພະນັກງານຄົນນີ້ລາ ຫຼື ລໍຖ້າອະນຸມັດຢູ່ແລ້ວໃນວັນນີ້">
        <div style={{ background: 'rgba(255,77,79,0.18)', borderRadius: 4 }}>{info.originNode}</div>
      </Tooltip>
    );
  };

  const { modalProps, formProps, show } = useModalForm<Leave>({
    resource: 'leaves',
    action: 'create',
    // Without this, Refine's default post-submit redirect navigates to the
    // "leaves" resource's own list route (/leaves), which immediately
    // bounces to /leaves/summary via its index redirect — kicking the admin
    // off this page (ລາຍການຄໍາຂໍລາ) every time they create/edit. The modal
    // still closes and the table still refreshes in place either way.
    redirect: false,
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    show: showEdit,
    query: editQuery,
  } = useModalForm<Leave>({
    resource: 'leaves',
    action: 'edit',
    redirect: false,
  });

  // "range" is a UI-only field (the RangePicker) with no matching path on the
  // record, so useModalForm's own auto-fill can't populate it — set it (and
  // the hidden startDate/endDate it drives) manually once the record loads.
  useEffect(() => {
    const record = editQuery?.data?.data;
    if (!record) return;
    editFormProps.form?.setFieldsValue({
      range: [dayjs(record.startDate), dayjs(record.endDate)],
      startDate: record.startDate,
      endDate: record.endDate,
      reason: record.reason,
      deductAmount: record.deductAmount ?? undefined,
      deductNote: record.deductNote ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery?.data?.data]);

  // Which employee's existing leaves should mark/block dates in each modal's
  // picker — the one selected in the create form (or the logged-in employee
  // themself when self-filing, since they never see the picker), and the
  // record's own employee when editing. Editing must not block the record's
  // own current dates (or its split sibling's) against itself.
  const watchedCreateEmployeeId = Form.useWatch('employee', formProps.form);
  const createEmployeeId = canApprove ? watchedCreateEmployeeId : idOf(identity?.employee ?? undefined);
  const editRecord = editQuery?.data?.data;
  const editEmployeeId = idOf(editRecord?.employee);
  const editExcludeIds = editRecord ? [editRecord._id, splitSiblingById[editRecord._id]?._id].filter((v): v is string => !!v) : [];

  // Only an admin/manager filing a request on someone else's behalf needs to
  // pick who it's for — a plain "employee" role user's own id is filled in
  // automatically server-side, so they never see this field.
  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.employeeCode} - ${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { mutate: deleteLeave } = useDelete();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const handleDelete = (id: string) => {
    deleteLeave(
      { resource: 'leaves', id },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ລຶບສຳເລັດ' });
          invalidate({ resource: 'leaves', invalidates: ['list'] });
        },
        onError: () => notify?.({ type: 'error', message: 'ລຶບບໍ່ສຳເລັດ' }),
      }
    );
  };

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <div>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {toolbar}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>
            ຂໍລາ
          </Button>
        </Space>
      </div>

      <Table
        dataSource={leaves}
        loading={isLoading}
        rowKey="_id"
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
        onRow={(record: Leave) => (record.splitGroupId ? { style: { background: '#fffbe6' } } : {})}
      >
        <Table.Column
          title="ລະຫັດ"
          width={110}
          fixed="left"
          render={(_, record: Leave) => (typeof record.employee === 'object' ? record.employee?.deviceUserId : undefined) || '-'}
        />
        <Table.Column
          title="ຊື່"
          width={160}
          fixed="left"
          render={(_, record: Leave) =>
            record.employee && typeof record.employee === 'object'
              ? `${(record.employee as Employee).firstName ?? ''} ${(record.employee as Employee).lastName ?? ''}`
              : '-'
          }
        />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, record: Leave) => {
            const dept = typeof record.employee === 'object' ? record.employee?.department : undefined;
            return (dept && typeof dept === 'object' ? dept.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={130}
          render={(_, record: Leave) => {
            const position = typeof record.employee === 'object' ? record.employee?.position : undefined;
            return (position && typeof position === 'object' ? position.name : undefined) || '-';
          }}
        />
        <Table.Column
          title="ເລີ່ມເຮັດວຽກຕັ້ງແຕ່"
          width={140}
          render={(_, record: Leave) => {
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            return hireDate ? dayjs(hireDate).format('DD/MM/YYYY') : '-';
          }}
        />
        <Table.Column
          title="ເຮັດວຽກໄດ້ຈັກມື້ແລ້ວ"
          width={140}
          render={(_, record: Leave) => {
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            if (!hireDate) return '-';
            const hasFullYear = wasCompletedOneYearForRecord(record, hireDate);
            return (
              <Typography.Text type={hasFullYear ? 'success' : 'warning'}>
                {hasFullYear ? 'ຄົບ 1 ປີ' : 'ຍັງບໍ່ຮອດ 1 ປີ'}
              </Typography.Text>
            );
          }}
        />
        <Table.Column title="ເຫດຜົນທີ່ລາ" dataIndex="reason" width={180} ellipsis />
        <Table.Column
          title="ວັນທີລາ"
          width={130}
          render={(_, record: Leave) => {
            const date = dayjs(record.startDate).format('DD/MM/YYYY');
            if (!record.splitGroupId) return date;
            const sibling = splitSiblingById[record._id];
            const partLabel = record.splitPart === 'before' ? 'ກ່ອນຄົບປີ' : 'ຫຼັງຄົບປີ';
            const siblingLabel = sibling
              ? `${sibling.splitPart === 'before' ? 'ກ່ອນຄົບປີ' : 'ຫຼັງຄົບປີ'}: ${dayjs(sibling.startDate).format('DD/MM/YYYY')}-${dayjs(sibling.endDate).format('DD/MM/YYYY')}`
              : null;
            const tip = `ຄຳຂໍນີ້ຄ່ອມວັນຄົບຮອບ 1 ປີ ຂອງພະນັກງານ ຈຶ່ງຖືກແຍກເປັນ 2 ໃບ — ນີ້ແມ່ນພາກ "${partLabel}"${siblingLabel ? `, ອີກພາກ (${siblingLabel})` : ''}`;
            return (
              <Space size={4}>
                <Tooltip title={tip}>
                  <Tag color="gold" style={{ cursor: 'help', marginRight: 0 }}>
                    {record.splitPart === 'before' ? '1/2' : '2/2'}
                  </Tag>
                </Tooltip>
                {date}
              </Space>
            );
          }}
        />
        <Table.Column title="ຫາວັນທີ" width={110} render={(_, record: Leave) => dayjs(record.endDate).format('DD/MM/YYYY')} />
        <Table.Column
          title="ເຂົ້າວຽກປົກກະຕິ"
          width={130}
          render={(_, record: Leave) => dayjs(record.endDate).add(1, 'day').format('DD/MM/YYYY')}
        />
        <Table.Column
          title="ລາຈັກມື້"
          width={100}
          render={(_, record: Leave) => `${dayjs(record.endDate).diff(dayjs(record.startDate), 'day') + 1} ມື້`}
        />
        <Table.Column
          title="ລາໄປແລ້ວຈັກມື້"
          width={130}
          render={(_, record: Leave) => {
            // Counts against the formal annual entitlement only once the
            // employee has actually earned it (1 year of service) — before
            // that, leave taken still counts toward ລວມທັງໝົດ/ຍັງຈັກມື້ for
            // planning, but doesn't show here yet.
            const hireDate = typeof record.employee === 'object' ? record.employee?.hireDate : undefined;
            const used = hasCompletedOneYear(hireDate) ? usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0 : 0;
            return `${used} ມື້`;
          }}
        />
        <Table.Column
          title="ລວມທັງໝົດ"
          width={110}
          render={(_, record: Leave) => `${usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0} ມື້`}
        />
        <Table.Column
          title="ຍັງຈັກມື້"
          width={100}
          render={(_, record: Leave) => {
            const total = typeof record.employee === 'object' ? record.employee?.annualLeaveDays : undefined;
            if (total == null) return '-';
            const used = usedDaysByEmployee[idOf(record.employee) ?? ''] ?? 0;
            const remaining = total - used;
            return <Typography.Text type={remaining < 0 ? 'danger' : undefined}>{remaining} ມື້</Typography.Text>;
          }}
        />
        <Table.Column
          title="ມື້ທີ່ຕ້ອງຕັດເງີນ x1"
          width={140}
          render={(_, record: Leave) => (record.deductDaysX1 != null ? `${record.deductDaysX1} ມື້` : '-')}
        />
        <Table.Column
          title="ປ"
          width={140}
          render={(_, record: Leave) => (record.deductDaysX2 != null ? `${record.deductDaysX2} ມື້` : '-')}
        />
        <Table.Column title="ຕັດເງີນຈັກເທົ່າ" dataIndex="deductAmount" width={110} render={(v) => v || '-'} />
        <Table.Column
          title="ຈຳນວນເງິນທີ່ຕັດ"
          width={140}
          render={(_, record: Leave) => (record.deductAmountTotal != null ? record.deductAmountTotal.toLocaleString() : '-')}
        />
        <Table.Column
          title="ຫມາຍເຫດ"
          width={220}
          ellipsis
          render={(_, record: Leave) => {
            const parts = [formatRestDayOverlaps(record.restDayOverlaps), record.deductNote].filter(Boolean);
            return parts.length ? parts.join(' — ') : '-';
          }}
        />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(v) => <LeaveStatusTag status={v} />} />
        {isAdmin && (
          <Table.Column
            title="ຈັດການ"
            fixed="right"
            width={120}
            render={(_, record: Leave) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <Popconfirm
                  title="ລຶບຄໍາຂໍລານີ້?"
                  description={
                    record.splitGroupId
                      ? 'ຄຳຂໍນີ້ຖືກແຍກເປັນ 2 ໃບ (ຄ່ອມວັນຄົບຮອບປີ) — ຈະລຶບພ້ອມກັນທັງຄູ່ ແລະລ້າງສະຖານະ "ລາ" ໃນລາຍງານການສະແກນຂອງວັນທີ່ກ່ຽວຂ້ອງອອກນຳ, ແກ້ບໍ່ໄດ້ຄືນ'
                      : 'ຈະລ້າງສະຖານະ "ລາ" ໃນລາຍງານການສະແກນຂອງວັນທີ່ກ່ຽວຂ້ອງອອກນຳ, ແກ້ບໍ່ໄດ້ຄືນ'
                  }
                  okText="ລຶບ"
                  okButtonProps={{ danger: true }}
                  cancelText="ບໍ່"
                  onConfirm={() => handleDelete(record._id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...modalProps} title="ຂໍລາງານ" destroyOnClose>
        <Form {...formProps} layout="vertical">
          {canApprove && (
            <Form.Item label="ພະນັກງານ" name="employee" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
              <Select {...withLocalTextFilter(employeeSelect)} placeholder="ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່" />
            </Form.Item>
          )}
          <Form.Item label="ຊ່ວງວັນທີລາ" name="range" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ' }]}>
            <RangePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              disabledDate={(current) => isDateTakenBy(createEmployeeId, [], current)}
              cellRender={(current, info) => renderTakenCell(current, info, createEmployeeId, [])}
              onChange={(dates) => {
                formProps.form?.setFieldsValue({
                  startDate: dates?.[0]?.toISOString(),
                  endDate: dates?.[1]?.toISOString(),
                });
              }}
            />
          </Form.Item>
          {createEmployeeId && (existingRangesByEmployee[createEmployeeId]?.length ?? 0) > 0 && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 12 }}>
              ວັນທີ່ມີສີແດງ = ພະນັກງານຄົນນີ້ລາ ຫຼື ລໍຖ້າອະນຸມັດຢູ່ແລ້ວ (ເລືອກຊ້ຳບໍ່ໄດ້)
            </Typography.Text>
          )}
          <Form.Item name="startDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={3} placeholder="ລະບຸເຫດຜົນການລາ (ຖ້າມີ)" />
          </Form.Item>
          <Form.Item
            label="ຕັດເງີນຈັກເທົ່າ"
            name="deductAmount"
            tooltip="ຈຳນວນເງິນທີ່ຕັດ = (ເງິນເດືອນ ÷ 30) × ມື້ທີ່ຕ້ອງຕັດເງີນ x1 × ອັດຕານີ້ (X0=ບໍ່ຕັດ, X1=1 ເທົ່າ, X2=2 ເທົ່າ, X3=3 ເທົ່າ) — ອັດຕາຈະຖືກຕັ້ງອັດຕະໂນມັດ: X0 ເມື່ອ x1 ເປັນ 0, ຫຼື X1 ເມື່ອ x1 ຫຼາຍກວ່າ 0 ແລະຍັງບໍ່ໄດ້ເລືອກ (ປ່ຽນເປັນ X2/X3 ເອງໄດ້ພາຍຫຼັງ)"
          >
            <Select
              allowClear
              placeholder="ເລືອກອັດຕາ"
              options={[
                { label: 'X0 (ບໍ່ຕັດ)', value: 'X0' },
                { label: 'X1', value: 'X1' },
                { label: 'X2', value: 'X2' },
                { label: 'X3', value: 'X3' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂຄໍາຂໍລາ" destroyOnClose>
        <Form {...editFormProps} layout="vertical">
          {editQuery?.data?.data?.splitGroupId && (
            <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
              ຄຳຂໍນີ້ຄ່ອມວັນຄົບຮອບ 1 ປີ ຈຶ່ງຖືກແຍກເປັນ 2 ໃບຜູກກັນ — ຖ້າແກ້ຊ່ວງວັນທີຢູ່ນີ້ ລະບົບຈະຖືວັນທີ່ໃສ່ນີ້ເປັນ "ຊ່ວງລວມທັງໝົດ" ຂອງທັງຄູ່ ແລ້ວຄິດໄລ່ທັງ 2 ໃບໃໝ່ອັດຕະໂນມັດ (ບໍ່ແມ່ນສະເພາະເຄິ່ງດຽວທີ່ກຳລັງແກ້)
            </Typography.Paragraph>
          )}
          <Form.Item label="ຊ່ວງວັນທີລາ" name="range" rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ' }]}>
            <RangePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              disabledDate={(current) => isDateTakenBy(editEmployeeId, editExcludeIds, current)}
              cellRender={(current, info) => renderTakenCell(current, info, editEmployeeId, editExcludeIds)}
              onChange={(dates) => {
                editFormProps.form?.setFieldsValue({
                  startDate: dates?.[0]?.toISOString(),
                  endDate: dates?.[1]?.toISOString(),
                });
              }}
            />
          </Form.Item>
          {editEmployeeId && (existingRangesByEmployee[editEmployeeId]?.filter((r) => !editExcludeIds.includes(r.id)).length ?? 0) > 0 && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 12 }}>
              ວັນທີ່ມີສີແດງ = ພະນັກງານຄົນນີ້ລາ ຫຼື ລໍຖ້າອະນຸມັດຢູ່ແລ້ວ (ເລືອກຊ້ຳບໍ່ໄດ້)
            </Typography.Text>
          )}
          <Form.Item name="startDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="ເຫດຜົນ" name="reason">
            <Input.TextArea rows={3} placeholder="ລະບຸເຫດຜົນການລາ (ຖ້າມີ)" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            "ມື້ທີ່ຕ້ອງຕັດເງີນ x1" ແລະ "ປ" ຄຳນວນອັດຕະໂນມັດຈາກວັນທີ່ລາ (ບໍ່ນັບວັນພັກຂອງພະນັກງານ) — ແກ້ໄຂໄດ້ສະເພາະອັດຕາທີ່ຕັດເງິນ ແລະ ໝາຍເຫດ
          </Typography.Paragraph>
          <Form.Item
            label="ຕັດເງີນຈັກເທົ່າ"
            name="deductAmount"
            tooltip="ຈຳນວນເງິນທີ່ຕັດ = (ເງິນເດືອນ ÷ 30) × ມື້ທີ່ຕ້ອງຕັດເງີນ x1 × ອັດຕານີ້ (X0=ບໍ່ຕັດ, X1=1 ເທົ່າ, X2=2 ເທົ່າ, X3=3 ເທົ່າ) — ອັດຕາຈະຖືກຕັ້ງອັດຕະໂນມັດ: X0 ເມື່ອ x1 ເປັນ 0, ຫຼື X1 ເມື່ອ x1 ຫຼາຍກວ່າ 0 ແລະຍັງບໍ່ໄດ້ເລືອກ (ປ່ຽນເປັນ X2/X3 ເອງໄດ້ພາຍຫຼັງ)"
          >
            <Select
              allowClear
              placeholder="ເລືອກອັດຕາ"
              options={[
                { label: 'X0 (ບໍ່ຕັດ)', value: 'X0' },
                { label: 'X1', value: 'X1' },
                { label: 'X2', value: 'X2' },
                { label: 'X3', value: 'X3' },
              ]}
            />
          </Form.Item>
          <Form.Item label="ຫມາຍເຫດ" name="deductNote">
            <Input.TextArea rows={2} placeholder="ຫມາຍເຫດກ່ຽວກັບການຕັດເງີນ (ຖ້າມີ)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
