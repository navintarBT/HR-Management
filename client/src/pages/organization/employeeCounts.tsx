import { useEffect, useMemo, useRef, useState } from 'react';
import { useCustom, type CrudFilter } from '@refinedev/core';
import { Checkbox, Tag, Tooltip, Typography } from 'antd';
import { API_URL } from '../../providers/axios';
import { employeeStatusMap } from '../../components/StatusTags';
import type { Employee } from '../../types';

// How many people every ພະແນກ / ຕໍາແໜ່ງ / ປະເພດການຈ້າງ has (GET
// /employees/organization-counts), so the ones nobody uses can be found and
// removed. Deleting is refused while anyone at all still points at one,
// ລາອອກ included, so "in use" here counts every status too.

type Status = Employee['status'];
export type OrganizationCountEntry = {
  employees: Partial<Record<Status, number>>;
  positions?: number; // a department's
  pendingSwaps?: number; // a position's
};
export type OrganizationKind = 'departments' | 'positions' | 'employmentTypes';
type OrganizationCounts = Record<OrganizationKind, Record<string, OrganizationCountEntry>>;

const STATUS_ORDER: Status[] = ['active', 'suspended', 'draft', 'inactive', 'resigned'];

export const peopleIn = (entry?: OrganizationCountEntry) =>
  Object.values(entry?.employees ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);

// Why one can't be deleted, or null when it can (or the counts aren't known —
// the server checks again either way).
export function deleteBlockedReason(kind: OrganizationKind, entry?: OrganizationCountEntry): string | null {
  if (!entry) return null;
  const people = peopleIn(entry);
  if (people) {
    const working = entry.employees.active ?? 0;
    return working === people
      ? `ມີພະນັກງານ ${people} ຄົນຢູ່ — ລຶບບໍ່ໄດ້`
      : `ຍັງມີ ${people} ຄົນຢູ່ (ລວມຄົນທີ່ລາອອກ/ພັກວຽກ) — ຕ້ອງຍ້າຍເຂົາອອກກ່ອນຈຶ່ງລຶບໄດ້`;
  }
  if (kind === 'positions' && entry.pendingSwaps) return 'ມີການສະຫຼັບກະທີ່ລໍຖ້າຢູ່ — ຍົກເລີກການສະຫຼັບນັ້ນກ່ອນຈຶ່ງລຶບໄດ້';
  return null;
}

export function useOrganizationCounts(kind: OrganizationKind) {
  const { data, isLoading, isError, refetch } = useCustom<OrganizationCounts>({
    url: `${API_URL}/employees/organization-counts`,
    method: 'get',
    errorNotification: false,
  });
  const counts = data?.data?.[kind];
  const unusedIds = useMemo(
    () => (counts ? Object.entries(counts).filter(([, entry]) => !peopleIn(entry)).map(([id]) => id) : []),
    [counts]
  );
  return { counts, unusedIds, loaded: !!counts, failed: isError, loading: isLoading, refetch };
}

// The ພະນັກງານ column: those working now, then the rest by status.
export function EmployeeCountCell({ entry, loaded, kind }: { entry?: OrganizationCountEntry; loaded: boolean; kind: OrganizationKind }) {
  if (!loaded) return <Typography.Text type="secondary">-</Typography.Text>;
  const people = peopleIn(entry);
  const swapTag =
    kind === 'positions' && entry?.pendingSwaps ? (
      <Tooltip title="ມີການສະຫຼັບກະທີ່ລໍຖ້າຢູ່">
        <Tag color="purple" style={{ marginInlineEnd: 0 }}>
          ສະຫຼັບກະລໍຖ້າ
        </Tag>
      </Tooltip>
    ) : null;
  if (!people) {
    return (
      <span className="org-count-cell" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
        <Tag color="orange" style={{ marginInlineEnd: 0 }}>
          ບໍ່ມີພະນັກງານ
        </Tag>
        {swapTag}
      </span>
    );
  }
  const working = entry?.employees.active ?? 0;
  const others = STATUS_ORDER.filter((s) => s !== 'active' && entry?.employees[s]).map(
    (s) => `${employeeStatusMap[s].label} ${entry?.employees[s]}`
  );
  return (
    <span className="org-count-cell" style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 }}>
      <Typography.Text strong={working > 0} type={working ? undefined : 'secondary'}>
        {working} ຄົນ
      </Typography.Text>
      {others.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          ({others.join(' · ')})
        </Typography.Text>
      )}
      {swapTag}
    </span>
  );
}

// "Only the unused ones" — a filter on the table's own server-side list, so
// it works across pages. Turns itself off once there's none left.
export function useUnusedOnlyFilter(unusedIds: string[], apply: (unusedFilter: CrudFilter | null) => void) {
  const [onlyUnused, setOnlyUnused] = useState(false);
  const unusedKey = unusedIds.join(',');
  const touched = useRef(false);
  useEffect(() => {
    if (onlyUnused && !unusedIds.length) {
      setOnlyUnused(false);
      return;
    }
    if (!onlyUnused && !touched.current) return;
    touched.current = true;
    apply(onlyUnused ? { field: '_id', operator: 'in', value: unusedIds } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnused, unusedKey]);
  const unusedFilter: CrudFilter | null = onlyUnused && unusedIds.length ? { field: '_id', operator: 'in', value: unusedIds } : null;
  return { onlyUnused, setOnlyUnused, unusedFilter };
}

export function UnusedOnlyToggle({
  checked,
  onChange,
  count,
  loaded,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  count: number;
  loaded: boolean;
}) {
  return (
    <Checkbox checked={checked} disabled={!loaded || (!count && !checked)} onChange={(e) => onChange(e.target.checked)}>
      ສະເພາະທີ່ບໍ່ມີພະນັກງານ{loaded ? ` (${count})` : ''}
    </Checkbox>
  );
}
