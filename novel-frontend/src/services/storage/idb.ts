/**
 * Re-export IndexedDB helpers from the engine cache module.
 *
 * This provides a clean service-level API for the rest of the app.
 */

export {
  saveBookMeta,
  getBookMeta,
  saveChapter as saveChapterDB,
  getChapter as getChapterDB,
  hasChapter,
  saveCachedPage,
  getCachedPage,
  deleteCachedPage,
  clearPagesForChapter,
  saveProgress as saveProgressDB,
  getProgress as getProgressDB,
  clearAllForBook,
  estimateStorageUsage,
} from '@engine/cache/ChapterCacheDB';

export type {
  CachedBookMeta,
  CachedTocEntry,
  CachedChapter,
  CachedPage,
  CachedProgress,
} from '@engine/cache/ChapterCacheDB';
