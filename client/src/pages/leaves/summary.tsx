import { List } from '@refinedev/antd';
import { LeaveSummaryGrid } from './index';

export const LeaveSummaryPage: React.FC = () => (
  <List title="ສະຫຼູບລາ" breadcrumb={false}>
    <LeaveSummaryGrid />
  </List>
);
