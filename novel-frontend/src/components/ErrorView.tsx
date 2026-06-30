/**
 * ErrorView — 通用错误提示组件。
 *
 * @param message - 错误信息
 * @param onRetry - 重试回调（可选）
 * @param onBack - 返回回调（可选）
 */

import React from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export interface ErrorViewProps {
  message?: string;
  onRetry?: () => void;
  onBack?: () => void;
}

export const ErrorView: React.FC<ErrorViewProps> = ({
  message = '出错了',
  onRetry,
  onBack,
}) => {
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: colors['ui-background'],
      color: colors['ui-text'],
    }}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>😞</div>
        <div style={{
          fontSize: 15,
          color: colors['ui-text-secondary'],
          marginBottom: 20,
        }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: 8,
                background: colors['ui-accent'],
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              style={{
                padding: '8px 20px',
                border: `1px solid ${colors['ui-border']}`,
                borderRadius: 8,
                background: 'transparent',
                color: colors['ui-text'],
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              返回
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
