import { useEffect, useState } from 'react';

// Toggles a refine <Table> between normal pagination and showing every row
// on one page. Keeps tracking `total` while active so newly added rows
// (created elsewhere, picked up by refine's cache invalidation) stay visible
// instead of being capped at whatever `total` was when the toggle was flipped.
export function useShowAllToggle(setPageSize: (size: number) => void, total: number, defaultPageSize = 10) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (showAll) {
      if (total > 0) setPageSize(total);
    } else {
      setPageSize(defaultPageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, total]);

  return { showAll, toggleShowAll: () => setShowAll((v) => !v) };
}
