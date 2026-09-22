import { List } from '@refinedev/antd';
import { OvertimeDetailList } from './index';

export const OvertimeManagePage: React.FC = () => (
  <List title="ຈັດການ OT" breadcrumb={false}>
    <OvertimeDetailList />
  </List>
);
