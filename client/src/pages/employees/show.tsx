import { Show } from '@refinedev/antd';
import { useShow } from '@refinedev/core';
import { Descriptions, Avatar, Typography, Space } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee } from '../../types';
import { EmployeeStatusTag } from '../../components/StatusTags';
import { palette } from '../../theme/palette';

export const EmployeeShow: React.FC = () => {
  const { query } = useShow<Employee>({ resource: 'employees' });
  const record = query?.data?.data;

  return (
    <Show isLoading={query?.isLoading} title="ຂໍ້ມູນພະນັກງານ">
      <Space align="center" size={16} style={{ marginBottom: 24 }}>
        <Avatar size={64} icon={<UserOutlined />} style={{ backgroundColor: palette.primary }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {record?.firstName} {record?.lastName}
          </Typography.Title>
          <Typography.Text type="secondary">{record?.employeeCode}</Typography.Text>
        </div>
      </Space>

      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ພະແນກ">
          {typeof record?.department === 'object' ? record?.department?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຕໍາແໜ່ງ">
          {typeof record?.position === 'object' ? record?.position?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ວັນທີເລີ່ມງານ">
          {record?.hireDate ? dayjs(record.hireDate).format('DD MMMM YYYY') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ສະຖານະ">
          {record?.status ? <EmployeeStatusTag status={record.status} /> : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ອີເມວ">{record?.email || '-'}</Descriptions.Item>
        <Descriptions.Item label="ເບີໂທ">{record?.phone || '-'}</Descriptions.Item>
        <Descriptions.Item label="ລະຫັດອຸປະກອນສະແກນ (deviceUserId)" span={2}>
          {record?.deviceUserId || '-'}
        </Descriptions.Item>
      </Descriptions>
    </Show>
  );
};
