// Page size for every "load all employees" list (day grids, report rows,
// person pickers) — one shared ceiling instead of a number per page. Refine's
// list simply stops at the page size, with no error, so the pages still at
// 200 had already started dropping people once the staff passed that. Set
// well past today's headcount on purpose.
export const ALL_EMPLOYEES_PAGE_SIZE = 2000;
