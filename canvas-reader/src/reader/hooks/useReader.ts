/**
 * useReader — Central reader controller hook.
 *
 * Coordinates the entire reading pipeline:
 * 1. Book/chapter loading
 * 2. Layout computation (via worker or main thread)
 * 3. Canvas rendering
 * 4. Page navigation
 * 5. Progress persistence
 *
 * This is the main hook used by ReaderShell to control the reader.
 */

import { useCallback, useRef, useEffect } from 'react';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';
import { getBookLoader, loadChapter } from '@book/index';
import { saveHistoryEntry, buildHistoryEntry } from '@/services/storage/HistoryCache';
import { hashLayoutConfig } from '@engine/layout/Paginator';
import type { BookSource } from '@book/types';
import { TextLayoutEngine } from '@engine/layout/TextLayoutEngine';
import { PageCacheManager } from '@engine/cache/PageCacheManager';
import type { LayoutConfig } from '@engine/layout/types';
import type { CanvasDimensions } from './useCanvasResize';

export interface UseReaderOptions {
  /** Canvas dimensions for layout */
  canvasDimensions: CanvasDimensions | null;
  /**
   * 翻页动画回调。
   * 在 store.setCurrentPage() 之前调用，用于播放翻页过渡动画。
   * 回调返回的 Promise resolve 后，store 才会更新。
   * 如果未提供，翻页将瞬间切换（无动画）。
   */
  onBeforePageTurn?: (
    fromPage: import('@engine/layout/types').PageDescriptor,
    toPage: import('@engine/layout/types').PageDescriptor,
    direction: number,
  ) => Promise<void>;
}

