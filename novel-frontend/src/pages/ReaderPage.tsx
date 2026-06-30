/**
 * ReaderPage — 阅读器页面（薄包装层）。
 *
 * 职责：
 * 1. 从 URL 参数获取 bookId
 * 2. 从 libraryStore 查找对应的 BookSource
 * 3. 从导航 state 提取目标章节/页码/偏移量
 * 4. 渲染 ReaderShell（传入完整阅读起点信息）
 * 5. 处理返回导航
 * 6. 页面生命周期管理（切后台时保存恢复状态）
 *
 * 阅读器的核心逻辑全部在 features/reader/ 中，本页面只做路由桥接。
 */

import React, { useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ReaderShell } from '@features/reader/components/ReaderShell';
import { useLibraryStore } from '@store/libraryStore';
import { usePageLifecycle } from '@/services/usePageLifecycle';
import type { BookSource } from '@book/types';

/** 导航状态中携带的阅读起点信息 */
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

  // 注册页面生命周期：切后台时保存当前阅读位置
  usePageLifecycle({
    enabled: !!bookId,
    currentPath: location.pathname + location.search,
  });

  // 从导航 state 提取阅读起点（BookDetailPage 传入）
  const navState = location.state as ReaderNavigationState | null;

  // 从 store 查找 BookSource；如果不存在则尝试构造
  const source: BookSource | null = useMemo(() => {
    if (!bookId) return null;

    // 优先从 libraryStore 查找
    const stored = getBookSource(bookId);
    if (stored) return stored;

    // 回退：根据 bookId 推断（数字 ID = API，aid_ 前缀 = 文件）
    if (/^\d+$/.test(bookId)) {
      return {
        type: 'http-api',
        uri: `/api/books/${bookId}`,
        metadata: { bookId },
      };
    }
    return {
      type: 'wenku8',
      uri: `/crawler/novels/${bookId}`,
      metadata: { bookId },
    };
  }, [bookId, getBookSource]);

  /** 返回上一页：优先回到书籍详情页，否则回到首页 */
  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [navigate]);

  // 无有效 BookSource
  if (!source) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: '#1A1A1A',
        color: '#D4D4D4',
      }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
          <div style={{ fontSize: 15, marginBottom: 16 }}>
            未找到书籍数据源
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 24px',
              border: 'none',
              borderRadius: 8,
              background: '#4A90D9',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            返回首页
          </button>
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
