import { useState } from 'react';
import { List } from '@refinedev/antd';
import { useCustom, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Tag } from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { OrphanedDeviceUser } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';

// PINs a scanner reports as enrolled (see routes/adms.js's BIODATA handling)
// that match no Employee.deviceUserId in our system at all — someone long
// gone, a stale test enrollment, etc. "ດຶງ" asks every known device to
// re-report its enrolled list (not instant — the device answers whenever it
// next polls, could take a minute or more), "ລຶບ" removes one PIN from the
// one device it was found on.
export const DeviceUsersPage: React.FC = () => {
  const { open: notify } = useNotification();
  const invalidate = useInvalidate();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  const {
    data: orphanedData,
    isLoading,
    refetch,
  } = useCustom<OrphanedDeviceUser[]>({
    url: `${API_URL}/device-users/orphaned`,
    method: 'get',
  });
  const orphaned = orphanedData?.data ?? [];

  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try {
      const res = await axiosInstance.post(`${API_URL}/device-users/pull`, {});
      notify?.({
        type: 'success',
        message: `ສົ່ງຄຳຂໍໄປ ${res.data.queued} ເຄື່ອງແລ້ວ — ລໍຖ້າສັກຄູ່ແລ້ວກົດ "ໂຫຼດຄືນໃໝ່" ເພື່ອເບິ່ງຂໍ້ມູນລ່າສຸດ`,
      });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ' });
    } finally {
      setPulling(false);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const removeOne = async (record: OrphanedDeviceUser) => {
    setDeletingId(record.id);
    try {
      await axiosInstance.post(`${API_URL}/device-users/${record.id}/delete`, {});
      notify?.({ type: 'success', message: `ຕັ້ງຄິວລຶບ PIN ${record.pin} ອອກຈາກເຄື່ອງແລ້ວ` });
      refetch();
      invalidate({ resource: 'device-users', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ລຶບບໍ່ສຳເລັດ' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <List title="ໄອດີທີ່ບໍ່ກົງກັບລະບົບ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<ReloadOutlined />} loading={pulling} onClick={pull}>
            ດຶງຂໍ້ມູນຈາກເຄື່ອງສະແກນ
          </Button>
          <Button onClick={() => refetch()}>ໂຫຼດຄືນໃໝ່</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ລາຍການນີ້ແມ່ນ PIN ທີ່ເຄື່ອງສະແກນລາຍງານວ່າມີລົງທະບຽນໄວ້ ແຕ່ບໍ່ກົງກັບພະນັກງານຄົນໃດໃນລະບົບເຮົາເລີຍ (ອາດເປັນຄົນທີ່ອອກໄປແລ້ວ ຫຼື PIN ທົດລອງເກົ່າ) —
          ກົດ "ດຶງຂໍ້ມູນຈາກເຄື່ອງສະແກນ" ເພື່ອຂໍໃຫ້ເຄື່ອງລາຍງານລ່າສຸດ (ໃຊ້ເວລາສັກຄູ່ ບໍ່ແມ່ນທັນທີ) ແລ້ວກົດ "ໂຫຼດຄືນໃໝ່" ເພື່ອເບິ່ງຜົນ
        </Typography.Paragraph>
      </div>

      <Table
        dataSource={orphaned}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        sticky={{ offsetHeader }}
        size="small"
        locale={{ emptyText: 'ບໍ່ພົບ ID ທີ່ບໍ່ກົງກັບລະບົບ' }}
      >
        <Table.Column
          title="ເຄື່ອງສະແກນ"
          dataIndex="serialNumber"
          render={(sn: string) => <Tag>{sn}</Tag>}
        />
        <Table.Column title="PIN" dataIndex="pin" render={(pin: string) => <Typography.Text strong>{pin}</Typography.Text>} />
        <Table.Column title="ຊື່ໃນເຄື່ອງ" dataIndex="name" render={(name?: string) => name || '-'} />
        <Table.Column
          title="ພົບລ່າສຸດ"
          dataIndex="lastSeenAt"
          render={(value: string) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-')}
        />
        <Table.Column
          title="ຈັດການ"
          width={100}
          align="center"
          render={(_, record: OrphanedDeviceUser) => (
            <Popconfirm
              title="ລຶບ PIN ນີ້ອອກຈາກເຄື່ອງ?"
              description={`ລຶບ PIN ${record.pin} ອອກຈາກເຄື່ອງ ${record.serialNumber}`}
              okText="ລຶບ"
              cancelText="ບໍ່"
              onConfirm={() => removeOne(record)}
            >
              <Button danger size="small" icon={<DeleteOutlined />} loading={deletingId === record.id} />
            </Popconfirm>
          )}
        />
      </Table>
    </List>
  );
};
