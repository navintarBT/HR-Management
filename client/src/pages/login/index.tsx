import { useLogin } from '@refinedev/core';
import { Button, Card, Form, Input, Typography, Alert, Space, Divider } from 'antd';
import { LockOutlined, MailOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { palette, loginGradient } from '../../theme/palette';

interface LoginVariables {
  email: string;
  password: string;
}

const demoAccounts = [
  { role: 'ຜູ້ດູແລລະບົບ (admin)', email: 'admin@hr-demo.local', password: 'Admin@123' },
  { role: 'ຜູ້ຈັດການ (manager)', email: 'manager@hr-demo.local', password: 'Manager@123' },
  { role: 'ພະນັກງານ (employee)', email: 'employee@hr-demo.local', password: 'Employee@123' },
];

export const LoginPage: React.FC = () => {
  const { mutate: login, isLoading } = useLogin<LoginVariables>();
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<LoginVariables>();

  const fillDemo = (email: string, password: string) => {
    form.setFieldsValue({ email, password });
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
          <Space align="center" size={12} style={{ marginBottom: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: palette.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
              }}
            >
              <ClockCircleOutlined />
            </div>
            <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
              HR &amp; ລົງເວລາ
            </Typography.Title>
          </Space>
          <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16 }}>
            ລະບົບບໍລິຫານງານບຸກຄະລາກອນ ລົງເວລາເຂົ້າ-ອອກງານ ແລະ ຈັດການວັນລາ ຄົບໃນບ່ອນດຽວ
          </Typography.Paragraph>
          <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.55)' }}>
            ເດໂມ: ລອງເຂົ້າສູ່ລະບົບດ້ວຍບັນຊີຕົວຢ່າງທາງຂວາ ແລ້ວສໍາຫຼວດແດຊບອດ ການລົງເວລາ ແລະ ການລາໄດ້ທັນທີ
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
            initialValues={{ email: 'admin@hr-demo.local', password: 'Admin@123' }}
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

          <Divider plain style={{ fontSize: 12, color: '#999' }}>
            ບັນຊີສໍາລັບທົດລອງໃຊ້
          </Divider>

          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {demoAccounts.map((acc) => (
              <Button
                key={acc.email}
                block
                onClick={() => fillDemo(acc.email, acc.password)}
                style={{ textAlign: 'left', height: 'auto', padding: '8px 12px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{acc.role}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {acc.email}
                  </Typography.Text>
                </div>
              </Button>
            ))}
          </Space>
        </Card>
      </div>
    </div>
  );
};
