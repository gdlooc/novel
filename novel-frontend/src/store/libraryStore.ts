/**
 * libraryStore — 书库/浏览状态管理。
 *
 * 管理：
 * - 当前已知书籍的 BookSource 映射（bookId → BookSource）
 * - 用于页面间传递 BookSource（详情页 → 阅读器页）
 */

import { create } from 'zustand';
import type { BookSource } from '@book/types';

export interface LibraryState {
  /** bookId → BookSource 映射 */
  bookSources: Record<string, BookSource>;

  /** 添加或更新一个书籍来源 */
  setBookSource: (bookId: string, source: BookSource) => void;

  /** 获取一个书籍来源 */
  getBookSource: (bookId: string) => BookSource | undefined;

  /** 批量导入书籍来源 */
  setBookSources: (sources: Record<string, BookSource>) => void;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  bookSources: {},

  setBookSource: (bookId, source) => {
    set((state) => ({
      bookSources: { ...state.bookSources, [bookId]: source },
    }));
  },

  getBookSource: (bookId) => {
    return get().bookSources[bookId];
  },

  setBookSources: (sources) => {
    set((state) => ({
      bookSources: { ...state.bookSources, ...sources },
    }));
  },
}));
