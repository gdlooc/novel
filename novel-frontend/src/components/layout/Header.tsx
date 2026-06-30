/**
 * Header — 顶部导航栏。
 *
 * 提供：
 * - 应用标题/Logo（点击返回首页）
 * - 搜索入口（点击跳转搜索页）
 * - 响应式设计（移动端精简）
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export const Header: React.FC = () => {
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      height: 48,
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingLeft: 16,
      paddingRight: 16,
      background: colors['ui-background'] + 'EE',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${colors['ui-border']}40`,
      flexShrink: 0,
      zIndex: 50,
    }}>
      {/* Logo / 首页入口 */}
      <button
        onClick={() => navigate('/')}
        aria-label="首页"
        style={{
          background: 'none',
          border: 'none',
          fontSize: 18,
          fontWeight: 700,
          color: colors['ui-text'],
          cursor: 'pointer',
          padding: 0,
          marginRight: 16,
          letterSpacing: '-0.02em',
        }}
      >
        📖 轻小说
      </button>

      {/* 中间占位 */}
      <div style={{ flex: 1 }} />

      {/* 搜索入口 */}
      <button
        onClick={() => navigate('/search')}
        aria-label="搜索"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          border: `1px solid ${colors['ui-border']}`,
          borderRadius: 20,
          background: colors['ui-background-secondary'],
          color: colors['ui-text-secondary'],
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={colors['ui-text-secondary']} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        搜索
      </button>
    </header>
  );
};
