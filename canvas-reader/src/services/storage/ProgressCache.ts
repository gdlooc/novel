/**
 * ProgressCache — Persists and restores reading progress.
 *
 * Uses IndexedDB (durable, cross-session) with LocalStorage as
 * fast fallback for the current session.
 */

import { getItem, setItem } from './localStorage';

export interface ReadingProgress {
  bookId: string;
  chapterId: string;
  pageIndex: number;
  charOffset: number;
  updatedAt: number;
}

const PROGRESS_KEY_PREFIX = 'progress:';

/**
 * Save reading progress to both localStorage (fast) and IndexedDB (durable).
 */
export function saveReadingProgress(progress: ReadingProgress): void {
  progress.updatedAt = Date.now();

  // Fast save to localStorage
  setItem(`${PROGRESS_KEY_PREFIX}${progress.bookId}`, progress);

  // Durable save to IndexedDB (fire and forget)
  import('@engine/cache/ChapterCacheDB').then(({ saveProgress }) => {
    saveProgress(progress).catch((err) => {
      console.warn('[ProgressCache] IndexedDB save failed:', err);
    });
  });
}

/**
 * Restore reading progress.
 * Checks localStorage first (fast), then falls back to IndexedDB.
 */
export async function restoreReadingProgress(
  bookId: string,
): Promise<ReadingProgress | null> {
  // Check localStorage first (synchronous, instant)
  const local = getItem<ReadingProgress | null>(
    `${PROGRESS_KEY_PREFIX}${bookId}`,
    null,
  );
  if (local && local.chapterId) {
    return local;
  }

  // Fall back to IndexedDB
  try {
    const { getProgress: getProgressDB } = await import(
      '@engine/cache/ChapterCacheDB'
    );
    const stored = await getProgressDB(bookId);
    if (stored) {
      return {
        bookId: stored.bookId,
        chapterId: stored.chapterId,
        pageIndex: stored.pageIndex,
        charOffset: stored.charOffset,
        updatedAt: stored.updatedAt,
      };
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Clear reading progress for a book.
 */
export function clearReadingProgress(bookId: string): void {
  import('./localStorage').then(({ removeItem }) => {
    removeItem(`${PROGRESS_KEY_PREFIX}${bookId}`);
  });
}
