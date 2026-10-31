import { useState } from 'react';
import { useCustom, useGetIdentity, useNotification } from '@refinedev/core';
import { Descriptions, Space, Tag, Typography, Button } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, EmployeeScannerStatus as ScannerStatus, Identity } from '../types';
import { API_URL, axiosInstance } from '../providers/axios';

const templateLabel = (t: ScannerStatus['templates'][number]) => {
  const version = t.majorVer != null ? ` · V${t.majorVer}` : '';
  if (t.type === 1) return `ນິ້ວມື #${t.no}${version}`;
  if (t.type === 9) return `ໃບໜ້າ${version}`;
  if (t.type === 2) return `ໃບໜ້າ (IR)${version}`;
  return `ປະເພດ ${t.type}${version}`;
};

// Where this employee stands on the scanners: which ones reported the PIN as
// enrolled on their last ດຶງ, which face/fingerprint templates the system has
// stored (never the template data itself), and anything still waiting to be
// delivered — plus a manual push to the synced scanners. Admins/managers only.
export const EmployeeScannerStatusSection: React.FC<{ employee?: Employee }> = ({ employee }) => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();
  const canView = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const { data, isLoading, refetch } = useCustom<ScannerStatus>({
    url: `${API_URL}/device-users/employee/${employee?._id}`,
    method: 'get',
    queryOptions: { enabled: !!employee?._id && canView },
  });
  const status = data?.data;

  const [pushing, setPushing] = useState(false);
  const push = async () => {
    if (!employee) return;
    setPushing(true);
    try {
      const res = await axiosInstance.post(`${API_URL}/device-users/employee/${employee._id}/push`, {});
      notify?.({
        type: 'success',
        message: res.data.queued
          ? `ຕັ້ງຄິວ ${res.data.queued} ຄຳສັ່ງໄປເຄື່ອງທີ່ເປີດຊິງແລ້ວ`
          : 'ບໍ່ມີຫຍັງຕ້ອງສົ່ງ — ຍັງບໍ່ມີເຄື່ອງທີ່ເປີດຊິງ ຫຼື ຄຳສັ່ງດຽວກັນລໍຖ້າຢູ່ແລ້ວ',
      });
      refetch();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ສົ່ງບໍ່ສຳເລັດ' });
    } finally {
      setPushing(false);
    }
  };

  if (!canView || !employee) return null;
  if (!employee.deviceUserId) {
    return <Typography.Text type="secondary">ຍັງບໍ່ມີລະຫັດເຄື່ອງສະແກນ</Typography.Text>;
  }

  return (
    <Descriptions bordered column={1} size="middle">
      <Descriptions.Item label="ໃບໜ້າ/ນິ້ວມືທີ່ລະບົບເກັບໄວ້">
        {isLoading ? (
          '...'
        ) : status?.templates.length ? (
          <Space wrap>
            {status.templates.map((t) => (
              <Tag key={`${t.type}-${t.no}-${t.majorVer}`} color={t.type === 9 ? 'purple' : 'geekblue'}>
                {templateLabel(t)}
              </Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">ຍັງບໍ່ມີ — ໃຫ້ພະນັກງານລົງໃບໜ້າ/ນິ້ວມືຢູ່ເຄື່ອງສະແກນ</Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label="ຢູ່ໃນເຄື່ອງສະແກນ">
        <Space direction="vertical" size={4}>
          {(status?.devices ?? []).map((d) => (
            <Space key={d.serialNumber} wrap size={4}>
              <Typography.Text>
                {d.serialNumber}
                {d.deviceName ? ` (${d.deviceName})` : ''}
              </Typography.Text>
              {d.enrolled ? <Tag color="green">ມີ</Tag> : <Tag>ບໍ່ພົບ</Tag>}
              {d.syncEnabled && <Tag color="blue">ຊິງ</Tag>}
              {!d.allowed && <Tag color="orange">ບໍ່ມີສິດໃຊ້ເຄື່ອງນີ້</Tag>}
              {d.reportedAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ດຶງລ່າສຸດ {dayjs(d.reportedAt).format('DD/MM/YYYY HH:mm')}
                </Typography.Text>
              )}
            </Space>
          ))}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ອີງຕາມການດຶງຂໍ້ມູນຈາກເຄື່ອງຄັ້ງລ່າສຸດ (ໜ້າ ເຄື່ອງສະແກນ)
          </Typography.Text>
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="ຄຳສັ່ງທີ່ລໍຖ້າເຄື່ອງ">
        <Space wrap>
          <Typography.Text>{status?.pendingCommands ?? 0}</Typography.Text>
          {isAdmin && employee.status === 'active' && (
            <Button size="small" icon={<CloudUploadOutlined />} loading={pushing} onClick={push}>
              ສົ່ງໄປເຄື່ອງສະແກນ
            </Button>
          )}
        </Space>
      </Descriptions.Item>
    </Descriptions>
  );
};
