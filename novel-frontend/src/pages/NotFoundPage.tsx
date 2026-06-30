/**
 * NotFoundPage — 404 页面。
 *
 * 当用户访问不存在的路由时显示。
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
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
        <div style={{ fontSize: 64, marginBottom: 12 }}>📖</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
          404
        </h1>
        <p style={{
          fontSize: 14,
          color: colors['ui-text-secondary'],
          margin: '0 0 20px',
        }}>
          页面不存在
        </p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 28px',
            border: 'none',
            borderRadius: 10,
            background: colors['ui-accent'],
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          返回首页
        </button>
      </div>
    </div>
  );
};
