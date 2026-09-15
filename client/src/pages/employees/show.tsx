import { Show } from '@refinedev/antd';
import { useShow } from '@refinedev/core';
import { Descriptions, Avatar, Typography, Space, Divider } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee } from '../../types';
import { EmployeeStatusTag } from '../../components/StatusTags';
import { palette } from '../../theme/palette';
import { resolvePhotoUrl } from '../../providers/axios';

export const EmployeeShow: React.FC = () => {
  const { query } = useShow<Employee>({ resource: 'employees' });
  const record = query?.data?.data;

  return (
    <Show isLoading={query?.isLoading} title="ຂໍ້ມູນພະນັກງານ">
      <Space align="center" size={16} style={{ marginBottom: 8 }}>
        <Avatar size={64} src={resolvePhotoUrl(record?.photoUrl)} icon={<UserOutlined />} style={{ backgroundColor: palette.primary }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {record?.firstName} {record?.lastName}
          </Typography.Title>
          <Typography.Text type="secondary">{record?.employeeCode}</Typography.Text>
        </div>
      </Space>

      <Divider orientation="left">ຂໍ້ມູນພະນັກງານ</Divider>
      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ລະຫັດພະນັກງານ">{record?.employeeCode || '-'}</Descriptions.Item>
        <Descriptions.Item label="ລະຫັດເຄື່ອງສະແກນ">{record?.deviceUserId || '-'}</Descriptions.Item>
        <Descriptions.Item label="ຊື່">{record?.firstName || '-'}</Descriptions.Item>
        <Descriptions.Item label="ນາມສະກຸນ">{record?.lastName || '-'}</Descriptions.Item>
        <Descriptions.Item label="ອີເມວ">{record?.email || '-'}</Descriptions.Item>
        <Descriptions.Item label="ເບີໂທ">{record?.phone || '-'}</Descriptions.Item>
      </Descriptions>

      <Divider orientation="left">ຂໍ້ມູນການເຮັດວຽກ</Divider>
      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ພະແນກ">
          {typeof record?.department === 'object' ? record?.department?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຕຳແໜ່ງ">
          {typeof record?.position === 'object' ? record?.position?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຫົວໜ້າງານ">
          {typeof record?.supervisor === 'object' && record.supervisor
            ? `${record.supervisor.firstName} ${record.supervisor.lastName}`
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຫົວໜ້າຕໍາແໜ່ງ">
          {typeof record?.positionHead === 'object' && record.positionHead
            ? `${record.positionHead.firstName} ${record.positionHead.lastName}`
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ປະເພດການຈ້າງ">
          {typeof record?.employmentType === 'object' ? record?.employmentType?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ວັນທີເລີ່ມງານ">
          {record?.hireDate ? dayjs(record.hireDate).format('DD MMMM YYYY') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ສະຖານະ">
          {record?.status ? <EmployeeStatusTag status={record.status} /> : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ວັນທີອອກງານ">
          {record?.terminationDate ? dayjs(record.terminationDate).format('DD MMMM YYYY') : '-'}
        </Descriptions.Item>
      </Descriptions>
    </Show>
  );
};