export function useReader({ canvasDimensions, onBeforePageTurn }: UseReaderOptions) {
  const store = useReaderStore();
  const settings = useSettingsStore();
  const ui = useUIStore();

  // Engine instances (not state — refs to avoid re-creation)
  const layoutEngineRef = useRef<TextLayoutEngine>(new TextLayoutEngine());
  const pageCacheRef = useRef<PageCacheManager>(new PageCacheManager({ maxSize: 30 }));
  // Track debounce timer for settings changes
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── CRITICAL: Use a ref for canvas dimensions to avoid stale closures ───
  // The canvas dimensions arrive asynchronously via ResizeObserver.
  // Callbacks like goToChapter and openBook are created on first render
  // when canvasDimensions is null. Without a ref, they would forever
  // see the null value even after the ResizeObserver fires.
  const canvasDimsRef = useRef<CanvasDimensions | null>(canvasDimensions);
  // Sync the ref whenever the prop updates
  useEffect(() => {
    canvasDimsRef.current = canvasDimensions;
  }, [canvasDimensions]);

  /**
   * Get the current layout config based on viewport dimensions.
   * Reads from the ref (always current) rather than the prop (may be stale).
   */
  const getLayoutConfig = useCallback((): LayoutConfig | null => {
    const dims = canvasDimsRef.current;
    if (!dims || dims.cssWidth === 0) return null;
    return settings.getLayoutConfig(dims.cssWidth, dims.cssHeight);
  }, [settings]);

  /**
   * Run the layout engine on the current chapter text.
   * Uses charOffset (invariant across font changes) to preserve reading position.
   */
  const layoutCurrentChapter = useCallback(
    (
      text: string,
      config: LayoutConfig,
      chapterId: string,
      startPageIndex: number = 0,
      startCharOffset?: number,
    ) => {
      store.setStatus('laying-out');

      try {
        const engine = layoutEngineRef.current;
        const cache = pageCacheRef.current;

        const result = engine.layout(chapterId, text, config, {
          startPageIndex,
          maxPages: 10,
          startCharOffset,
        });

        if (result.pages.length > 0) {
          const currentPage = result.pages[0];

          // Cache pages
          for (const page of result.pages) {
            cache.set(chapterId, page.pageIndex, page, config);
            store.setTotalPages(
              page.totalPagesKnown > 0 ? page.totalPagesKnown : -1,
            );
          }

          // Get adjacent pages
          const prevPage =
            currentPage.pageIndex > 0
              ? cache.get(chapterId, currentPage.pageIndex - 1)
              : null;
          const nextPage =
            !currentPage.isLastPage
              ? cache.get(chapterId, currentPage.pageIndex + 1)
              : null;

          store.setCurrentPage(currentPage, prevPage ?? null, nextPage ?? null);
        } else {
          store.setStatus('error', '排版结果为空');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '排版失败';
        store.setStatus('error', message);
      }
    },
    [store],
  );

  /**
   * 导航到指定章节。
   *
   * 包含最小加载动画显示时长（700ms），避免加载过快时
   * loading spinner 一闪而过造成的体验割裂感。
   *
   * @param chapterId - 目标章节 ID
   * @param targetPageIndex - 跳转到指定页码（翻页模式），-1 表示跳到最后一页
   * @param startCharOffset - 字符偏移量（布局无关定位，优先级高于 pageIndex）
   */
  const goToChapter = useCallback(
    async (chapterId: string, targetPageIndex?: number, startCharOffset?: number) => {
      const state = useReaderStore.getState();
      if (!state.bookSource || !state.bookMetadata) return;

      // 记录开始时间，用于保证加载动画的最短显示时长
      const loadStartTime = performance.now();
      store.setStatus('loading-chapter');
      ui.setLoading(true, '加载章节...');

      try {
        const source = state.bookSource;
        const bookId = state.bookMetadata.bookId;

        const content = await loadChapter(source, chapterId, bookId);

        store.setChapter(chapterId, content.title, content.content);

        // 同步更新历史记录和阅读进度（fire-and-forget）
        const currentBookMeta = state.bookMetadata;
        if (currentBookMeta) {
          const bookId = currentBookMeta.bookId;
          // 历史记录
          saveHistoryEntry(
            buildHistoryEntry(currentBookMeta, state.bookSource, {
              chapterId,
              chapterTitle: content.title,
            }),
          ).catch((err) => console.warn('[useReader] 更新历史记录失败:', err));
          // 阅读进度（openBook 恢复位置时读取）
          import('@/services/storage/ProgressCache').then(({ saveReadingProgress }) => {
            // layoutCurrentChapter 已同步执行，readerStore 中已有当前页的 charOffset
            const readerState = useReaderStore.getState();
            saveReadingProgress({
              bookId,
              chapterId,
              pageIndex: readerState.currentPageIndex,
              charOffset: readerState.currentCharOffset,
              updatedAt: Date.now(),
            });
          }).catch((err) => console.warn('[useReader] 保存进度失败:', err));
        }

        // 触发排版 — getLayoutConfig 从 ref 读取，始终是最新值
        const config = getLayoutConfig();
        if (config) {
          layoutCurrentChapter(
            content.content,
            config,
            chapterId,
            targetPageIndex ?? 0,
            startCharOffset, // 布局无关定位：字号/窗口变化后仍能找到正确位置
          );
        } else {
          // Canvas 尺寸尚未就绪
          store.setStatus('error', '页面尺寸未就绪，请刷新重试');
          return; // 尺寸未就绪直接返回，不进入延迟逻辑
        }

        // ── 确保加载动画最少显示 500ms ──
        // layoutCurrentChapter 内部会将 status 设为 'ready'，
        // 导致 loading 遮罩立即消失。这里覆写回 'loading-chapter'
        // 以保持遮罩可见，让用户感知到「正在切换」。
        store.setStatus('loading-chapter');

        const elapsed = performance.now() - loadStartTime;
        const MIN_LOADING_DURATION = 500;
        if (elapsed < MIN_LOADING_DURATION) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_LOADING_DURATION - elapsed),
          );
        }

        // 延迟结束后恢复为 ready，遮罩消失，新内容呈现
        store.setStatus('ready');
      } catch (err) {
        // 错误情况下不做延迟，让用户尽快看到错误信息
        const message = err instanceof Error ? err.message : '加载章节失败';
        store.setStatus('error', message);
      } finally {
        ui.setLoading(false);
      }
    },
    [store, ui, getLayoutConfig, layoutCurrentChapter],
  );

  /**
   * Open a book. Loads metadata, TOC, restores progress, and opens the first/last chapter.
   */
  const openBook = useCallback(
    async (source: BookSource) => {
      store.setStatus('loading-book');
      ui.setLoading(true, '正在加载书籍...');

      try {
        const loader = getBookLoader();
        const { metadata, nav } = await loader.loadBook(source);

        store.setBookInfo(source, metadata, nav);

        // 保存阅读历史记录（fire-and-forget，不阻塞加载流程）
        saveHistoryEntry(
          buildHistoryEntry(metadata, source),
        ).catch((err) => console.warn('[useReader] 保存历史记录失败:', err));

        // Wait for canvas dimensions to be available (ResizeObserver may not have fired yet)
        // Poll the ref until dimensions are available, with a timeout
        const configReady = await waitForCanvasDims(canvasDimsRef, 3000);
        if (!configReady) {
          store.setStatus('error', '页面尺寸获取超时，请刷新重试');
          return;
        }

        // Try to restore reading progress
        const { restoreReadingProgress } = await import(
          '@/services/storage/ProgressCache'
        );
        const progress = await restoreReadingProgress(metadata.bookId);
        const startChapterId = progress?.chapterId || nav.chapters[0]?.chapterId;

        if (startChapterId) {
          // 传入保存的页码和字符偏移量用于恢复阅读位置
          await goToChapter(
            startChapterId,
            progress?.pageIndex,
            progress?.charOffset,
          );

          // 滚动模式：若排版配置未变，恢复上次滚动位置
          if (progress?.scrollOffset !== undefined && progress?.layoutConfigHash) {
            const config = getLayoutConfig();
            if (config && hashLayoutConfig(config) === progress.layoutConfigHash) {
              store.setPendingScrollRestore(progress.scrollOffset);
            }
          }
        } else {
          store.setStatus('error', '没有找到可读章节');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '加载书籍失败';
        store.setStatus('error', message);
      } finally {
        ui.setLoading(false);
      }
    },
    [store, ui, goToChapter],
  );

  /**
   * Ensure pages around the current page are computed (extend window).
   */
  const ensurePagesAround = useCallback(
    async (pageIndex: number, count: number = 5) => {
      const state = useReaderStore.getState();
      if (!state.chapterText || !state.chapterId) return;

      const config = getLayoutConfig();
      if (!config) return;

      const engine = layoutEngineRef.current;
      const cache = pageCacheRef.current;

      // Check which pages need computing
      const startPage = Math.max(0, pageIndex - Math.floor(count / 2));
      const endPage = pageIndex + Math.floor(count / 2);

      for (let p = startPage; p <= endPage; p++) {
        if (!cache.has(state.chapterId, p)) {
          const result = engine.layout(state.chapterId, state.chapterText, config, {
            startPageIndex: p,
            maxPages: count,
          });

          for (const page of result.pages) {
            cache.set(state.chapterId, page.pageIndex, page, config);
            if (page.totalPagesKnown > 0) {
              store.setTotalPages(page.totalPagesKnown);
            }
          }
          break; // One batch per call
        }
      }
    },
    [store, getLayoutConfig],
  );

  /**
   * 保存当前阅读进度（翻页/切换章节后调用）。
   * fire-and-forget，不阻塞翻页动画。
   */
  const persistProgress = useCallback(() => {
    const s = useReaderStore.getState();
    if (!s.bookMetadata || !s.chapterId) return;

    const config = getLayoutConfig();
    import('@/services/storage/ProgressCache').then(({ saveReadingProgress }) => {
      saveReadingProgress({
        bookId: s.bookMetadata!.bookId,
        chapterId: s.chapterId!,
        pageIndex: s.currentPageIndex,
        charOffset: s.currentCharOffset,
        // 附带排版配置哈希，恢复时可验证 pageIndex 是否仍有效
        layoutConfigHash: config ? hashLayoutConfig(config) : undefined,
        updatedAt: Date.now(),
      });
    }).catch(() => {/* 静默失败 */});
  }, [getLayoutConfig]);

  /**
   * Turn page forward.
   */
  const nextPage = useCallback(async () => {
    const state = useReaderStore.getState();
    if (!state.chapterId || !state.chapterText) return;

    if (state.nextPage) {
      const fromPage = state.currentPage!;
      const toPage = state.nextPage;
      const cache = pageCacheRef.current;

      const nextNext = cache.get(state.chapterId, toPage.pageIndex + 1);
      if (!nextNext && !toPage.isLastPage) {
        await ensurePagesAround(toPage.pageIndex + 1, 3);
      }

      // 播放翻页动画
      if (onBeforePageTurn) {
        await onBeforePageTurn(fromPage, toPage, 1);
      }

      const nextNextCached = cache.get(state.chapterId, toPage.pageIndex + 1) ?? null;
      store.setCurrentPage(toPage, fromPage, nextNextCached);
      persistProgress();
      return;
    }

    if (state.currentPage?.isLastPage) {
      const nav = state.chapterNav;
      const nextChapter = nav?.getNext(state.chapterId);
      if (nextChapter) {
        await goToChapter(nextChapter.chapterId, 0);
        return;
      }
      return;
    }

    if (state.currentPage) {
      await ensurePagesAround(state.currentPage.pageIndex + 1, 5);
      const cache = pageCacheRef.current;
      const toPage = cache.get(state.chapterId, state.currentPage.pageIndex + 1);
      if (toPage) {
        // 播放翻页动画
        if (onBeforePageTurn) {
          await onBeforePageTurn(state.currentPage, toPage, 1);
        }
        store.setCurrentPage(toPage, state.currentPage, null);
        persistProgress();
      }
    }
  }, [store, ensurePagesAround, goToChapter, onBeforePageTurn, persistProgress]);

  /**
   * Turn page backward.
   */
  const prevPage = useCallback(async () => {
    const state = useReaderStore.getState();
    if (!state.chapterId || !state.chapterText) return;

    if (state.prevPage) {
      const fromPage = state.currentPage!;
      const toPage = state.prevPage;
      const cache = pageCacheRef.current;
      const prevPrev = cache.get(state.chapterId, toPage.pageIndex - 1) ?? null;

      // 播放翻页动画
      if (onBeforePageTurn) {
        await onBeforePageTurn(fromPage, toPage, -1);
      }

      store.setCurrentPage(toPage, prevPrev, fromPage);
      persistProgress();
      return;
    }

    if (state.currentPageIndex === 0) {
      const nav = state.chapterNav;
      const prevChapter = nav?.getPrev(state.chapterId);
      if (prevChapter) {
        await goToChapter(prevChapter.chapterId, -1);
        return;
      }
      return;
    }

    if (state.currentPage) {
      await ensurePagesAround(state.currentPage.pageIndex - 1, 5);
      const cache = pageCacheRef.current;
      const toPage = cache.get(state.chapterId, state.currentPage.pageIndex - 1);
      if (toPage) {
        // 播放翻页动画
        if (onBeforePageTurn) {
          await onBeforePageTurn(state.currentPage, toPage, -1);
        }
        store.setCurrentPage(toPage, null, state.currentPage);
        persistProgress();
      }
    }
  }, [store, ensurePagesAround, goToChapter, onBeforePageTurn, persistProgress]);

  /**
   * Handle settings change (font size, theme, etc.).
   * Debounces to avoid re-layout on every slider tick.
   */
  const onSettingsChanged = useCallback(() => {
    if (relayoutTimerRef.current) {
      clearTimeout(relayoutTimerRef.current);
    }

    relayoutTimerRef.current = setTimeout(async () => {
      const state = useReaderStore.getState();
      if (!state.chapterText || !state.chapterId) return;

      const config = getLayoutConfig();
      if (!config) return;

      pageCacheRef.current.clear();
      layoutEngineRef.current.reset();

      await layoutCurrentChapter(
        state.chapterText,
        config,
        state.chapterId,
        0, // pageIndex not reliable after config change
        state.currentCharOffset, // charOffset is invariant across layout changes
      );
    }, 300);
  }, [getLayoutConfig, layoutCurrentChapter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (relayoutTimerRef.current) {
        clearTimeout(relayoutTimerRef.current);
      }
    };
  }, []);

  return {
    openBook,
    goToChapter,
    nextPage,
    prevPage,
    ensurePagesAround,
    onSettingsChanged,
    layoutEngineRef,
    pageCacheRef,
  };
}

/**
 * Wait for canvas dimensions to become available.
 * The ResizeObserver fires asynchronously after mount, so we may need
 * to wait briefly for the canvas to be measured.
 */
function waitForCanvasDims(
  ref: React.MutableRefObject<CanvasDimensions | null>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Check immediately
    if (ref.current && ref.current.cssWidth > 0) {
      resolve(true);
      return;
    }

    // Poll every 50ms
    const start = Date.now();
    const interval = setInterval(() => {
      if (ref.current && ref.current.cssWidth > 0) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 50);
  });
}
