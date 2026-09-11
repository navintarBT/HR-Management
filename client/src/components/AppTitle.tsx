import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { ClockCircleOutlined } from '@ant-design/icons';
import { ColorModeContext } from '../contexts/color-mode';
import { palette } from '../theme/palette';

export const AppTitle: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { mode } = useContext(ColorModeContext);
  const textColor = mode === 'dark' ? '#fff' : '#101828';

  return (
    <Link
      to="/"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '16px',
        color: textColor,
        textDecoration: 'none',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: palette.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          flexShrink: 0,
          color: '#fff',
        }}
      >
        <ClockCircleOutlined />
      </div>
      {!collapsed && (
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', color: textColor }}>HR &amp; ລົງເວລາ</span>
      )}
    </Link>
  );
};
