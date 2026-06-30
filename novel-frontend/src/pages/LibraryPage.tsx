/**
 * LibraryPage — 书库页。
 *
 * 从 crawler FastAPI 动态加载全站小说目录（site_novels 表，4123 本）。
 * 支持按状态筛选、分页加载，以及自定义源输入。
 *
 * 数据流：
 *   1. 挂载时调用 fetchCatalog() 获取第一页
 *   2. 用户切换筛选标签 → 重新请求
 *   3. 点击"加载更多" → 追加下一页
 *   4. 已下载小说可进入详情页 → 开始阅读
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useLibraryStore } from '@store/libraryStore';
import { BookCard } from '@components/BookCard';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { ErrorView } from '@components/ErrorView';
import {
  fetchCatalog,
  type CatalogNovel,
  type CatalogParams,
} from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

// ─── 筛选标签定义 ───

/** 顶部筛选标签 */
interface FilterTab {
  label: string;
  /** 传给 API 的查询参数 */
  params: CatalogParams;
}

const FILTER_TABS: FilterTab[] = [
  { label: '全部', params: {} },
  { label: '已完结', params: { status: '已完结' } },
  { label: '连载中', params: { status: '连载中' } },
  { label: '已下载', params: { downloaded: 'true' } },
];

/** 每页加载数量 */
const PAGE_SIZE = 20;

// ─── 组件 ───

