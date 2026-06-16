/**
 * BottomBar — 阅读器底部工具栏。
 *
 * 设计方向：精炼极简的「阅读指令面板」
 * - 半透明玻璃质感，与 TopBar 风格统一
 * - 横向排列工具按钮：图标在上，标签在下
 * - 当前按钮：目录、设置，预留书签和搜索位
 * - 每个按钮最小 44px 触摸区域，适合拇指操作
 */

import React from 'react';
import { useUIStore } from '@store/uiStore';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

/** 底部工具栏按钮配置 */
interface ToolButton {
  /** 唯一标识 */
  id: string;
  /** 按钮下方标签文字 */
  label: string;
  /** SVG 图标路径（24x24 viewBox） */
  icon: React.ReactNode;
  /** 点击回调 */
  onClick: () => void;
}

export const BottomBar: React.FC = () => {
  const { setShowToc, setShowSettings } = useUIStore();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  const iconColor = colors['ui-text'];

  /** 工具按钮配置数组，未来只需在此数组中新增条目即可扩展 */
  const tools: ToolButton[] = [
    {
      id: 'toc',
      label: '目录',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke={iconColor} strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"
        >
          {/* 三条横线 + 右侧圆点 */}
          <line x1="4" y1="5" x2="20" y2="5" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="19" x2="20" y2="19" />
        </svg>
      ),
      onClick: () => setShowToc(true),
    },
    {
      id: 'settings',
      label: '设置',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke={iconColor} strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"
        >
          {/* 齿轮图标 */}
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
      onClick: () => setShowSettings(true),
    },
    // 预留扩展位（无实际操作）
    {
      id: 'bookmark',
      label: '书签',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke={iconColor} strokeWidth="1.6" opacity="0.35"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
      onClick: () => {/* 未来实现 */},
    },
    {
      id: 'search',
      label: '搜索',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke={iconColor} strokeWidth="1.6" opacity="0.35"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      ),
      onClick: () => {/* 未来实现 */},
    },
  ];

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      // 玻璃质感背景
      background: colors['ui-background'] + 'CC',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: `1px solid ${colors['ui-border']}40`,
    }}>
      {/* ── 工具按钮行 ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-evenly',
        alignItems: 'flex-start',
        height: 56,
        paddingTop: 6,
      }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={tool.onClick}
            aria-label={tool.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              minWidth: 48,
              minHeight: 48,
              padding: '4px 8px',
              border: 'none',
              background: 'none',
              color: colors['ui-text'],
              cursor: 'pointer',
              borderRadius: 10,
              // 触摸反馈通过 :active 透明度变化
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* 图标 */}
            <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tool.icon}
            </div>
            {/* 标签文字 */}
            <span style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.03em',
              opacity: tool.id === 'bookmark' || tool.id === 'search' ? 0.35 : 0.75,
              lineHeight: '14px',
            }}>
              {tool.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
