import { List } from '@refinedev/antd';
import { Tabs } from 'antd';
import { DepartmentPanel } from './DepartmentPanel';
import { PositionPanel } from './PositionPanel';
import { useHeadingBottom } from '../../hooks/useTableStickyOffset';

export const OrganizationPage: React.FC = () => {
  const headingBottom = useHeadingBottom();

  return (
    <List title="ພະແນກແລະຕໍາແໜ່ງງານ" headerButtons={<></>} breadcrumb={false}>
      <Tabs
        defaultActiveKey="departments"
        tabBarStyle={{ position: 'sticky', top: headingBottom, zIndex: 9, background: 'var(--app-surface-bg)', margin: 0 }}
        items={[
          { key: 'departments', label: 'ພະແນກ', children: <DepartmentPanel /> },
          { key: 'positions', label: 'ຕໍາແໜ່ງງານ', children: <PositionPanel /> },
        ]}
      />
    </List>
  );
};
