import { useMemo } from 'react';
import { useSelect } from '@refinedev/antd';
import type { Position } from '../types';

// Strict match: a position only counts for a department if it's actually
// tagged with that department. Positions with no department tagged yet won't
// show under any department until someone tags them.
function positionMatchesDepartment(position: Position, departmentId: string) {
  return (position.departments ?? []).some((d) => (d && typeof d === 'object' ? d._id : d) === departmentId);
}

export function usePositionsByDepartment(departmentId?: string) {
  // Without an explicit pageSize, refine's useSelect defaults to fetching only
  // the first 10 records — silently truncating `allPositions` below, so the
  // department filter would only ever see a handful of positions to match
  // against, missing anything past that page.
  const { selectProps: positionSelect, query } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
  });

  const allPositions = query?.data?.data ?? [];

  // No department chosen yet -> no positions to offer (the <Select> using this
  // should be disabled in that case, forcing department-first selection). Once
  // a department is chosen, show only positions explicitly tagged with it —
  // a department with nothing tagged yet correctly shows an empty list rather
  // than falling back to "everything", so admins notice it still needs tagging.
  function candidatesFor(targetDepartmentId?: string) {
    if (!targetDepartmentId) return [];
    return allPositions.filter((p) => positionMatchesDepartment(p, targetDepartmentId));
  }

  const options = useMemo(
    () => candidatesFor(departmentId).map((p) => ({ label: p.name, value: p._id })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPositions, departmentId]
  );

  // Takes an explicit target department id (rather than reading the `departmentId`
  // this hook was called with) so a department <Select>'s onChange handler can check
  // the position against the NEWLY picked department, before that value has
  // propagated back through Form.useWatch and re-rendered `options` above.
  const isValidForDepartment = (positionId?: string, targetDepartmentId?: string) => {
    if (!positionId) return true;
    return candidatesFor(targetDepartmentId).some((p) => p._id === positionId);
  };

  return { positionSelect, options, isValidForDepartment, allPositions };
}
