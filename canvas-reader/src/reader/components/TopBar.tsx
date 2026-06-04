/**
 * TopBar — Top navigation bar with book info and actions.
 *
 * Shows:
 * - Back button (← 返回)
 * - Book title
 * - Fullscreen toggle
 */

import React from 'react';
import { useReaderStore } from '@store/readerStore';
import { useUIStore } from '@store/uiStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useSettingsStore } from '@store/settingsStore';

interface TopBarProps {
  onBack?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onBack }) => {
  const bookMetadata = useReaderStore((s) => s.bookMetadata);
  const theme = useSettingsStore((s) => s.theme);
  const { isFullscreen, setShowSettings, toggleFullscreen } = useUIStore();

  const themeColors = getThemeById(theme);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        padding: '0 12px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: themeColors.cssVariables['ui-background'],
        borderBottom: `1px solid ${themeColors.cssVariables['ui-border']}`,
        color: themeColors.cssVariables['ui-text'],
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: themeColors.cssVariables['ui-accent'],
          fontSize: 16,
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>←</span>
        <span>返回</span>
      </button>

      {/* Title */}
      <div
        style={{
          flex: 1,
          textAlign: 'center',
          fontSize: 15,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0 8px',
        }}
      >
        {bookMetadata?.title || 'Canvas Reader'}
      </div>

      {/* Right actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        <IconButton
          title="设置"
          onClick={() => setShowSettings(true)}
          themeColors={themeColors.cssVariables}
        >
          ⚙
        </IconButton>
        <IconButton
          title={isFullscreen ? '退出全屏' : '全屏'}
          onClick={toggleFullscreen}
          themeColors={themeColors.cssVariables}
        >
          {isFullscreen ? '⤓' : '⤢'}
        </IconButton>
      </div>
    </div>
  );
};

/** Simple icon button */
const IconButton: React.FC<{
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  themeColors: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
}> = ({ title, onClick, children, themeColors }) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      background: 'none',
      border: 'none',
      color: themeColors['ui-text'],
      fontSize: 20,
      padding: 8,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      borderRadius: 6,
    }}
  >
    {children}
  </button>
);
