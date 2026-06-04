/**
 * BottomBar — Bottom status bar showing chapter title and reading progress.
 */

import React from 'react';
import { useReaderStore, selectChapterTitle, selectChapterProgress } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export const BottomBar: React.FC = () => {
  const chapterTitle = useReaderStore(selectChapterTitle);
  const chapterProgress = useReaderStore(selectChapterProgress);
  const currentPageIndex = useReaderStore((s) => s.currentPageIndex);
  const totalPages = useReaderStore((s) => s.totalPagesInChapter);
  const theme = useSettingsStore((s) => s.theme);
  const themeColors = getThemeById(theme);

  const progressPercent = Math.round(chapterProgress * 100);
  const pageInfo =
    totalPages > 0
      ? `${currentPageIndex + 1} / ${totalPages} 页`
      : `${currentPageIndex + 1} 页`;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 40,
        padding: '0 16px',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: themeColors.cssVariables['ui-background'],
        borderTop: `1px solid ${themeColors.cssVariables['ui-border']}`,
        color: themeColors.cssVariables['ui-text-secondary'],
        fontSize: 12,
        boxShadow: '0 -1px 4px rgba(0,0,0,0.05)',
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {chapterTitle || ''}
      </span>
      <span style={{ flexShrink: 0, marginLeft: 12 }}>
        {pageInfo} · {progressPercent}%
      </span>
    </div>
  );
};
