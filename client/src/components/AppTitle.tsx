import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { ColorModeContext } from '../contexts/color-mode';

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
      <img src="/logo.png" alt="ROMEO" style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }} />
      {!collapsed && (
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', color: textColor }}>ROMEO</span>
      )}
    </Link>
  );
};
