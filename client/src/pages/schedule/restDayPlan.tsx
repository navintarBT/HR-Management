import { List } from '@refinedev/antd';
import { ScheduleCoversGrid } from './covers';

// ວາງແຜນວັນພັກ — one week at a time (agreed 15/11/2026): everyone's rest days,
// leave and covers for each day of the week picked, so the rest days are planned
// with the covers in view. On a coming week a click on a day moves that
// person's recurring rest day, saved from that week's Monday after the usual
// check (routes/restDayHistory.js planMany); 📅 by a name sets one person's
// (with "as soon as possible" for someone new). Past weeks are only to look at.
// The grid is ການເຮັດແທນ's own (covers.tsx, planner mode), so both show the
// same thing.
export const RestDayPlanPage: React.FC = () => (
  <List title="ວາງແຜນວັນພັກ" breadcrumb={false}>
    <ScheduleCoversGrid planner />
  </List>
);
