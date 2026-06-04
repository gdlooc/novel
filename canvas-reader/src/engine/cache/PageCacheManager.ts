/**
 * PageCacheManager — In-memory LRU page cache.
 *
 * Caches PageDescriptor objects for fast page flipping.
 * Evicts least-recently-used pages when the cache exceeds capacity.
 *
 * This is the L1 cache (fastest, in-memory). L2 is IndexedDB (see ChapterCacheDB).
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';
import { hashLayoutConfig } from '../layout/Paginator';

/** A cached page entry with metadata */
interface CacheEntry {
  page: PageDescriptor;
  configHash: string;
  lastAccessed: number;
}

/** Options for PageCacheManager */
export interface PageCacheOptions {
  /** Maximum number of pages to keep in the cache (default 30) */
  maxSize: number;
}

const DEFAULT_OPTIONS: PageCacheOptions = {
  maxSize: 30,
};

/**
 * LRU page cache for fast page access.
 */
export class PageCacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private maxSize: number;

  constructor(options: Partial<PageCacheOptions> = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_OPTIONS.maxSize;
  }

  /**
   * Generate a cache key for a page.
   */
  private key(chapterId: string, pageIndex: number): string {
    return `${chapterId}:${pageIndex}`;
  }

  /**
   * Store a page in the cache.
   */
  set(chapterId: string, pageIndex: number, page: PageDescriptor, config: LayoutConfig): void {
    const k = this.key(chapterId, pageIndex);
    const configHash = hashLayoutConfig(config);

    // If already exists, update
    if (this.cache.has(k)) {
      this.removeFromOrder(k);
    }

    // Evict if at capacity
    while (this.accessOrder.length >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(k, {
      page,
      configHash,
      lastAccessed: Date.now(),
    });
    this.accessOrder.push(k);
  }

  /**
   * Get a page from the cache.
   * Returns undefined if not found or config hash mismatch.
   */
  get(chapterId: string, pageIndex: number, configHash?: string): PageDescriptor | undefined {
    const k = this.key(chapterId, pageIndex);
    const entry = this.cache.get(k);

    if (!entry) return undefined;

    // Validate config hash
    if (configHash && entry.configHash !== configHash) {
      this.delete(chapterId, pageIndex);
      return undefined;
    }

    // Update LRU order
    this.removeFromOrder(k);
    this.accessOrder.push(k);
    entry.lastAccessed = Date.now();

    return entry.page;
  }

  /**
   * Check if a page is cached and valid.
   */
  has(chapterId: string, pageIndex: number, configHash?: string): boolean {
    const k = this.key(chapterId, pageIndex);
    const entry = this.cache.get(k);
    if (!entry) return false;
    if (configHash && entry.configHash !== configHash) return false;
    return true;
  }

  /**
   * Delete a specific page from cache.
   */
  delete(chapterId: string, pageIndex: number): void {
    const k = this.key(chapterId, pageIndex);
    this.cache.delete(k);
    this.removeFromOrder(k);
  }

  /**
   * Invalidate all pages for a chapter.
   */
  invalidateChapter(chapterId: string): void {
    const prefix = `${chapterId}:`;
    const keys = this.accessOrder.filter((k) => k.startsWith(prefix));
    for (const k of keys) {
      this.cache.delete(k);
    }
    this.accessOrder = this.accessOrder.filter((k) => !k.startsWith(prefix));
  }

  /**
   * Invalidate all pages whose config hash doesn't match.
   */
  invalidateByConfig(configHash: string): void {
    const toRemove: string[] = [];
    for (const [k, entry] of this.cache) {
      if (entry.configHash !== configHash) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      this.cache.delete(k);
    }
    this.accessOrder = this.accessOrder.filter((k) => !toRemove.includes(k));
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get the number of cached pages.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all cached page indices for a chapter, sorted.
   */
  getCachedPageIndices(chapterId: string): number[] {
    const prefix = `${chapterId}:`;
    const indices: number[] = [];
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        const idx = parseInt(k.slice(prefix.length), 10);
        if (!isNaN(idx)) indices.push(idx);
      }
    }
    indices.sort((a, b) => a - b);
    return indices;
  }

  // ─── Private ───

  private removeFromOrder(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    const oldestKey = this.accessOrder.shift()!;
    this.cache.delete(oldestKey);
  }
}
