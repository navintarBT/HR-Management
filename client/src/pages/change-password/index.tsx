import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@refinedev/core';
import { Button, Card, Form, Input, Typography, Alert } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { axiosInstance, API_URL } from '../../providers/axios';
import { loginGradient } from '../../theme/palette';

interface ChangePasswordVariables {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const ChangePasswordPage: React.FC = () => {
  const [form] = Form.useForm<ChangePasswordVariables>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { open: notify } = useNotification();

  const onFinish = async (values: ChangePasswordVariables) => {
    setError(null);
    setLoading(true);
    try {
      await axiosInstance.post(`${API_URL}/auth/change-password`, {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      const raw = localStorage.getItem('hr_identity');
      if (raw) {
        const identity = JSON.parse(raw);
        identity.mustChangePassword = false;
        localStorage.setItem('hr_identity', JSON.stringify(identity));
      }

      notify?.({ type: 'success', message: 'ປ່ຽນລະຫັດຜ່ານສໍາເລັດແລ້ວ' });
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'ປ່ຽນລະຫັດຜ່ານບໍ່ສໍາເລັດ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: loginGradient,
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420, borderRadius: 16 }} styles={{ body: { padding: 32 } }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          ຕ້ອງປ່ຽນລະຫັດຜ່ານ
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          ນີ້ແມ່ນການເຂົ້າສູ່ລະບົບຄັ້ງທໍາອິດ ກະລຸນາຕັ້ງລະຫັດຜ່ານໃໝ່ກ່ອນນໍາໃຊ້ລະບົບຕໍ່
        </Typography.Paragraph>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} closable onClose={() => setError(null)} />}

        <Form form={form} layout="vertical" requiredMark={false} onFinish={onFinish}>
          <Form.Item
            name="currentPassword"
            label="ລະຫັດຜ່ານປັດຈຸບັນ"
            rules={[{ required: true, message: 'ກະລຸນາປ້ອນລະຫັດຜ່ານປັດຈຸບັນ' }]}
          >
            <Input.Password prefix={<LockOutlined />} size="large" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="ລະຫັດຜ່ານໃໝ່"
            rules={[
              { required: true, message: 'ກະລຸນາປ້ອນລະຫັດຜ່ານໃໝ່' },
              { min: 8, message: 'ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ' },
            ]}
            hasFeedback
          >
            <Input.Password prefix={<LockOutlined />} size="large" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="ຢືນຢັນລະຫັດຜ່ານໃໝ່"
            dependencies={['newPassword']}
            hasFeedback
            rules={[
              { required: true, message: 'ກະລຸນາຢືນຢັນລະຫັດຜ່ານໃໝ່' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('ລະຫັດຜ່ານບໍ່ກົງກັນ'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            ບັນທຶກລະຫັດຜ່ານໃໝ່
          </Button>
        </Form>
      </Card>
    </div>
  );
};
