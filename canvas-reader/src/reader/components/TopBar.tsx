/**
 * TopBar — 阅读器顶部工具栏。
 *
 * 设计方向：精炼极简主义
 * - 半透明玻璃质感背景，不遮挡正文感知
 * - 左侧返回箭头，右侧留空（设置已移到底栏）
 * - 居中显示「分卷名 · 章节名」
 * - 仅在用户点击屏幕中央时浮现/隐藏
 */

import React from 'react';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

interface TopBarProps {
  onBack?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onBack }) => {
  const chapterNav = useReaderStore((s) => s.chapterNav);
  const chapterTitle = useReaderStore((s) => s.chapterTitle);
  const chapterId = useReaderStore((s) => s.chapterId);
  const theme = useSettingsStore((s) => s.theme);

  const colors = getThemeById(theme).cssVariables;
  // 查找当前章节所属分卷名
  const volumeName = chapterId && chapterNav ? chapterNav.getVolumeName(chapterId) : undefined;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      height: 44,
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingLeft: 8,
      paddingRight: 8,
      // 玻璃质感：半透明背景 + 模糊
      background: colors['ui-background'] + 'CC', // 80% 不透明度
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${colors['ui-border']}40`,
      color: colors['ui-text'],
    }}>
      {/* ── 左侧：返回箭头 ── */}
      <button
        onClick={onBack}
        aria-label="返回"
        style={{
          background: 'none',
          border: 'none',
          color: colors['ui-text'],
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          borderRadius: 8,
          flexShrink: 0,
        }}
      >
        {/* 细线左箭头 SVG 图标 */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
          stroke={colors['ui-text']} strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M12 4 L6 10 L12 16" />
        </svg>
      </button>

      {/* ── 中间：分卷名 · 章节名 ── */}
      <div style={{
        flex: 1,
        textAlign: 'center',
        overflow: 'hidden',
        padding: '0 8px',
      }}>
        {volumeName ? (
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: '20px',
            color: colors['ui-text'],
            letterSpacing: '0.02em',
          }}>
            <span style={{ opacity: 0.6 }}>{volumeName}</span>
            <span style={{ opacity: 0.3, margin: '0 6px' }}>·</span>
            <span>{chapterTitle || ''}</span>
          </span>
        ) : (
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: '20px',
            color: colors['ui-text'],
          }}>
            {chapterTitle || ''}
          </span>
        )}
      </div>

      {/* ── 右侧占位（保持居中） ── */}
      <div style={{ width: 36, flexShrink: 0 }} />
    </div>
  );
};
