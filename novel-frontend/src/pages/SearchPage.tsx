/**
 * SearchPage — 搜索页。
 *
 * 通过 crawler FastAPI 的 /api/catalog 端点按标题搜索全站小说。
 * 支持键盘回车触发搜索，展示结果列表，点击跳转详情页。
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLibraryStore } from '@store/libraryStore';
import { BookCard } from '@components/BookCard';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { fetchCatalog, type CatalogNovel } from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogNovel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

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
    <div className="h-full overflow-y-auto bg-background text-foreground p-4">
      <h2 className="text-lg font-semibold mb-4">搜索</h2>

      {/* ── 搜索输入框 ── */}
      <div className="flex gap-2 mb-5">
        <Input
          type="text"
          placeholder="搜索书名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={!query.trim() || loading}>
          {loading ? '搜索中...' : '搜索'}
        </Button>
      </div>

      {/* ── 加载中 ── */}
      {loading && <LoadingSpinner message="搜索中..." />}

      {/* ── 错误 ── */}
      {error && !loading && searched && (
        <div className="text-center py-8 text-muted-foreground">
          <div className="text-sm mb-3">{error}</div>
          <Button onClick={handleSearch}>重试</Button>
        </div>
      )}

      {/* ── 搜索结果 ── */}
      {!loading && searched && !error && (
        <>
          {results.length > 0 && (
            <div className="text-[13px] text-muted-foreground mb-3">
              找到 {total} 本相关书籍
            </div>
          )}

          <div className="flex flex-col gap-2">
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
                onClick={novel.is_downloaded ? () => handleSelectBook(novel) : undefined}
              />
            ))}
          </div>

          {results.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <div className="text-5xl mb-3">🔍</div>
              <div className="text-sm">未找到相关书籍</div>
              <div className="text-xs mt-1 opacity-50">试试其他关键词</div>
            </div>
          )}
        </>
      )}

      {/* 未搜索时的提示 */}
      {!searched && !loading && (
        <div className="text-center py-10 text-muted-foreground">
          <div className="text-5xl mb-3">📝</div>
          <div className="text-sm">输入书名关键词开始搜索</div>
          <div className="text-xs mt-1 opacity-50">当前索引 4123 本轻小说</div>
        </div>
      )}
    </div>
  );
};
