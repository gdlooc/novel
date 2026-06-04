/**
 * ChapterCacheDB — IndexedDB-based persistent cache for chapter content
 * and book metadata.
 *
 * Uses the 'idb' library for a cleaner promise-based API.
 *
 * Schema:
 *   Database: canvas-reader-db (version 1)
 *   ├── books: { key: bookId } → BookMetadata + TOC
 *   ├── chapters: { key: `${bookId}:${chapterId}` } → ChapterContent
 *   ├── pages: { key: `${bookId}:${chapterId}:${pageIndex}` } → CachedPage
 *   └── progress: { key: bookId } → ReadingProgress
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';
import { hashLayoutConfig } from '../layout/Paginator';

/** Book metadata stored in IndexedDB */
export interface CachedBookMeta {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  toc: CachedTocEntry[];
  cachedAt: number;
  wordCount?: number;
}

export interface CachedTocEntry {
  chapterId: string;
  title: string;
  level: number; // 0 = volume, 1 = chapter
  children?: CachedTocEntry[];
}

/** Chapter content stored in IndexedDB */
export interface CachedChapter {
  chapterId: string;
  bookId: string;
  title: string;
  content: string;
  cachedAt: number;
  size: number;
}

/** Cached page data */
export interface CachedPage {
  pageId: string; // `${bookId}:${chapterId}:${pageIndex}`
  page: PageDescriptor;
  configHash: string;
  cachedAt: number;
}

/** Reading progress stored in IndexedDB */
export interface CachedProgress {
  bookId: string;
  chapterId: string;
  pageIndex: number;
  charOffset: number;
  updatedAt: number;
}

const DB_NAME = 'canvas-reader-db';
const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_CHAPTERS = 'chapters';
const STORE_PAGES = 'pages';
const STORE_PROGRESS = 'progress';

/**
 * Open (or create) the IndexedDB database.
 */
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        db.createObjectStore(STORE_CHAPTERS, { keyPath: 'chapterId' });
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, { keyPath: 'pageId' });
      }
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        db.createObjectStore(STORE_PROGRESS, { keyPath: 'bookId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Helper to perform a transaction.
 */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);

    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      result.then(resolve).catch(reject);
    }
  });
}

// ─── Books ───

export async function saveBookMeta(meta: CachedBookMeta): Promise<void> {
  meta.cachedAt = Date.now();
  await withStore(STORE_BOOKS, 'readwrite', (store) => store.put(meta));
}

export async function getBookMeta(bookId: string): Promise<CachedBookMeta | undefined> {
  return withStore(STORE_BOOKS, 'readonly', (store) => store.get(bookId));
}

// ─── Chapters ───

export async function saveChapter(chapter: CachedChapter): Promise<void> {
  chapter.cachedAt = Date.now();
  await withStore(STORE_CHAPTERS, 'readwrite', (store) => store.put(chapter));
}

export async function getChapter(
  bookId: string,
  chapterId: string,
): Promise<CachedChapter | undefined> {
  const key = `${bookId}:${chapterId}`;
  return withStore(STORE_CHAPTERS, 'readonly', (store) => store.get(key));
}

export async function hasChapter(bookId: string, chapterId: string): Promise<boolean> {
  const key = `${bookId}:${chapterId}`;
  const result = await withStore(STORE_CHAPTERS, 'readonly', (store) => store.get(key));
  return result !== undefined;
}

// ─── Pages ───

export async function saveCachedPage(
  bookId: string,
  chapterId: string,
  pageIndex: number,
  page: PageDescriptor,
  config: LayoutConfig,
): Promise<void> {
  const pageId = `${bookId}:${chapterId}:${pageIndex}`;
  const entry: CachedPage = {
    pageId,
    page,
    configHash: hashLayoutConfig(config),
    cachedAt: Date.now(),
  };
  await withStore(STORE_PAGES, 'readwrite', (store) => store.put(entry));
}

export async function getCachedPage(
  bookId: string,
  chapterId: string,
  pageIndex: number,
  configHash?: string,
): Promise<PageDescriptor | undefined> {
  const pageId = `${bookId}:${chapterId}:${pageIndex}`;
  const entry: CachedPage | undefined = await withStore(
    STORE_PAGES,
    'readonly',
    (store) => store.get(pageId),
  );

  if (!entry) return undefined;
  if (configHash && entry.configHash !== configHash) {
    // Config changed → page is stale
    await deleteCachedPage(bookId, chapterId, pageIndex);
    return undefined;
  }
  return entry.page;
}

export async function deleteCachedPage(
  bookId: string,
  chapterId: string,
  pageIndex: number,
): Promise<void> {
  const pageId = `${bookId}:${chapterId}:${pageIndex}`;
  await withStore(STORE_PAGES, 'readwrite', (store) => store.delete(pageId));
}

export async function clearPagesForChapter(
  bookId: string,
  chapterId: string,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_PAGES, 'readwrite');
  const store = tx.objectStore(STORE_PAGES);
  const prefix = `${bookId}:${chapterId}:`;

  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if ((cursor.key as string).startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── Progress ───

export async function saveProgress(progress: CachedProgress): Promise<void> {
  progress.updatedAt = Date.now();
  await withStore(STORE_PROGRESS, 'readwrite', (store) => store.put(progress));
}

export async function getProgress(bookId: string): Promise<CachedProgress | undefined> {
  return withStore(STORE_PROGRESS, 'readonly', (store) => store.get(bookId));
}

// ─── Cleanup ───

export async function clearAllForBook(bookId: string): Promise<void> {
  const db = await openDB();

  // Clear chapters
  const chapterTx = db.transaction(STORE_CHAPTERS, 'readwrite');
  const chapterStore = chapterTx.objectStore(STORE_CHAPTERS);
  const chapterPrefix = `${bookId}:`;
  await new Promise<void>((resolve, reject) => {
    const req = chapterStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if ((cursor.key as string).startsWith(chapterPrefix)) {
          cursor.delete();
        }
        cursor.continue();
      } else resolve();
    };
    req.onerror = () => reject(req.error);
  });

  // Clear pages
  await clearPagesForChapter(bookId, '');

  // Clear book meta
  await withStore(STORE_BOOKS, 'readwrite', (store) => store.delete(bookId));
}

/**
 * Get the estimated storage usage in bytes.
 */
export async function estimateStorageUsage(): Promise<{ usage: number; quota: number } | null> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }
  return null;
}
