/**
 * HomePage — 首页。
 *
 * 布局（从上到下）：
 * 1. 欢迎标题
 * 2. 最近阅读（IndexedDB 历史记录，最多 3 条）
 * 3. 分类入口卡片（全部/连载中/已完结/标签）
 * 4. 推荐阅读（从 API 加载：已完结 + S 级，最多 6 本）
 *
 * 设计原则：用户打开应用的第一屏，快速提供
 * "继续上次阅读"、"浏览分类"、"发现精品"三个关键动作入口。
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useLibraryStore } from '@store/libraryStore';
import { HistoryPanel } from '@components/HistoryPanel';
import { BookCard } from '@components/BookCard';
import { fetchCatalog, type CatalogNovel } from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

/** 首页展示的入口卡片 */
interface CategoryCard {
  label: string;
  icon: string;
  /** 跳转路径（可带查询参数） */
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
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  const [hasHistory, setHasHistory] = useState(false);
  const [featured, setFeatured] = useState<CatalogNovel[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);

  // ── 检查阅读历史 ──
  useEffect(() => {
    import('@/services/storage/HistoryCache')
      .then(({ getAllHistory }) => {
        getAllHistory().then((entries) => setHasHistory(entries.length > 0));
      })
      .catch(() => {});
  }, []);

  // ── 加载推荐作品（已完结 + S 级，前 6 本）──
  useEffect(() => {
    setFeaturedLoading(true);
    fetchCatalog({ status: '已完结', rating: 'S', limit: 6 })
      .then((result) => setFeatured(result.items))
      .catch(() => {
        // 如果 S 级不够，回退到仅已完结
        fetchCatalog({ status: '已完结', limit: 6 })
          .then((result) => setFeatured(result.items))
          .catch(() => {});
      })
      .finally(() => setFeaturedLoading(false));
  }, []);

  // ── 事件处理 ──

  /** 点击历史记录中的书籍 → 直接打开阅读器 */
  const handleSelectBook = (source: BookSource) => {
    const bookId = (source.metadata?.bookId as string) || '1';
    setBookSource(bookId, source);
    navigate(`/reader/${bookId}`);
  };

  /** 点击推荐书籍 → 跳转详情页 */
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
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: colors['ui-background'],
        color: colors['ui-text'],
        padding: '0 16px',
      }}
    >
      {/* ── 欢迎区域 ── */}
      <div
        style={{
          textAlign: 'center',
          paddingTop: 24,
          paddingBottom: 20,
        }}
      >
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            margin: '0 0 6px',
          }}
        >
          📖 轻小说
        </h1>
        <p
          style={{
            fontSize: 13,
            color: colors['ui-text-secondary'],
            margin: 0,
          }}
        >
          沉浸式轻小说阅读体验
        </p>
      </div>

      {/* ── 最近阅读 ── */}
      {hasHistory && (
        <section style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              margin: '0 0 10px',
              color: colors['ui-text'],
            }}
          >
            最近阅读
          </h2>
          <HistoryPanel compact onSelectBook={handleSelectBook} />
        </section>
      )}

      {/* ── 分类入口 ── */}
      <section style={{ paddingBottom: 20 }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: '0 0 10px',
            color: colors['ui-text'],
          }}
        >
          探索发现
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}
        >
          {CATEGORY_CARDS.map((card) => (
            <button
              key={card.label}
              onClick={() => navigate(card.path)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '16px 8px',
                border: `1px solid ${colors['ui-border']}`,
                borderRadius: 12,
                background: colors['ui-background-secondary'],
                color: colors['ui-text'],
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 28 }}>{card.icon}</span>
              <span>{card.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── 精品推荐 ── */}
      {!featuredLoading && featured.length > 0 && (
        <section style={{ paddingBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <h2
              style={{
                fontSize: 15,
                fontWeight: 600,
                margin: 0,
                color: colors['ui-text'],
              }}
            >
              精品推荐
            </h2>
            <button
              onClick={() => navigate('/library?tab=1')}
              style={{
                fontSize: 12,
                color: colors['ui-accent'],
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              查看更多 →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

      {/* 精品推荐加载中 */}
      {featuredLoading && (
        <div
          style={{
            textAlign: 'center',
            padding: 20,
            color: colors['ui-text-secondary'],
            fontSize: 13,
          }}
        >
          加载推荐中...
        </div>
      )}
    </div>
  );
};
