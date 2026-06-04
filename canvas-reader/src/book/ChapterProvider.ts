/**
 * ChapterProvider — Fetches and caches chapter content.
 *
 * Coordinates between:
 * 1. Format adapters (reading from source)
 * 2. IndexedDB cache (persistent storage)
 * 3. The reader (consumer)
 *
 * Uses a "cache-first, network-fallback" strategy:
 * 1. Check IndexedDB cache
 * 2. If not cached or stale, fetch via adapter
 * 3. Store in IndexedDB for future use
 */

import type { IBookFormat } from './formats/IBookFormat';
import type { BookSource, ChapterContent } from './types';
import { getBookLoader } from './BookLoader';
import {
  hasChapter,
  getChapter,
  saveChapter,
  type CachedChapter,
} from '@engine/cache/ChapterCacheDB';

/** Options for chapter loading */
export interface ChapterLoadOptions {
  /** Force re-fetch, bypassing cache */
  forceRefresh?: boolean;
  /** Signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Load a single chapter's content.
 *
 * Uses the book source to find the appropriate adapter,
 * checks cache first, then fetches from source if needed.
 */
export async function loadChapter(
  source: BookSource,
  chapterId: string,
  bookId: string,
  options: ChapterLoadOptions = {},
): Promise<ChapterContent> {
  const { forceRefresh = false } = options;

  // Check cache first
  if (!forceRefresh) {
    const cached = await getChapter(bookId, chapterId);
    if (cached) {
      return {
        chapterId: cached.chapterId,
        title: cached.title,
        content: cached.content,
        images: [],
        // These might not be in cache — they'll be filled in on navigation
        prevChapterId: undefined,
        nextChapterId: undefined,
      };
    }
  }

  // Fetch via adapter
  const loader = getBookLoader();
  const adapter = loader.findAdapter(source);
  if (!adapter) {
    throw new Error(`No adapter found for source: ${source.type}`);
  }

  const content = await adapter.getChapterContent(source, chapterId);

  // Cache for future use
  const cached: CachedChapter = {
    chapterId: `${bookId}:${chapterId}`,
    bookId,
    title: content.title,
    content: content.content,
    cachedAt: Date.now(),
    size: content.content.length,
  };

  // Fire-and-forget cache (don't block on cache writes)
  saveChapter(cached).catch((err) => {
    console.warn('[ChapterProvider] Failed to cache chapter:', err);
  });

  return content;
}

/**
 * Preload chapters for anticipatory reading.
 * Loads in background without blocking the current operation.
 */
export async function preloadChapters(
  source: BookSource,
  bookId: string,
  chapterIds: string[],
  maxConcurrent: number = 2,
): Promise<void> {
  // Only load chapters not already in cache
  const toLoad: string[] = [];
  for (const cid of chapterIds) {
    const cached = await hasChapter(bookId, cid);
    if (!cached) {
      toLoad.push(cid);
    }
  }

  if (toLoad.length === 0) return;

  // Load with concurrency limit
  const queue = [...toLoad];

  async function worker() {
    while (queue.length > 0) {
      const cid = queue.shift();
      if (cid) {
        try {
          await loadChapter(source, cid, bookId);
        } catch {
          // Preload failures are non-fatal
          console.warn(`[ChapterProvider] Preload failed for chapter ${cid}`);
        }
      }
    }
  }

  // Start concurrent workers
  const workers = Array.from(
    { length: Math.min(maxConcurrent, queue.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

/**
 * Check if a chapter is available offline (cached in IndexedDB).
 */
export async function isChapterCached(
  bookId: string,
  chapterId: string,
): Promise<boolean> {
  return hasChapter(bookId, chapterId);
}
