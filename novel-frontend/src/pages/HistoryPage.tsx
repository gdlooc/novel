/**
 * HistoryPage — 阅读历史独立页面。
 *
 * 复用 HistoryPanel 组件，以独立页面形式展示。
 */
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryPanel } from '@components/HistoryPanel';
import type { BookSource } from '@book/types';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSelectBook = useCallback((source: BookSource) => {
    const bookId = source.metadata?.bookId as string || '1';
    import('@store/libraryStore').then(({ useLibraryStore }) => {
      useLibraryStore.getState().setBookSource(bookId, source);
    });
    navigate(`/reader/${bookId}`);
  }, [navigate]);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground p-4">
      <h2 className="text-lg font-semibold mb-4">阅读历史</h2>
      <HistoryPanel onSelectBook={handleSelectBook} />
    </div>
  );
};
