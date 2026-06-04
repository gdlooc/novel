/**
 * readerStore — Core reading state.
 *
 * Tracks which book/chapter/page the user is reading.
 * Coordinates with settingsStore for layout config.
 * Saves/restores progress via ProgressCache.
 */

import { create } from 'zustand';
import type { BookSource, ChapterNav, BookMetadata } from '@book/types';
import type { PageDescriptor, LayoutConfig } from '@engine/layout/types';

/** Page turn direction */
export type PageDirection = 'next' | 'prev';

/** Reader lifecycle states */
export type ReaderStatus =
  | 'idle'
  | 'loading-book'
  | 'loading-chapter'
  | 'laying-out'
  | 'ready'
  | 'error';

export interface ReaderState {
  // ─── Book identity ───
  status: ReaderStatus;
  error: string | null;
  bookSource: BookSource | null;
  bookMetadata: BookMetadata | null;
  chapterNav: ChapterNav | null;

  // ─── Current position ───
  chapterId: string | null;
  chapterTitle: string | null;
  chapterText: string | null;
  currentPageIndex: number;
  currentCharOffset: number;

  // ─── Page data ───
  currentPage: PageDescriptor | null;
  nextPage: PageDescriptor | null;
  prevPage: PageDescriptor | null;
  totalPagesInChapter: number;
  chapterProgress: number; // 0.0 - 1.0

  // ─── Layout ───
  layoutConfigHash: string | null;
  /** 每次排版递增，用于驱动滚动模式渲染刷新 */
  layoutVersion: number;

  // ─── Actions ───
  setBookInfo: (
    source: BookSource,
    metadata: BookMetadata,
    nav: ChapterNav,
  ) => void;
  setChapter: (
    chapterId: string,
    title: string,
    text: string,
  ) => void;
  setCurrentPage: (
    page: PageDescriptor,
    prev: PageDescriptor | null,
    next: PageDescriptor | null,
  ) => void;
  setTotalPages: (total: number) => void;
  setLayoutConfigHash: (hash: string) => void;
  setStatus: (status: ReaderStatus, error?: string) => void;
  updateProgress: () => void;
  reset: () => void;
}

const initialState = {
  status: 'idle' as ReaderStatus,
  error: null,
  bookSource: null,
  bookMetadata: null,
  chapterNav: null,
  chapterId: null,
  chapterTitle: null,
  chapterText: null,
  currentPageIndex: 0,
  currentCharOffset: 0,
  currentPage: null,
  nextPage: null,
  prevPage: null,
  totalPagesInChapter: -1,
  chapterProgress: 0,
  layoutConfigHash: null,
  layoutVersion: 0,
};

export const useReaderStore = create<ReaderState>()((set, get) => ({
  ...initialState,

  setBookInfo: (source, metadata, nav) => {
    set({
      bookSource: source,
      bookMetadata: metadata,
      chapterNav: nav,
      status: 'loading-chapter',
    });
  },

  setChapter: (chapterId, title, text) => {
    set({
      chapterId,
      chapterTitle: title,
      chapterText: text,
      currentPageIndex: 0,
      currentCharOffset: 0,
      currentPage: null,
      nextPage: null,
      prevPage: null,
      totalPagesInChapter: -1,
      chapterProgress: 0,
      status: 'laying-out',
    });
  },

  setCurrentPage: (page, prev, next) => {
    const { totalPagesInChapter, layoutVersion } = get();
    const effectiveTotal =
      totalPagesInChapter > 0
        ? totalPagesInChapter
        : page.totalPagesKnown > 0
          ? page.totalPagesKnown
          : -1;

    set({
      currentPage: page,
      currentPageIndex: page.pageIndex,
      currentCharOffset: page.charStart,
      prevPage: prev,
      nextPage: next,
      chapterProgress:
        effectiveTotal > 0
          ? Math.min(1, page.pageIndex / Math.max(1, effectiveTotal - 1))
          : 0,
      status: 'ready',
      layoutVersion: layoutVersion + 1,
    });
  },

  setTotalPages: (total) => {
    set({ totalPagesInChapter: total });
  },

  setLayoutConfigHash: (hash) => {
    set({ layoutConfigHash: hash });
  },

  setStatus: (status, error) => {
    set({ status, error: error ?? null });
  },

  updateProgress: () => {
    const { currentCharOffset, chapterProgress } = get();
    set({
      currentCharOffset,
      chapterProgress,
    });
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Selectors (for use with zustand selectors to avoid re-renders) ───

export const selectReaderStatus = (s: ReaderState) => s.status;
export const selectCurrentPage = (s: ReaderState) => s.currentPage;
export const selectCurrentPageIndex = (s: ReaderState) => s.currentPageIndex;
export const selectChapterId = (s: ReaderState) => s.chapterId;
export const selectChapterTitle = (s: ReaderState) => s.chapterTitle;
export const selectChapterProgress = (s: ReaderState) => s.chapterProgress;
