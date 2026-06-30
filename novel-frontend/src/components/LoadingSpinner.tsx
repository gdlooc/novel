/**
 * LoadingSpinner — 通用加载指示器。
 *
 * @param message - 加载提示文字，默认"加载中..."
 * @param size - 旋转环大小（px），默认 32
 */

import React from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export interface LoadingSpinnerProps {
  message?: string;
  size?: number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = '加载中...',
  size = 32,
}) => {
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      color: colors['ui-text-secondary'],
    }}>
      <div style={{
        width: size,
        height: size,
        border: `3px solid ${colors['ui-border']}`,
        borderTopColor: colors['ui-accent'],
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        marginBottom: 12,
      }} />
      <div style={{ fontSize: 14 }}>{message}</div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
