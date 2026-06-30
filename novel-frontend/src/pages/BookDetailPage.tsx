/**
 * BookDetailPage — 书籍详情页。
 *
 * 根据 URL 参数 bookId 加载书籍元数据和章节目录，
 * 展示封面、简介、标签和按分卷分组的完整章节目录，
 * 提供「开始阅读」和「从上次继续」按钮。
 *
 * 数据来源：
 * - metadata → BookLoader.loadMetadata()（适配器模式）
 * - 目录显示 → 适配器的 getToc()（保留嵌套分卷结构）
 * - 导航数据 → buildChapterNav() 扁平化用于章节跳转
 *
 * 注意：目录渲染使用适配器返回的嵌套 TocEntry[]，
 * 而非 ChapterNav.chapters（扁平化后丢失分卷信息）。
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
import { useLibraryStore } from '@store/libraryStore';
import { getBookLoader } from '@book/BookLoader';
import type { BookMetadata, TocEntry, ChapterNav, BookSource } from '@book/types';
import { restoreReadingProgress } from '@services/storage/ProgressCache';
import type { ReadingProgress } from '@services/storage/ProgressCache';

/**
 * 根据 bookId 自动推断 BookSource。
 * 当用户直接访问 URL 或刷新页面时，libraryStore 为空，
 * 此时需要根据 bookId 的格式推断数据来源。
 *
 * - 纯数字 ID → HTTP API 模式
 * - 其他格式 → 文件模式（wenku8）
 */
function inferBookSource(bookId: string): BookSource {
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
}

/**
 * 将 TocEntry 数组展平为叶子章节列表（仅叶子节点，不含卷）。
 * 用于构建 ChapterNav，与 BookLoader.buildChapterNav 逻辑一致。
 */
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
  // 如果全是卷、没有叶子章节，退回使用全部条目
  return result.length > 0 ? result : entries;
}

/**
 * 对 TocEntry 数组递归排序（按 order 字段，确保目录顺序正确）。
 *
 * 由于 ApiAdapter 使用 Map 迭代，其顺序取决于 API 返回章节的先后，
 * 在某些边缘情况下（如 volume_id=NULL 修复后）可能乱序。
 * 此函数确保卷和章节均按 order 升序排列。
 */
function sortTocEntries(entries: TocEntry[]): TocEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      children: entry.children ? sortTocEntries(entry.children) : undefined,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * 从扁平章节列表构建 ChapterNav。
 * 与 BookLoader.buildChapterNav 逻辑一致，但作为独立函数便于页面内使用。
 */
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

// ─── 模块级请求去重缓存 ───
// React 18 StrictMode 在开发环境会双重挂载组件，
// 仅用 cancelled 标记无法阻止第二次请求发出。
// 此缓存确保同一 bookId 的加载 Promise 全局唯一。

const _inflightRequests = new Map<string, Promise<{
  meta: BookMetadata;
  rawToc: TocEntry[];
  prog: ReadingProgress | null;
}>>();

// ─── 组件 ───

