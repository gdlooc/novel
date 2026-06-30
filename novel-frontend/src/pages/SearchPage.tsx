/**
 * SearchPage — 搜索页。
 *
 * 通过 crawler FastAPI 的 /api/catalog 端点按标题搜索全站小说。
 * 支持键盘回车触发搜索，展示结果列表，点击跳转详情页。
 *
 * 数据流：
 *   1. 用户输入关键词 → 按回车或点击搜索按钮
 *   2. 调用 fetchCatalog({ q: query })
 *   3. 展示搜索结果（复用 BookCard 组件）
 *   4. 已下载可直接阅读，未下载仅展示信息
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useLibraryStore } from '@store/libraryStore';
import { BookCard } from '@components/BookCard';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { fetchCatalog, type CatalogNovel } from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogNovel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 执行搜索 */
  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setSearched(true);
    setError(null);
    setResults([]);

    try {
      const result = await fetchCatalog({ q: trimmed, limit: 50 });
      setResults(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  }, [query]);

  /** 键盘回车触发搜索 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  /** 点击搜索结果 → 存入 libraryStore → 跳转详情页 */
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

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: colors['ui-background'],
        color: colors['ui-text'],
        padding: '16px',
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: '0 0 16px',
        }}
      >
        搜索
      </h2>

      {/* ── 搜索输入框 ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="搜索书名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{
            flex: 1,
            padding: '10px 14px',
            border: `1px solid ${colors['ui-border']}`,
            borderRadius: 10,
            background: colors['ui-background-secondary'],
            color: colors['ui-text'],
            fontSize: 15,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={!query.trim() || loading}
          style={{
            padding: '10px 20px',
            border: 'none',
            borderRadius: 10,
            background:
              query.trim() && !loading
                ? colors['ui-accent']
                : colors['ui-border'],
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor:
              query.trim() && !loading ? 'pointer' : 'default',
            opacity: query.trim() && !loading ? 1 : 0.5,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      {/* ── 加载中 ── */}
      {loading && <LoadingSpinner message="搜索中..." />}

      {/* ── 错误 ── */}
      {error && !loading && searched && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 0',
            color: colors['ui-text-secondary'],
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 12 }}>{error}</div>
          <button
            onClick={handleSearch}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 8,
              background: colors['ui-accent'],
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )}

      {/* ── 搜索结果 ── */}
      {!loading && searched && !error && (
        <>
          {results.length > 0 && (
            <div
              style={{
                fontSize: 13,
                color: colors['ui-text-secondary'],
                marginBottom: 12,
              }}
            >
              找到 {total} 本相关书籍
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((novel) => (
              <BookCard
                key={novel.data_source_aid}
                title={novel.title}
                author={novel.author || '未下载'}
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
          </div>

          {/* 空结果 */}
          {results.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: colors['ui-text-secondary'],
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 14 }}>未找到相关书籍</div>
              <div
                style={{
                  fontSize: 12,
                  marginTop: 4,
                  color: colors['ui-text-secondary'] + '80',
                }}
              >
                试试其他关键词
              </div>
            </div>
          )}
        </>
      )}

      {/* 未搜索时的提示 */}
      {!searched && !loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: colors['ui-text-secondary'],
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
          <div style={{ fontSize: 14 }}>输入书名关键词开始搜索</div>
          <div
            style={{
              fontSize: 12,
              marginTop: 4,
              color: colors['ui-text-secondary'] + '80',
            }}
          >
            当前索引 {4123} 本轻小说
          </div>
        </div>
      )}
    </div>
  );
};
