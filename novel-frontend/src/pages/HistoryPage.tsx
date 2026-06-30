/**
 * HistoryPage — 阅读历史独立页面。
 *
 * 复用 HistoryPanel 组件，以独立页面形式展示。
 * 点击历史记录中的书籍直接跳转到阅读器。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { HistoryPanel } from '@components/HistoryPanel';
import type { BookSource } from '@book/types';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  const handleSelectBook = useCallback((source: BookSource) => {
    const bookId = source.metadata?.bookId as string || '1';
    import('@store/libraryStore').then(({ useLibraryStore }) => {
      useLibraryStore.getState().setBookSource(bookId, source);
    });
    navigate(`/reader/${bookId}`);
  }, [navigate]);

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      background: colors['ui-background'],
      color: colors['ui-text'],
      padding: '16px',
    }}>
      <h2 style={{
        fontSize: 18,
        fontWeight: 600,
        margin: '0 0 16px',
      }}>
        阅读历史
      </h2>
      <HistoryPanel onSelectBook={handleSelectBook} />
    </div>
  );
};
