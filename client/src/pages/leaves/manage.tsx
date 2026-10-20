import { List } from '@refinedev/antd';
import { LeaveDetailList } from './index';

export const LeaveManagePage: React.FC = () => (
  <List title="ຈັດການຄໍາຂໍລາ" breadcrumb={false}>
    <LeaveDetailList />
  </List>
);
