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
   * Navigate to a specific chapter.
   */
  const goToChapter = useCallback(
    async (chapterId: string, targetPageIndex?: number) => {
      const state = useReaderStore.getState();
      if (!state.bookSource || !state.bookMetadata) return;

      store.setStatus('loading-chapter');
      ui.setLoading(true, '加载章节...');

      try {
        const source = state.bookSource;
        const bookId = state.bookMetadata.bookId;

        const content = await loadChapter(source, chapterId, bookId);

        store.setChapter(chapterId, content.title, content.content);

        // Trigger layout — getLayoutConfig reads from ref, always current
        const config = getLayoutConfig();
        if (config) {
          layoutCurrentChapter(
            content.content,
            config,
            chapterId,
            targetPageIndex ?? 0,
          );
        } else {
          // Canvas dimensions not ready yet — wait briefly and retry
          store.setStatus('error', '页面尺寸未就绪，请刷新重试');
        }
      } catch (err) {
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
          await goToChapter(startChapterId);
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
      }
    }
  }, [store, ensurePagesAround, goToChapter, onBeforePageTurn]);

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
      }
    }
  }, [store, ensurePagesAround, goToChapter, onBeforePageTurn]);

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
