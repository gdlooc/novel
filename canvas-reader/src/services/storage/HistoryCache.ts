/**
 * HistoryCache — 阅读历史记录持久化服务。
 *
 * 将所有读过的小说信息保存到 IndexedDB，支持：
 * - 同一本书多次打开时更新记录（不重复创建）
 * - 按最后阅读时间降序排列
 * - 删除单条或清空全部历史
 *
 * 存储结构：
 *   Database: canvas-reader-db (复用 ChapterCacheDB 的数据库)
 *   Object Store: history (key: bookId)
 */

import type { BookSource, BookMetadata } from '@book/types';
import { openDB, STORE_HISTORY } from '@engine/cache/ChapterCacheDB';

/** 单条历史记录 */
export interface HistoryEntry {
  /** 书籍唯一标识 */
  bookId: string;
  /** 书名 */
  title: string;
  /** 作者 */
  author: string;
  /** 封面图 URL（可选） */
  coverUrl?: string;
  /** 书籍来源信息，用于"继续阅读"时重新打开 */
  source: BookSource;
  /** 上次阅读的章节 ID */
  chapterId: string;
  /** 上次阅读的章节标题 */
  chapterTitle: string;
  /** 阅读字符偏移量 */
  charOffset: number;
  /** 阅读进度 0.0 ~ 1.0 */
  progress: number;
  /** 最后阅读时间戳 */
  updatedAt: number;
}

/**
 * 保存或更新一条阅读历史记录。
 * 同一 bookId 多次调用会更新（覆盖）而非重复创建。
 */
export async function saveHistoryEntry(entry: HistoryEntry): Promise<void> {
  entry.updatedAt = Date.now();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_HISTORY);
    store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 获取全部历史记录，按最后阅读时间降序排列。
 */
export async function getAllHistory(): Promise<HistoryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const store = tx.objectStore(STORE_HISTORY);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as HistoryEntry[];
      // 按更新时间降序（最近读的排前面）
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(entries);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取单本书的历史记录。
 */
export async function getHistoryEntry(bookId: string): Promise<HistoryEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const store = tx.objectStore(STORE_HISTORY);
    const request = store.get(bookId);
    request.onsuccess = () => resolve(request.result as HistoryEntry | undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除指定书籍的历史记录。
 */
export async function deleteHistoryEntry(bookId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_HISTORY);
    store.delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 清空全部历史记录。
 */
export async function clearAllHistory(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    const store = tx.objectStore(STORE_HISTORY);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 从 BookMetadata + BookSource 构建 HistoryEntry 的基础字段。
 * 阅读位置字段由调用方补充。
 */
export function buildHistoryEntry(
  metadata: BookMetadata,
  source: BookSource,
  overrides: Partial<Pick<HistoryEntry, 'chapterId' | 'chapterTitle' | 'charOffset' | 'progress'>> = {},
): HistoryEntry {
  return {
    bookId: metadata.bookId,
    title: metadata.title,
    author: metadata.author,
    coverUrl: metadata.coverUrl,
    source,
    chapterId: overrides.chapterId || '',
    chapterTitle: overrides.chapterTitle || '',
    charOffset: overrides.charOffset || 0,
    progress: overrides.progress || 0,
    updatedAt: Date.now(),
  };
}
