import { useState } from 'react';
import { useCustom, useGetIdentity, useNotification } from '@refinedev/core';
import { Descriptions, Tag, Typography, Button, Popconfirm, Modal, Form, Input, Alert, Space, Tooltip } from 'antd';
import { ReloadOutlined, EditOutlined, ThunderboltOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined, HistoryOutlined } from '@ant-design/icons';
import { AppDayHistory } from './AppDayHistory';
import dayjs from 'dayjs';
import type { Employee, Identity } from '../types';
import { API_URL, axiosInstance } from '../providers/axios';

export interface AppAccount {
  status: 'none' | 'active' | 'reset';
  username: string | null;
  // The employee code typed at registration — differs from the code the
  // account belongs to only after an admin moved it (shown in red).
  registeredCode: string | null;
  isActive: boolean | null;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  evidenceCount: number;
  // Sent to admins only (absent for anyone else): the password, or null when
  // it isn't known yet — registered before 22/11/2026 and not signed in since.
  password?: string | null;
}

export const APP_ACCOUNT_STATUS: Record<AppAccount['status'], { color: string; label: string }> = {
  none: { color: 'default', label: 'ຍັງບໍ່ໄດ້ລົງທະບຽນ' },
  active: { color: 'green', label: 'ໃຊ້ງານໄດ້' },
  reset: { color: 'orange', label: 'ຣີເຊັດແລ້ວ — ລໍຖ້າພະນັກງານລົງທະບຽນໃໝ່' },
};

export const formatAccountTime = (value: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-');

// Same rules as the server (utils/accounts.js).
const USERNAME_RULE = /^[a-z][a-z0-9._-]{2,29}$/;
const MIN_PASSWORD = 6;

// Easy to read out and type on a phone: no 0/o, 1/l/i.
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => chars[n % chars.length]).join('');
}

// The password for an admin: hidden until the eye is clicked (or `reveal`).
export const AppPassword: React.FC<{ account: AppAccount; reveal?: boolean }> = ({ account, reveal }) => {
  const [shown, setShown] = useState(false);
  if (account.password === undefined) return null;
  if (!account.password) {
    if (account.status !== 'active') return <Typography.Text type="secondary">-</Typography.Text>;
    return (
      <Tooltip title="ລົງທະບຽນກ່ອນມີການເກັບລະຫັດ — ຈະເຫັນເມື່ອພະນັກງານເຂົ້າລະບົບຄັ້ງຕໍ່ໄປ, ຫຼື ກົດ ແກ້ໄຂ ເພື່ອຕັ້ງລະຫັດໃໝ່">
        <Typography.Text type="secondary" className="app-password-unknown">
          ຍັງບໍ່ຮູ້
        </Typography.Text>
      </Tooltip>
    );
  }
  const visible = reveal || shown;
  return (
    <Space size={2} className="app-password">
      {visible ? (
        <Typography.Text code copyable={{ text: account.password, tooltips: ['ກັອບປີ້', 'ກັອບປີ້ແລ້ວ'] }} className="app-password-text">
          {account.password}
        </Typography.Text>
      ) : (
        <Typography.Text className="app-password-hidden">••••••</Typography.Text>
      )}
      {!reveal && (
        <Button
          type="text"
          size="small"
          aria-label={visible ? 'ເຊື່ອງລະຫັດຜ່ານ' : 'ເບິ່ງລະຫັດຜ່ານ'}
          icon={visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => setShown(!visible)}
        />
      )}
    </Space>
  );
};

// Registered with an ID other than the employee's own code (an account an
// admin moved): red, with both codes on hover.
export const idMismatch = (account: Pick<AppAccount, 'status' | 'registeredCode'>, ownCode?: string | null) =>
  account.status !== 'none' && !!account.registeredCode && account.registeredCode !== (ownCode ?? '');

