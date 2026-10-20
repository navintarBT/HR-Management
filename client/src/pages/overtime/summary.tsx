import { List } from '@refinedev/antd';
import { OvertimeSummaryGrid } from './index';

export const OvertimeSummaryPage: React.FC = () => (
  <List title="ສະຫຼຸບOT" breadcrumb={false}>
    <OvertimeSummaryGrid />
  </List>
);
