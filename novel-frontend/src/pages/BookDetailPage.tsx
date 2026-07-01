/**
 * BookDetailPage — 书籍详情页。
 *
 * 展示封面、简介、标签和按分卷分组的完整章节目录，
 * 提供「开始阅读」和「从上次继续」按钮。
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLibraryStore } from '@store/libraryStore';
import { getBookLoader } from '@book/BookLoader';
import type { BookMetadata, TocEntry, ChapterNav, BookSource } from '@book/types';
import { restoreReadingProgress } from '@services/storage/ProgressCache';
import type { ReadingProgress } from '@services/storage/ProgressCache';

function inferBookSource(bookId: string): BookSource {
  if (/^\d+$/.test(bookId)) {
    return { type: 'http-api', uri: `/api/books/${bookId}`, metadata: { bookId } };
  }
  return { type: 'wenku8', uri: `/crawler/novels/${bookId}`, metadata: { bookId } };
}

function flattenToc(entries: TocEntry[]): TocEntry[] {
  const result: TocEntry[] = [];
  function walk(list: TocEntry[]): void {
    for (const entry of list) {
      if (entry.children && entry.children.length > 0) {
        walk(entry.children);
      } else {
        result.push(entry);
      }
    }
  }
  walk(entries);
  return result.length > 0 ? result : entries;
}

function sortTocEntries(entries: TocEntry[]): TocEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      children: entry.children ? sortTocEntries(entry.children) : undefined,
    }))
    .sort((a, b) => a.order - b.order);
}

function buildNav(flatChapters: TocEntry[]): ChapterNav {
  const chapterMap = new Map<string, TocEntry>();
  for (const ch of flatChapters) {
    chapterMap.set(ch.chapterId, ch);
  }
  return {
    chapters: flatChapters,
    findById: (id: string) => chapterMap.get(id),
    getNext: (id: string) => {
      const idx = flatChapters.findIndex((ch) => ch.chapterId === id);
      if (idx >= 0 && idx < flatChapters.length - 1) return flatChapters[idx + 1];
      return undefined;
    },
    getPrev: (id: string) => {
      const idx = flatChapters.findIndex((ch) => ch.chapterId === id);
      if (idx > 0) return flatChapters[idx - 1];
      return undefined;
    },
    getVolumeName: () => undefined,
    totalChapters: flatChapters.length,
  };
}

const _inflightRequests = new Map<string, Promise<{
  meta: BookMetadata;
  rawToc: TocEntry[];
  prog: ReadingProgress | null;
}>>();

export const BookDetailPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const getBookSource = useLibraryStore((s) => s.getBookSource);

  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [nav, setNav] = useState<ChapterNav | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    const source = getBookSource(bookId) || inferBookSource(bookId);
    setLoading(true);
    setError(null);
    const loader = getBookLoader();
    const adapter = loader.findAdapter(source);
    if (!adapter) {
      setError(`不支持的书籍格式: ${source.type}`);
      setLoading(false);
      return;
    }
    const cacheKey = `book_${bookId}`;
    let promise = _inflightRequests.get(cacheKey);
    if (!promise) {
      promise = Promise.all([
        loader.loadMetadata(source),
        adapter.getToc(source),
        restoreReadingProgress(bookId),
      ]).then(([meta, rawToc, prog]) => ({ meta, rawToc, prog }));
      _inflightRequests.set(cacheKey, promise);
    }
    let cancelled = false;
    promise
      .then(({ meta, rawToc, prog }) => {
        if (cancelled) return;
        setMetadata(meta);
        const sortedToc = sortTocEntries(rawToc);
        setTocEntries(sortedToc);
        const flat = flattenToc(sortedToc);
        setNav(buildNav(flat));
        setProgress(prog);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载书籍信息失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        _inflightRequests.delete(cacheKey);
      });
    return () => { cancelled = true; };
  }, [bookId, getBookSource]);

  const handleStartReading = (startChapterId?: string) => {
    if (!bookId) return;
    // 仅当点击「继续阅读」（未指定章节）时才传递旧进度位置
    // 从目录点击具体章节时，从头开始，不沿用旧进度
    const isSpecificChapter = !!startChapterId;
    navigate(`/reader/${bookId}`, {
      state: {
        chapterId: startChapterId,
        charOffset: isSpecificChapter ? undefined : progress?.charOffset,
        pageIndex: isSpecificChapter ? undefined : progress?.pageIndex,
        scrollOffset: isSpecificChapter ? undefined : progress?.scrollOffset,
      },
    });
  };

  // ─── 加载中 ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-muted-foreground">
        <div className="text-center">
          <div className="w-8 h-8 border-[3px] border-border border-t-primary rounded-full animate-spin mb-3 mx-auto" />
          <div className="text-sm">加载中...</div>
        </div>
      </div>
    );
  }

  // ─── 错误 ───
  if (error || !metadata) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-foreground">
        <div className="text-center p-8">
          <div className="text-5xl mb-3">😞</div>
          <div className="text-[15px] text-muted-foreground mb-4">{error || '书籍信息加载失败'}</div>
          <Button onClick={() => navigate(-1)}>返回</Button>
        </div>
      </div>
    );
  }

  const hasVolumes = tocEntries.some((entry) => entry.children && entry.children.length > 0);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground py-4 px-4 pb-6">
      {/* ── 封面 + 基本信息 ── */}
      <div className="text-center mb-5">
        <div className="w-20 h-[110px] mx-auto mb-3 rounded-lg bg-primary/25 flex items-center justify-center text-4xl font-bold text-primary"
          style={{
            background: `linear-gradient(135deg, var(--reader-ui-accent)40, var(--reader-ui-accent)20)`,
          }}
        >
          {metadata.title.charAt(0)}
        </div>
        <h1 className="text-xl font-bold mb-1">{metadata.title}</h1>
        <p className="text-sm text-muted-foreground">{metadata.author}</p>
      </div>

      {/* ── 元信息标签 ── */}
      <div className="flex justify-center gap-4 mb-4 text-xs text-muted-foreground">
        {metadata.wordCount && <span>约 {Math.round(metadata.wordCount / 10000)} 万字</span>}
        {nav && <span>{nav.totalChapters} 章</span>}
        {metadata.status && <span>{metadata.status}</span>}
      </div>

      {/* ── 标签 ── */}
      {metadata.tags && metadata.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center mb-4">
          {metadata.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
          ))}
        </div>
      )}

      {/* ── 简介 ── */}
      {metadata.description && (
        <div className="mb-5 p-3 rounded-lg bg-secondary text-[13px] leading-relaxed text-muted-foreground">
          {metadata.description}
        </div>
      )}

      {/* ── 操作按钮 ── */}
      <div className="flex gap-2.5 mb-5">
        <Button onClick={() => handleStartReading()} className="flex-1 py-3" size="lg">
          {progress ? '继续阅读' : '开始阅读'}
        </Button>
      </div>

      {/* ── 章节目录 ── */}
      {nav && (
        <section>
          <h3 className="text-[15px] font-semibold mb-2.5">目录（共 {nav.totalChapters} 章）</h3>
          {hasVolumes
            ? tocEntries.map((entry) => {
                if (entry.children && entry.children.length > 0) {
                  return (
                    <div key={entry.chapterId} className="mb-3">
                      <div className="py-2.5 px-2 text-[13px] font-semibold">{entry.title}</div>
                      {entry.children.map((child) => (
                        <button
                          key={child.chapterId}
                          onClick={() => handleStartReading(child.chapterId)}
                          className="block w-full py-2 pl-5 pr-2 border-none rounded-md bg-transparent text-[13px] text-left cursor-pointer mb-0.5 hover:bg-accent"
                        >
                          {child.title}
                        </button>
                      ))}
                    </div>
                  );
                }
                return (
                  <button
                    key={entry.chapterId}
                    onClick={() => handleStartReading(entry.chapterId)}
                    className="block w-full py-2 px-2 border-none rounded-md bg-transparent text-[13px] text-left cursor-pointer mb-0.5 hover:bg-accent"
                  >
                    {entry.title}
                  </button>
                );
              })
            : nav.chapters.map((chapter) => (
                <button
                  key={chapter.chapterId}
                  onClick={() => handleStartReading(chapter.chapterId)}
                  className="block w-full py-2 px-2 border-none rounded-md bg-transparent text-[13px] text-left cursor-pointer mb-0.5 hover:bg-accent"
                >
                  {chapter.title}
                </button>
              ))}
        </section>
      )}
    </div>
  );
};
