import { List } from '@refinedev/antd';
import { useList } from '@refinedev/core';
import { Tabs } from 'antd';
import { DepartmentPanel } from './DepartmentPanel';
import { PositionPanel } from './PositionPanel';
import { EmploymentTypePanel } from './EmploymentTypePanel';
import { useHeadingBottom } from '../../hooks/useTableStickyOffset';

export const OrganizationPage: React.FC = () => {
  const headingBottom = useHeadingBottom();

  const { data: departmentsData } = useList({ resource: 'departments', pagination: { pageSize: 1 } });
  const { data: positionsData } = useList({ resource: 'positions', pagination: { pageSize: 1 } });
  const { data: employmentTypesData } = useList({ resource: 'employment-types', pagination: { pageSize: 1 } });

  const departmentCount = departmentsData?.total ?? 0;
  const positionCount = positionsData?.total ?? 0;
  const employmentTypeCount = employmentTypesData?.total ?? 0;

  return (
    <List title="ພະແນກ / ຕໍາແໜ່ງ / ປະເພດການຈ້າງ" headerButtons={<></>} breadcrumb={false}>
      <Tabs
        defaultActiveKey="departments"
        tabBarStyle={{ position: 'sticky', top: headingBottom, zIndex: 9, background: 'var(--app-surface-bg)', margin: 0 }}
        items={[
          { key: 'departments', label: `ພະແນກ (${departmentCount})`, children: <DepartmentPanel /> },
          { key: 'positions', label: `ຕໍາແໜ່ງງານ (${positionCount})`, children: <PositionPanel /> },
          { key: 'employment-types', label: `ປະເພດການຈ້າງ (${employmentTypeCount})`, children: <EmploymentTypePanel /> },
        ]}
      />
    </List>
  );
};
