import { useContext } from 'react';
import { useGetIdentity } from '@refinedev/core';
import { Layout, Space, Switch, Avatar, Typography, Tag } from 'antd';
import { MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { ColorModeContext } from '../contexts/color-mode';
import { palette } from '../theme/palette';
import type { Identity, Role } from '../types';

const roleLabel: Record<Role, string> = {
  admin: 'ຜູ້ດູແລລະບົບ',
  manager: 'ຜູ້ຈັດການ',
  employee: 'ພະນັກງານ',
};

const roleColor: Record<Role, string> = {
  admin: 'red',
  manager: 'blue',
  employee: 'green',
};

export const AppHeader: React.FC = () => {
  const { mode, setMode } = useContext(ColorModeContext);
  const { data: identity } = useGetIdentity<Identity>();

  const isDark = mode === 'dark';

  return (
    <Layout.Header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 24px',
        height: 64,
        lineHeight: '64px',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: isDark ? '#2A2320' : '#ffffff',
        borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(5, 5, 5, 0.06)',
      }}
    >
      <Switch
        checked={isDark}
        onChange={setMode}
        checkedChildren={<MoonOutlined />}
        unCheckedChildren={<SunOutlined />}
      />
      {identity && (
        <Space size={10} align="center">
          <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: palette.primary, flexShrink: 0 }} />
          <Typography.Text strong style={{ lineHeight: 1, color: isDark ? 'rgba(255,255,255,0.85)' : undefined }}>
            {identity.employee ? `${identity.employee.firstName} ${identity.employee.lastName}` : identity.email}
          </Typography.Text>
          <Tag color={roleColor[identity.role]} style={{ marginRight: 0, lineHeight: '20px' }}>
            {roleLabel[identity.role]}
          </Tag>
        </Space>
      )}
    </Layout.Header>
  );
};
