import { useState } from 'react';
import { useCustom, useGetIdentity, useNotification } from '@refinedev/core';
import { Descriptions, Tag, Typography, Button, Popconfirm } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, Identity } from '../types';
import { API_URL, axiosInstance } from '../providers/axios';

interface AppAccount {
  status: 'none' | 'active' | 'reset';
  isActive: boolean | null;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
}

const STATUS: Record<AppAccount['status'], { color: string; label: string }> = {
  none: { color: 'default', label: 'ຍັງບໍ່ໄດ້ສ້າງບັນຊີ' },
  active: { color: 'green', label: 'ໃຊ້ງານໄດ້' },
  reset: { color: 'orange', label: 'ຣີເຊັດແລ້ວ — ລໍຖ້າພະນັກງານຕັ້ງລະຫັດໃໝ່' },
};

const formatTime = (value: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-');

// The employee's own account for the ROMEO app (/me): they create it
// themselves with their employee code and the phone number on file here, so
// HR only sees where it stands and resets a forgotten password — after which
// they set a new one the same way. Admins/managers see it; only admins reset.
export const EmployeeAppAccountSection: React.FC<{ employee?: Employee }> = ({ employee }) => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();
  const canView = identity?.role === 'admin' || identity?.role === 'manager';
  const isAdmin = identity?.role === 'admin';

  const { data, isLoading, refetch } = useCustom<AppAccount>({
    url: `${API_URL}/employee-accounts/${employee?._id}`,
    method: 'get',
    queryOptions: { enabled: !!employee?._id && canView },
  });
  const account = data?.data;

  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    if (!employee) return;
    setResetting(true);
    try {
      await axiosInstance.post(`${API_URL}/employee-accounts/${employee._id}/reset`, {});
      notify?.({ type: 'success', message: 'ຣີເຊັດແລ້ວ — ໃຫ້ພະນັກງານກົດ "ຕັ້ງລະຫັດຜ່ານ" ໃນແອັບ ແລ້ວໃສ່ລະຫັດພະນັກງານ ແລະ ເບີໂທ' });
      refetch();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຣີເຊັດບໍ່ສຳເລັດ' });
    } finally {
      setResetting(false);
    }
  };

  if (!canView || !employee) return null;

  return (
    <Descriptions bordered column={1} size="middle">
      <Descriptions.Item label="ສະຖານະບັນຊີ">
        {isLoading || !account ? '-' : <Tag color={STATUS[account.status].color}>{STATUS[account.status].label}</Tag>}
        {account?.isActive === false && <Tag color="red">ປິດແລ້ວ</Tag>}
      </Descriptions.Item>
      <Descriptions.Item label="ເຂົ້າລະບົບດ້ວຍ">
        ລະຫັດພະນັກງານ <Typography.Text strong>{employee.employeeCode ?? '-'}</Typography.Text> + ລະຫັດຜ່ານທີ່ພະນັກງານຕັ້ງເອງ
        {!employee.phone && (
          <Typography.Text type="danger" style={{ display: 'block' }}>
            ຍັງບໍ່ມີເບີໂທ — ພະນັກງານຈະຕັ້ງລະຫັດຜ່ານບໍ່ໄດ້ ຈົນກວ່າຈະໃສ່ເບີໂທໃຫ້
          </Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label="ຕັ້ງລະຫັດຜ່ານເມື່ອ">{formatTime(account?.passwordSetAt ?? null)}</Descriptions.Item>
      <Descriptions.Item label="ເຂົ້າລະບົບຫຼ້າສຸດ">{formatTime(account?.lastLoginAt ?? null)}</Descriptions.Item>
      {isAdmin && account?.status === 'active' && (
        <Descriptions.Item label="ລືມລະຫັດຜ່ານ">
          <Popconfirm
            title="ຣີເຊັດລະຫັດຜ່ານ?"
            description="ພະນັກງານຈະຖືກອອກຈາກລະບົບ ແລະ ຕ້ອງຕັ້ງລະຫັດໃໝ່ດ້ວຍລະຫັດພະນັກງານ + ເບີໂທ"
            okText="ຣີເຊັດ"
            cancelText="ຍົກເລີກ"
            onConfirm={reset}
          >
            <Button icon={<ReloadOutlined />} loading={resetting}>
              ຣີເຊັດລະຫັດຜ່ານ
            </Button>
          </Popconfirm>
        </Descriptions.Item>
      )}
    </Descriptions>
  );
};