export const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  // ─── 从 URL 参数恢复初始状态 ───
  const urlTab = searchParams.get('tab');     // ?tab=0/1/2/3
  const urlTag = searchParams.get('tag');      // ?tag=校园 等

  /** 根据 URL 参数决定初始激活标签 */
  const getInitialTab = (): number => {
    if (urlTab !== null) {
      const idx = parseInt(urlTab, 10);
      if (idx >= 0 && idx < FILTER_TABS.length) return idx;
    }
    return 0;
  };

  /** 根据 URL 标签参数构建自定义筛选 */
  const getInitialCustomParams = (): CatalogParams | null => {
    if (urlTag) {
      return { tags: urlTag };
    }
    return null;
  };

  // ─── 状态 ───
  const initialTab = getInitialTab();
  const initialCustomParams = getInitialCustomParams();
  const [novels, setNovels] = useState<CatalogNovel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  /** 自定义标签筛选参数（URL ?tag=xxx 传入） */
  const [customParams] = useState<CatalogParams | null>(initialCustomParams);
  const [customUrl, setCustomUrl] = useState('');

  // ─── 数据加载 ───

  /** 加载第一页（筛选条件变化时调用） */
  const loadFirstPage = useCallback(
    async (tabIndex: number, extraParams?: CatalogParams | null) => {
      setLoading(true);
      setError(null);
      setNovels([]);

      try {
        const params: CatalogParams = {
          ...FILTER_TABS[tabIndex].params,
          ...(extraParams || {}),
          offset: 0,
          limit: PAGE_SIZE,
        };
        const result = await fetchCatalog(params);
        setNovels(result.items);
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载书库失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /** 加载更多（追加到现有列表） */
  const loadMore = useCallback(async () => {
    if (loadingMore || novels.length >= total) return;

    setLoadingMore(true);
    try {
      const params: CatalogParams = {
        ...FILTER_TABS[activeTab].params,
        offset: novels.length,
        limit: PAGE_SIZE,
      };
      const result = await fetchCatalog(params);
      setNovels((prev) => [...prev, ...result.items]);
    } catch (err) {
      // 加载更多失败不覆盖已有数据，仅静默忽略
      console.warn('[LibraryPage] 加载更多失败:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, novels.length, total, activeTab]);

  // ─── 首次加载 & 筛选切换 ───
  useEffect(() => {
    loadFirstPage(activeTab, activeTab === 0 ? customParams : null);
  }, [activeTab, loadFirstPage, customParams]);

  // ─── 事件处理 ───

  /** 点击已下载小说 → 存入 libraryStore → 跳转详情页 */
  const handleSelectBook = (novel: CatalogNovel) => {
    const bookId = String(novel.downloaded_aid!);
    const source: BookSource = {
      type: 'http-api',
      uri: `/api/books/${bookId}`,
      metadata: { bookId },
    };
    setBookSource(bookId, source);
    navigate(`/book/${bookId}`);
  };

  /** 处理自定义源输入 */
  const handleCustomSource = () => {
    if (!customUrl.trim()) return;
    const source: BookSource = {
      type: 'wenku8',
      uri: customUrl.trim(),
      metadata: { bookId: customUrl.trim().split('/').pop() || 'custom' },
    };
    const bookId = source.metadata!.bookId as string;
    setBookSource(bookId, source);
    navigate(`/book/${bookId}`);
  };

  /** 切换筛选标签 */
  const handleTabChange = (index: number) => {
    if (index === activeTab) return;
    setActiveTab(index);
  };

  // ─── 渲染 ───

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: colors['ui-background'],
        color: colors['ui-text'],
        padding: '16px 16px 24px',
      }}
    >
      {/* ── 页面标题 ── */}
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: '0 0 14px',
        }}
      >
        书库
        {customParams?.tags && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: colors['ui-accent'],
              marginLeft: 8,
              padding: '2px 8px',
              borderRadius: 10,
              background: colors['ui-accent'] + '18',
            }}
          >
            #{customParams.tags}
          </span>
        )}
        {total > 0 && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: colors['ui-text-secondary'],
              marginLeft: 8,
            }}
          >
            共 {total} 本
          </span>
        )}
      </h2>

      {/* ── 筛选标签栏 ── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          overflowX: 'auto',
        }}
      >
        {FILTER_TABS.map((tab, index) => (
          <button
            key={tab.label}
            onClick={() => handleTabChange(index)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${
                index === activeTab ? colors['ui-accent'] : colors['ui-border']
              }`,
              background:
                index === activeTab
                  ? colors['ui-accent'] + '18'
                  : 'transparent',
              color:
                index === activeTab
                  ? colors['ui-accent']
                  : colors['ui-text-secondary'],
              fontSize: 13,
              fontWeight: index === activeTab ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 加载中 ── */}
      {loading && <LoadingSpinner message="加载书库..." />}

      {/* ── 错误 ── */}
      {error && !loading && (
        <ErrorView
          message={error}
          onRetry={() => loadFirstPage(activeTab)}
        />
      )}

      {/* ── 小说列表 ── */}
      {!loading && !error && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {novels.map((novel) => (
              <BookCard
                key={novel.data_source_aid}
                title={novel.title}
                author={novel.author || '未下载（元数据待获取）'}
                coverUrl={novel.cover_url || undefined}
                tags={
                  novel.tags && novel.tags.length > 0
                    ? novel.tags
                    : novel.is_downloaded
                      ? undefined
                      : ['未下载']
                }
                onClick={
                  novel.is_downloaded
                    ? () => handleSelectBook(novel)
                    : undefined
                }
              />
            ))}

            {/* 空结果 */}
            {novels.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '48px 0',
                  color: colors['ui-text-secondary'],
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
                <div style={{ fontSize: 14 }}>没有找到符合条件的书籍</div>
              </div>
            )}
          </div>

          {/* ── 加载更多 ── */}
          {novels.length < total && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {loadingMore ? (
                <LoadingSpinner message="加载更多..." />
              ) : (
                <button
                  onClick={loadMore}
                  style={{
                    padding: '10px 32px',
                    border: `1px solid ${colors['ui-border']}`,
                    borderRadius: 10,
                    background: colors['ui-background-secondary'],
                    color: colors['ui-text'],
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  加载更多（{novels.length}/{total}）
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── 自定义源（分隔线 + 折叠区）── */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 20,
          borderTop: `1px solid ${colors['ui-border']}`,
        }}
      >
        <h3
          style={{
            fontSize: 13,
            color: colors['ui-text-secondary'],
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          自定义源
        </h3>
        <input
          type="text"
          placeholder="输入书籍目录路径或 URL..."
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: `1px solid ${colors['ui-border']}`,
            borderRadius: 8,
            background: colors['ui-background-secondary'],
            color: colors['ui-text'],
            fontSize: 14,
            marginBottom: 8,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleCustomSource}
          disabled={!customUrl.trim()}
          style={{
            width: '100%',
            padding: '10px',
            border: 'none',
            borderRadius: 8,
            background: customUrl.trim()
              ? colors['ui-accent']
              : colors['ui-border'],
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            cursor: customUrl.trim() ? 'pointer' : 'default',
            opacity: customUrl.trim() ? 1 : 0.5,
          }}
        >
          打开
        </button>
      </div>
    </div>
  );
};
