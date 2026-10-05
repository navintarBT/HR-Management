import { useEffect, useState } from 'react';

// Toggles a refine <Table> between normal pagination and showing every row
// on one page. Keeps tracking `total` while active so newly added rows
// (created elsewhere, picked up by refine's cache invalidation) stay visible
// instead of being capped at whatever `total` was when the toggle was flipped.
//
// Also resets to page 1 on every toggle — refine's `setPageSize` never touches
// `current` on its own, so flipping to "show all" while sitting on page 2+ of
// the normal view re-queries with `_start` past the (now single-page) result
// set and renders as if there's no data at all.
export function useShowAllToggle(
  setPageSize: (size: number) => void,
  total: number,
  defaultPageSize = 10,
  setCurrent?: (page: number) => void
) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setCurrent?.(1);
    if (showAll) {
      if (total > 0) setPageSize(total);
    } else {
      setPageSize(defaultPageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, total]);

  return { showAll, toggleShowAll: () => setShowAll((v) => !v) };
}
