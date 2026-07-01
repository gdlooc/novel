/**
 * HomePage — 首页。
 *
 * 布局（从上到下）：
 * 1. 欢迎标题
 * 2. 最近阅读（IndexedDB 历史记录，最多 3 条）
 * 3. 分类入口卡片（全部/连载中/已完结/标签）
 * 4. 推荐阅读（从 API 加载：已完结 + S 级，最多 6 本）
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLibraryStore } from '@store/libraryStore';
import { HistoryPanel } from '@components/HistoryPanel';
import { BookCard } from '@components/BookCard';
import { fetchCatalog, type CatalogNovel } from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

/** 首页展示的入口卡片 */
interface CategoryCard {
  label: string;
  icon: string;
  path: string;
}

/** 内建的分类入口列表 */
const CATEGORY_CARDS: CategoryCard[] = [
  { label: '全部作品', icon: '📚', path: '/library' },
  { label: '连载中', icon: '✍️', path: '/library?tab=2' },
  { label: '已完结', icon: '✅', path: '/library?tab=1' },
  { label: '校园', icon: '🏫', path: '/library?tag=校园' },
  { label: '奇幻', icon: '🐉', path: '/library?tag=奇幻' },
  { label: '恋爱', icon: '💕', path: '/library?tag=恋爱' },
];

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  const [hasHistory, setHasHistory] = useState(false);
  const [featured, setFeatured] = useState<CatalogNovel[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);

  useEffect(() => {
    import('@/services/storage/HistoryCache')
      .then(({ getAllHistory }) => {
        getAllHistory().then((entries) => setHasHistory(entries.length > 0));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setFeaturedLoading(true);
    fetchCatalog({ status: '已完结', rating: 'S', limit: 6 })
      .then((result) => setFeatured(result.items))
      .catch(() => {
        fetchCatalog({ status: '已完结', limit: 6 })
          .then((result) => setFeatured(result.items))
          .catch(() => {});
      })
      .finally(() => setFeaturedLoading(false));
  }, []);

  const handleSelectBook = (source: BookSource) => {
    const bookId = (source.metadata?.bookId as string) || '1';
    setBookSource(bookId, source);
    navigate(`/reader/${bookId}`);
  };

  const handleSelectFeatured = (novel: CatalogNovel) => {
    const bookId = String(novel.downloaded_aid!);
    const source: BookSource = {
      type: 'http-api',
      uri: `/api/books/${bookId}`,
      metadata: { bookId },
    };
    setBookSource(bookId, source);
    navigate(`/book/${bookId}`);
  };

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground px-4">
      {/* ── 欢迎区域 ── */}
      <div className="text-center pt-6 pb-5">
        <h1 className="text-[26px] font-bold mb-1">📖 轻小说</h1>
        <p className="text-[13px] text-muted-foreground">沉浸式轻小说阅读体验</p>
      </div>

      {/* ── 最近阅读 ── */}
      {hasHistory && (
        <section className="mb-6">
          <h2 className="text-[15px] font-semibold mb-2.5">最近阅读</h2>
          <HistoryPanel compact onSelectBook={handleSelectBook} />
        </section>
      )}

      {/* ── 分类入口 ── */}
      <section className="pb-5">
        <h2 className="text-[15px] font-semibold mb-2.5">探索发现</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {CATEGORY_CARDS.map((card) => (
            <Button
              key={card.label}
              variant="ghost"
              onClick={() => navigate(card.path)}
              className="flex flex-col items-center justify-center gap-1.5 py-4 px-2 h-auto border border-border rounded-xl bg-card hover:bg-accent text-foreground"
            >
              <span className="text-[28px]">{card.icon}</span>
              <span className="text-[13px] font-medium">{card.label}</span>
            </Button>
          ))}
        </div>
      </section>

      {/* ── 精品推荐 ── */}
      {!featuredLoading && featured.length > 0 && (
        <section className="pb-6">
          <div className="flex justify-between items-center mb-2.5">
            <h2 className="text-[15px] font-semibold">精品推荐</h2>
            <Button variant="link" size="sm" onClick={() => navigate('/library?tab=1')}>
              查看更多 →
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {featured
              .filter((n) => n.is_downloaded)
              .map((novel) => (
                <BookCard
                  key={novel.data_source_aid}
                  title={novel.title}
                  author={novel.author || undefined}
                  coverUrl={novel.cover_url || undefined}
                  tags={novel.tags?.length > 0 ? novel.tags : undefined}
                  onClick={() => handleSelectFeatured(novel)}
                />
              ))}
          </div>
        </section>
      )}

      {featuredLoading && (
        <div className="text-center py-5 text-[13px] text-muted-foreground">
          加载推荐中...
        </div>
      )}
    </div>
  );
};