export const RegisteredId: React.FC<{ account: AppAccount; ownCode?: string | null }> = ({ account, ownCode }) => {
  if (account.status === 'none' || !account.registeredCode) return <Typography.Text type="secondary">-</Typography.Text>;
  if (!idMismatch(account, ownCode)) {
    return (
      <Typography.Text strong copyable className="registered-id">
        {account.registeredCode}
      </Typography.Text>
    );
  }
  return (
    <Tooltip title={`ລົງທະບຽນດ້ວຍ ID ${account.registeredCode} ແຕ່ບັນຊີນີ້ເປັນຂອງລະຫັດ ${ownCode ?? '-'} ໃນລະບົບ — ກວດເບິ່ງວ່າຖືກຄົນ`}>
      <Tag color="red" className="registered-id registered-id-mismatch">
        {account.registeredCode} ≠ {ownCode ?? '-'}
      </Tag>
    </Tooltip>
  );
};

export interface AccountOwner {
  _id: string;
  employeeCode?: string | null;
  name: string;
}

interface SaveResult extends AppAccount {
  employeeId: string;
  employeeCode: string;
  movedEvidence: number;
}

// An admin edits an employee's app account: the username, a new password
// (shown when saved, to pass on — and readable later on ບັນຊີແອັບພະນັກງານ), or
// the employee code it belongs to (the photos sent through it move along).
// With no account yet, a username and a password make one.
export const AppAccountEditModal: React.FC<{
  owner: AccountOwner | null;
  account: AppAccount | null;
  onClose: () => void;
  onSaved: (result: SaveResult) => void;
}> = ({ owner, account, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const { open: notify } = useNotification();
  const [saving, setSaving] = useState(false);
  const [modal, modalContext] = Modal.useModal();
  const hasAccount = !!account && account.status !== 'none';

  const showLogin = (result: SaveResult, username: string, password: string) => {
    const details = `ຊື່ຜູ້ໃຊ້: ${username}\nລະຫັດພະນັກງານ: ${result.employeeCode}\nລະຫັດຜ່ານ: ${password}`;
    modal.success({
      title: 'ບັນທຶກແລ້ວ — ສົ່ງຂໍ້ມູນເຂົ້າລະບົບນີ້ໃຫ້ພະນັກງານ',
      width: 440,
      content: (
        <Space direction="vertical" style={{ width: '100%' }} className="app-account-login">
          <Typography.Paragraph style={{ whiteSpace: 'pre-line', fontSize: 16, marginBottom: 0 }} strong>
            {details}
          </Typography.Paragraph>
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              void navigator.clipboard?.writeText(details);
              notify?.({ type: 'success', message: 'ກັອບປີ້ແລ້ວ' });
            }}
          >
            ກັອບປີ້
          </Button>
          <Typography.Text type="secondary">ເບິ່ງລະຫັດນີ້ຄືນໄດ້ທີ່ ບັນຊີແອັບພະນັກງານ. ພະນັກງານຈະຖືກອອກຈາກລະບົບໃນເຄື່ອງເກົ່າ.</Typography.Text>
        </Space>
      ),
      okText: 'ປິດ',
    });
  };

  const submit = async () => {
    if (!owner) return;
    const values = await form.validateFields();
    const username = (values.username ?? '').trim().toLowerCase();
    const password = values.password ?? '';
    const employeeCode = (values.employeeCode ?? '').trim();
    const body: Record<string, string> = {};
    if (username && username !== (account?.username ?? '')) body.username = username;
    if (password) body.password = password;
    if (hasAccount && employeeCode && employeeCode !== (owner.employeeCode ?? '')) body.employeeCode = employeeCode;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const { data } = await axiosInstance.patch<SaveResult>(`${API_URL}/employee-accounts/${owner._id}`, body);
      onSaved(data);
      onClose();
      if (body.employeeCode) {
        notify?.({
          type: 'success',
          message: `ຍ້າຍບັນຊີໄປລະຫັດ ${data.employeeCode} ແລ້ວ${data.movedEvidence ? ` ພ້ອມຮູບຫຼັກຖານ ${data.movedEvidence} ຮູບ` : ''}`,
          description: `ລະຫັດ ${owner.employeeCode ?? '-'} ລົງທະບຽນໃໝ່ໄດ້ແລ້ວ`,
        });
      }
      if (password) showLogin(data, data.username ?? username, password);
      else if (!body.employeeCode) notify?.({ type: 'success', message: 'ບັນທຶກແລ້ວ' });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {modalContext}
      <Modal
        open={!!owner}
        title={`${hasAccount ? 'ແກ້ໄຂບັນຊີແອັບ' : 'ສ້າງບັນຊີແອັບ'} — ${owner?.employeeCode ?? '-'} ${owner?.name ?? ''}`}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
        confirmLoading={saving}
        onOk={submit}
        onCancel={onClose}
        destroyOnClose
        className="app-account-edit"
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{ username: account?.username ?? '', password: '', employeeCode: owner?.employeeCode ?? '' }}
        >
          <Form.Item
            label="ຊື່ຜູ້ໃຊ້ (ພາສາອັງກິດ)"
            name="username"
            normalize={(v: string) => (v ?? '').toLowerCase().replace(/\s/g, '')}
            rules={[
              { required: !hasAccount || !!account?.username, message: 'ກະລຸນາປ້ອນຊື່ຜູ້ໃຊ້' },
              { pattern: USERNAME_RULE, message: 'ຕົວອັກສອນອັງກິດ ຫຼື ຕົວເລກ 3–30 ໂຕ ຂຶ້ນຕົ້ນດ້ວຍຕົວອັກສອນ — ຕົວຢ່າງ: somphone' },
            ]}
          >
            <Input maxLength={30} autoComplete="off" placeholder="ຕົວຢ່າງ: somphone" />
          </Form.Item>
          <Form.Item
            label={hasAccount ? 'ລະຫັດຜ່ານໃໝ່' : 'ລະຫັດຜ່ານ'}
            extra={
              hasAccount ? (
                <span className="app-account-current">
                  {account?.password ? (
                    <>
                      ລະຫັດປັດຈຸບັນ: <Typography.Text code>{account.password}</Typography.Text> ·{' '}
                    </>
                  ) : null}
                  ປ່ອຍວ່າງ = ບໍ່ປ່ຽນ
                </span>
              ) : undefined
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="password"
                noStyle
                rules={[
                  { required: !hasAccount, message: 'ກະລຸນາປ້ອນລະຫັດຜ່ານ' },
                  { min: MIN_PASSWORD, message: `ຢ່າງໜ້ອຍ ${MIN_PASSWORD} ຕົວ` },
                ]}
              >
                <Input autoComplete="new-password" placeholder={`ຢ່າງໜ້ອຍ ${MIN_PASSWORD} ຕົວ`} />
              </Form.Item>
              <Button icon={<ThunderboltOutlined />} onClick={() => form.setFieldsValue({ password: randomPassword() })}>
                ສຸ່ມລະຫັດ
              </Button>
            </Space.Compact>
          </Form.Item>
          {hasAccount && (
            <Form.Item
              label="ລະຫັດພະນັກງານທີ່ຜູກກັບບັນຊີນີ້"
              name="employeeCode"
              normalize={(v: string) => (v ?? '').replace(/\D/g, '')}
              rules={[{ required: true, message: 'ກະລຸນາປ້ອນລະຫັດພະນັກງານ' }]}
            >
              <Input inputMode="numeric" maxLength={12} />
            </Form.Item>
          )}
          <Form.Item noStyle shouldUpdate>
            {() => {
              const code = (form.getFieldValue('employeeCode') ?? '').trim();
              if (!hasAccount || !code || code === (owner?.employeeCode ?? '')) return null;
              return (
                <Alert
                  type="warning"
                  showIcon
                  className="app-account-move"
                  message={`ຈະຍ້າຍບັນຊີນີ້ໄປເປັນຂອງລະຫັດ ${code}`}
                  description={`${account?.evidenceCount ? `ຮູບຫຼັກຖານ ${account.evidenceCount} ຮູບ ທີ່ສົ່ງຜ່ານບັນຊີນີ້ຈະຍ້າຍໄປນຳ. ` : ''}ລະຫັດ ${owner?.employeeCode ?? '-'} ຈະລົງທະບຽນໃໝ່ໄດ້. ພະນັກງານຈະຖືກອອກຈາກລະບົບ ແລະ ຕ້ອງເຂົ້າໃໝ່.`}
                />
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// The employee's own account for the ROMEO app (/me): they register it
// themselves with a username, their employee code and a password, so HR sees
// where it stands (and which username took the code — nothing else is checked
// at registration) and resets a forgotten password, after which they register
// again the same way. Admins can also edit it (AppAccountEditModal).
// Admins/managers see it; only admins change it.
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
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    if (!employee) return;
    setResetting(true);
    try {
      await axiosInstance.post(`${API_URL}/employee-accounts/${employee._id}/reset`, {});
      notify?.({ type: 'success', message: 'ຣີເຊັດແລ້ວ — ໃຫ້ພະນັກງານກົດ "ລົງທະບຽນ" ໃນແອັບອີກຄັ້ງ' });
      refetch();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຣີເຊັດບໍ່ສຳເລັດ' });
    } finally {
      setResetting(false);
    }
  };

  if (!canView || !employee) return null;

  return (
    <>
      <Descriptions bordered column={1} size="middle" className="app-account-section">
        <Descriptions.Item label="ສະຖານະບັນຊີ">
          {isLoading || !account ? '-' : <Tag color={APP_ACCOUNT_STATUS[account.status].color}>{APP_ACCOUNT_STATUS[account.status].label}</Tag>}
          {account?.isActive === false && <Tag color="red">ປິດແລ້ວ</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="ເຂົ້າລະບົບດ້ວຍ">
          {account?.username ? (
            <>
              ຊື່ຜູ້ໃຊ້ <Typography.Text strong>{account.username}</Typography.Text> ຫຼື{' '}
            </>
          ) : null}
          ລະຫັດພະນັກງານ <Typography.Text strong>{employee.employeeCode ?? '-'}</Typography.Text> + ລະຫັດຜ່ານ
        </Descriptions.Item>
        {account && account.status !== 'none' && (
          <Descriptions.Item label="ID ທີ່ລົງທະບຽນ">
            <RegisteredId account={account} ownCode={employee.employeeCode} />
          </Descriptions.Item>
        )}
        {account && account.password !== undefined && account.status !== 'none' && (
          <Descriptions.Item label="ລະຫັດຜ່ານ">
            <AppPassword account={account} />
          </Descriptions.Item>
        )}
        <Descriptions.Item label="ຕັ້ງລະຫັດຜ່ານເມື່ອ">{formatAccountTime(account?.passwordSetAt ?? null)}</Descriptions.Item>
        <Descriptions.Item label="ເຂົ້າລະບົບຫຼ້າສຸດ">{formatAccountTime(account?.lastLoginAt ?? null)}</Descriptions.Item>
        <Descriptions.Item label="ປະຫວັດລາຍວັນ">
          <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(true)} className="open-history">
            ເບິ່ງການສະແກນ ແລະ ຮູບຫຼັກຖານແຕ່ລະມື້
          </Button>
        </Descriptions.Item>
        {isAdmin && account && (
          <Descriptions.Item label="ຈັດການ">
            <Space wrap>
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {account.status === 'none' ? 'ສ້າງບັນຊີໃຫ້' : 'ແກ້ໄຂ ຊື່ຜູ້ໃຊ້ / ລະຫັດຜ່ານ / ລະຫັດພະນັກງານ'}
              </Button>
              {account.status === 'active' && (
                <Popconfirm
                  title="ຣີເຊັດລະຫັດຜ່ານ?"
                  description="ພະນັກງານຈະຖືກອອກຈາກລະບົບ ແລະ ຕ້ອງກົດ ລົງທະບຽນ ໃນແອັບອີກຄັ້ງ"
                  okText="ຣີເຊັດ"
                  cancelText="ຍົກເລີກ"
                  onConfirm={reset}
                >
                  <Button icon={<ReloadOutlined />} loading={resetting}>
                    ຣີເຊັດລະຫັດຜ່ານ
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>
      <AppAccountEditModal
        owner={editing ? { _id: employee._id, employeeCode: employee.employeeCode, name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() } : null}
        account={account ?? null}
        onClose={() => setEditing(false)}
        onSaved={() => refetch()}
      />
      <AppDayHistory
        person={showHistory ? { _id: employee._id, employeeCode: employee.employeeCode, name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() } : null}
        onClose={() => setShowHistory(false)}
      />
    </>
  );
};
