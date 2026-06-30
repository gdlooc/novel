/**
 * usePageTurn — Page turn state machine.
 *
 * Manages the logic of navigating between pages, including:
 * - Prev/next page within a chapter
 * - Chapter boundary crossing (auto-load next/prev chapter)
 * - Progress saving on page turn
 */

import { useCallback } from 'react';
import { useReaderStore } from '@store/readerStore';
import { useUIStore } from '@store/uiStore';

export interface PageTurnResult {
  /** Whether the turn was successful */
  success: boolean;
  /** Reason if not successful */
  reason?: 'end-of-book' | 'start-of-book' | 'no-chapter' | 'loading';
}

export function usePageTurn(
  onChapterChange?: (chapterId: string) => Promise<void>,
) {
  const {
    chapterNav,
    chapterId,
    currentPageIndex,
    totalPagesInChapter,
    nextPage,
    prevPage,
    currentPage,
  } = useReaderStore();
  const hideAllPanels = useUIStore((s) => s.hideAllPanels);

  /**
   * Turn to the next page.
   * If at the end of the chapter, loads the next chapter.
   */
  const goNext = useCallback(async (): Promise<PageTurnResult> => {
    const state = useReaderStore.getState();

    if (!state.chapterId || !state.chapterNav) {
      return { success: false, reason: 'no-chapter' };
    }

    // Check if next page is already available
    if (state.nextPage) {
      const nav = state.chapterNav;
      const next = state.nextPage;
      const prev = state.currentPage;
      // Find the page after nextPage (or null)
      const nextAfter = totalPagesInChapter > 0 && next.pageIndex + 1 < totalPagesInChapter
        ? null // Not computed yet
        : null;

      useReaderStore.getState().setCurrentPage(next, prev, nextAfter);
      hideAllPanels();
      return { success: true };
    }

    // Check if we're at the end of the chapter
    // totalPagesInChapter 优先：图片章节由 ReaderShell 修正为 图片数+文本页数
    const effectiveTotal = totalPagesInChapter > 0 ? totalPagesInChapter : -1;
    if (
      (effectiveTotal > 0 && currentPageIndex >= effectiveTotal - 1) ||
      (effectiveTotal <= 0 && state.currentPage?.isLastPage)
    ) {
      // Navigate to next chapter
      const nav = state.chapterNav;
      const nextChapter = nav.getNext(state.chapterId);
      if (nextChapter && onChapterChange) {
        useUIStore.getState().setLoading(true, '加载下一章...');
        try {
          await onChapterChange(nextChapter.chapterId);
          hideAllPanels();
          return { success: true };
        } finally {
          useUIStore.getState().setLoading(false);
        }
      }
      return { success: false, reason: 'end-of-book' };
    }

    // Need to compute more pages — trigger layout
    return { success: false, reason: 'loading' };
  }, [chapterId, currentPageIndex, totalPagesInChapter, nextPage, currentPage, onChapterChange, hideAllPanels]);

  /**
   * Turn to the previous page.
   * If at the start of the chapter, loads the previous chapter's last page.
   */
  const goPrev = useCallback(async (): Promise<PageTurnResult> => {
    const state = useReaderStore.getState();

    if (!state.chapterId || !state.chapterNav) {
      return { success: false, reason: 'no-chapter' };
    }

    // Check if previous page is already available
    if (state.prevPage) {
      const next = state.currentPage;
      const prev = state.prevPage;
      // Find the page before prevPage
      const prevBefore = prev.pageIndex > 0 ? null : null;

      useReaderStore.getState().setCurrentPage(prev, prevBefore, next);
      hideAllPanels();
      return { success: true };
    }

    // Check if at the start of the chapter
    if (currentPageIndex === 0) {
      const nav = state.chapterNav;
      const prevChapter = nav.getPrev(state.chapterId);
      if (prevChapter && onChapterChange) {
        useUIStore.getState().setLoading(true, '加载上一章...');
        try {
          await onChapterChange(prevChapter.chapterId);
          // Jump to last page of the previous chapter
          hideAllPanels();
          return { success: true };
        } finally {
          useUIStore.getState().setLoading(false);
        }
      }
      return { success: false, reason: 'start-of-book' };
    }

    return { success: false, reason: 'loading' };
  }, [chapterId, currentPageIndex, prevPage, currentPage, onChapterChange, hideAllPanels]);

  return { goNext, goPrev };
}
