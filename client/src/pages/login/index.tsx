import { useLogin } from '@refinedev/core';
import { Button, Card, Form, Input, Typography, Alert } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { loginGradient } from '../../theme/palette';

interface LoginVariables {
  email: string;
  password: string;
}

export const LoginPage: React.FC = () => {
  const { mutate: login, isLoading } = useLogin<LoginVariables>();
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<LoginVariables>();

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
      <div style={{ width: '100%', maxWidth: 920, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '1 1 320px',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 0 }}>
            <img src="/logo.png" alt="ROMEO" style={{ width: 200, maxWidth: '100%', height: 'auto' }} />
            <Typography.Title level={3} style={{ color: '#fff', margin: '12px 0 0' }}>
              ລະບົບຈັດການພະນັກງານ ROMEO
            </Typography.Title>
          </div>
          <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16, margin: 0 }}>
            ລະບົບບໍລິຫານບຸກຄະລາກອນROMEO ລົງເວລາເຂົ້າ-ອອກວຽກ ແລະ ຈັດການວັນລາ ຄົບຈົບໃນລະບົບດຽວ
          </Typography.Paragraph>
        </div>

        <Card style={{ flex: '1 1 360px', borderRadius: 16 }} styles={{ body: { padding: 32 } }}>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            ເຂົ້າສູ່ລະບົບ
          </Typography.Title>

          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} closable onClose={() => setError(null)} />}

          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => {
              setError(null);
              login(values, {
                onError: (err: any) => setError(err?.message || 'ເຂົ້າສູ່ລະບົບບໍ່ສໍາເລັດ'),
              });
            }}
          >
            <Form.Item name="email" label="ອີເມວ" rules={[{ required: true, message: 'ກະລຸນາປ້ອນອີເມວ' }]}>
              <Input prefix={<MailOutlined />} size="large" placeholder="you@company.com" />
            </Form.Item>
            <Form.Item name="password" label="ລະຫັດຜ່ານ" rules={[{ required: true, message: 'ກະລຸນາປ້ອນລະຫັດຜ່ານ' }]}>
              <Input.Password prefix={<LockOutlined />} size="large" placeholder="••••••••" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={isLoading}>
              ເຂົ້າສູ່ລະບົບ
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
};