export const BookDetailPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;
  const getBookSource = useLibraryStore((s) => s.getBookSource);

  // ── 状态 ──
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  /** 嵌套的章节目录（保留分卷结构，用于展示） */
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  /** 扁平化的导航数据（用于获取总章节数等） */
  const [nav, setNav] = useState<ChapterNav | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;

    // 优先从 libraryStore 获取，刷新/直接访问时回退到自动推断
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

    // 模块级请求去重：同一 bookId 的加载复用已有 Promise
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
        // 请求完成后清除缓存，允许手动刷新
        _inflightRequests.delete(cacheKey);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, getBookSource]);

  /** 开始阅读：跳转到阅读器（可指定起始章节和恢复位置） */
  const handleStartReading = (startChapterId?: string) => {
    if (!bookId) return;
    navigate(`/reader/${bookId}`, {
      state: {
        chapterId: startChapterId,
        charOffset: progress?.charOffset,
        pageIndex: progress?.pageIndex,
        scrollOffset: progress?.scrollOffset,
      },
    });
  };

  // ─── 加载中 ───
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: colors['ui-background'],
          color: colors['ui-text-secondary'],
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: `3px solid ${colors['ui-border']}`,
              borderTopColor: colors['ui-accent'],
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <div style={{ fontSize: 14 }}>加载中...</div>
        </div>
      </div>
    );
  }

  // ─── 错误 ───
  if (error || !metadata) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: colors['ui-background'],
          color: colors['ui-text'],
        }}
      >
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>😞</div>
          <div
            style={{
              fontSize: 15,
              color: colors['ui-text-secondary'],
              marginBottom: 16,
            }}
          >
            {error || '书籍信息加载失败'}
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '8px 24px',
              border: 'none',
              borderRadius: 8,
              background: colors['ui-accent'],
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  // ─── 判断是否有分卷（有嵌套子章节的条目）───
  const hasVolumes = tocEntries.some(
    (entry) => entry.children && entry.children.length > 0,
  );

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
      {/* ── 封面 + 基本信息 ── */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        {/* 封面占位 */}
        <div
          style={{
            width: 80,
            height: 110,
            margin: '0 auto 12px',
            borderRadius: 8,
            background: `linear-gradient(135deg, ${colors['ui-accent']}40, ${colors['ui-accent']}20)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            fontWeight: 700,
            color: colors['ui-accent'],
          }}
        >
          {metadata.title.charAt(0)}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>
          {metadata.title}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: colors['ui-text-secondary'],
            margin: 0,
          }}
        >
          {metadata.author}
        </p>
      </div>

      {/* ── 元信息标签 ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 16,
          fontSize: 12,
          color: colors['ui-text-secondary'],
        }}
      >
        {metadata.wordCount && (
          <span>约 {Math.round(metadata.wordCount / 10000)} 万字</span>
        )}
        {nav && <span>{nav.totalChapters} 章</span>}
        {metadata.status && <span>{metadata.status}</span>}
      </div>

      {/* ── 标签 ── */}
      {metadata.tags && metadata.tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          {metadata.tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: '3px 10px',
                borderRadius: 12,
                background: colors['ui-background-secondary'],
                color: colors['ui-text-secondary'],
                fontSize: 11,
                border: `1px solid ${colors['ui-border']}`,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── 简介 ── */}
      {metadata.description && (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            borderRadius: 8,
            background: colors['ui-background-secondary'],
            fontSize: 13,
            lineHeight: 1.6,
            color: colors['ui-text-secondary'],
          }}
        >
          {metadata.description}
        </div>
      )}

      {/* ── 操作按钮 ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          onClick={() => handleStartReading()}
          style={{
            flex: 1,
            padding: '12px 0',
            border: 'none',
            borderRadius: 10,
            background: colors['ui-accent'],
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {progress ? '继续阅读' : '开始阅读'}
        </button>
      </div>

      {/* ── 章节目录 ── */}
      {nav && (
        <section>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              margin: '0 0 10px',
            }}
          >
            目录（共 {nav.totalChapters} 章）
          </h3>

          {/* ── 有分卷：按分卷分组展示 ── */}
          {hasVolumes
            ? tocEntries.map((entry) => {
                // 仅渲染有子章节的分卷条目
                if (entry.children && entry.children.length > 0) {
                  return (
                    <div key={entry.chapterId} style={{ marginBottom: 12 }}>
                      {/* 分卷标题 */}
                      <div
                        style={{
                          padding: '10px 8px 6px',
                          fontSize: 13,
                          fontWeight: 600,
                          color: colors['ui-text'],
                        }}
                      >
                        {entry.title}
                      </div>
                      {/* 卷内章节 */}
                      {entry.children.map((child) => (
                        <button
                          key={child.chapterId}
                          onClick={() => handleStartReading(child.chapterId)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '8px 8px 8px 20px',
                            border: 'none',
                            borderRadius: 6,
                            background: 'transparent',
                            color: colors['ui-text'],
                            fontSize: 13,
                            textAlign: 'left',
                            cursor: 'pointer',
                            marginBottom: 2,
                          }}
                        >
                          {child.title}
                        </button>
                      ))}
                    </div>
                  );
                }
                // 没有子章节的条目 → 直接渲染为章节按钮
                return (
                  <button
                    key={entry.chapterId}
                    onClick={() => handleStartReading(entry.chapterId)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      color: colors['ui-text'],
                      fontSize: 13,
                      textAlign: 'left',
                      cursor: 'pointer',
                      marginBottom: 2,
                    }}
                  >
                    {entry.title}
                  </button>
                );
              })
            : /* ── 无分卷：扁平章节列表 ── */
              nav.chapters.map((chapter) => (
                <button
                  key={chapter.chapterId}
                  onClick={() => handleStartReading(chapter.chapterId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 8px',
                    border: 'none',
                    borderRadius: 6,
                    background: 'transparent',
                    color: colors['ui-text'],
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    marginBottom: 2,
                  }}
                >
                  {chapter.title}
                </button>
              ))}
        </section>
      )}
    </div>
  );
};
