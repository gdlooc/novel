/**
 * ReaderPage — 阅读器页面（薄包装层）。
 *
 * 职责：从 URL/Store 获取 BookSource，传递给 ReaderShell。
 * 核心阅读逻辑全在 features/reader/ 中。
 */
import React, { useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ReaderShell } from '@features/reader/components/ReaderShell';
import { Button } from '@/components/ui/button';
import { useLibraryStore } from '@store/libraryStore';
import { usePageLifecycle } from '@/services/usePageLifecycle';
import type { BookSource } from '@book/types';

interface ReaderNavigationState {
  chapterId?: string;
  charOffset?: number;
  pageIndex?: number;
  scrollOffset?: number;
}

export const ReaderPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const getBookSource = useLibraryStore((s) => s.getBookSource);

  usePageLifecycle({
    enabled: !!bookId,
    currentPath: location.pathname + location.search,
  });

  const navState = location.state as ReaderNavigationState | null;

  const source: BookSource | null = useMemo(() => {
    if (!bookId) return null;
    const stored = getBookSource(bookId);
    if (stored) return stored;
    if (/^\d+$/.test(bookId)) {
      return { type: 'http-api', uri: `/api/books/${bookId}`, metadata: { bookId } };
    }
    return { type: 'wenku8', uri: `/crawler/novels/${bookId}`, metadata: { bookId } };
  }, [bookId, getBookSource]);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [navigate]);

  if (!source) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-foreground">
        <div className="text-center p-8">
          <div className="text-5xl mb-3">📖</div>
          <div className="text-[15px] mb-4">未找到书籍数据源</div>
          <Button onClick={() => navigate('/')}>返回首页</Button>
        </div>
      </div>
    );
  }

  return (
    <ReaderShell
      bookSource={source}
      onBack={handleBack}
      initialChapterId={navState?.chapterId}
      initialCharOffset={navState?.charOffset}
      initialPageIndex={navState?.pageIndex}
      initialScrollOffset={navState?.scrollOffset}
    />
  );
};
