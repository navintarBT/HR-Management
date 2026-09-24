import { List } from '@refinedev/antd';
import { LeaveSummaryGrid } from './index';

export const LeaveSummaryPage: React.FC = () => (
  <List title="ລາ - ຕາຕະລາງສະຫຼຸບ" breadcrumb={false}>
    <LeaveSummaryGrid />
  </List>
);
