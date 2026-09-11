import React, { createContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/lo';
import { loLA } from '../locales/lo_LA';
import { palette, surface } from '../theme/palette';

dayjs.locale('lo');

type ColorMode = 'light' | 'dark';

interface ColorModeContextType {
  mode: ColorMode;
  setMode: () => void;
}

export const ColorModeContext = createContext<ColorModeContextType>({
  mode: 'light',
  setMode: () => undefined,
});

const STORAGE_KEY = 'hr_color_mode';

export const ColorModeContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [mode, setModeState] = useState<ColorMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.setProperty('--app-surface-bg', mode === 'dark' ? '#221D1A' : '#ffffff');
  }, [mode]);

  const setMode = () => {
    setModeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ColorModeContext.Provider value={{ mode, setMode }}>
      <ConfigProvider
        locale={loLA as any}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: palette.primary,
            colorSuccess: palette.success,
            colorWarning: palette.warning,
            colorError: palette.error,
            colorInfo: palette.info,
            colorBgLayout: mode === 'dark' ? surface.dark : surface.light,
            borderRadius: 8,
            borderRadiusLG: 12,
            fontFamily:
              "'Noto Sans Lao', 'Phetsarath OT', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
          components: {
            Card: {
              borderRadiusLG: 14,
              boxShadowTertiary:
                mode === 'dark'
                  ? '0 2px 10px rgba(0,0,0,0.35)'
                  : '0 2px 10px rgba(41,23,15,0.06), 0 1px 2px rgba(41,23,15,0.04)',
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
