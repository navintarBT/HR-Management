import { useEffect, useRef, useState } from 'react';

// Height of the app's own fixed header (see AppHeader.tsx) — the one true
// hardcoded constant here; everything else is measured at runtime because
// Refine's <List> title row height varies (a page with headerButtons renders
// taller than one without), and hardcoding it drifts out of sync per page.
const APP_HEADER_HEIGHT = 64;

function useElementHeight(selector: string) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
      setHeight(0);
      return;
    }
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selector]);

  return height;
}

// Bottom edge of the title row Refine's <List> renders (.ant-page-header-heading,
// sticky at top:64 via sticky.css). Breadcrumbs are disabled everywhere
// (breadcrumb={false} on every <List>) so this is always the first row —
// Refine only renders one on nested resources otherwise, which would
// silently throw this off on top-level pages but not nested ones.
export function useHeadingBottom() {
  const headingHeight = useElementHeight('.ant-page-header-heading');
  return APP_HEADER_HEIGHT + headingHeight;
}

// For pages that also nest a Tabs bar (e.g. Organization) between the title
// and their own toolbar.
export function useTabsNavBottom() {
  const headingBottom = useHeadingBottom();
  const tabsNavHeight = useElementHeight('.ant-tabs-nav');
  return headingBottom + tabsNavHeight;
}

// Measures a page's own toolbar (search box, filter form) so the Table's
// sticky header can be told exactly how far down to stop — combined with
// sticky.css, this keeps the title, toolbar, and table header all pinned
// while only the table rows scroll underneath.
export function useTableStickyOffset(customStackTop?: number) {
  const headingBottom = useHeadingBottom();
  const stackTop = customStackTop ?? headingBottom;

  const ref = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setToolbarHeight(0);
      return;
    }
    const update = () => setToolbarHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, stackTop, offsetHeader: stackTop + toolbarHeight };
}
