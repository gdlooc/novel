/**
 * TextLayoutEngine — High-level orchestrator for text → pages conversion.
 *
 * This is the main public API of the layout engine. It coordinates:
 * - Text measurement
 * - Line breaking
 * - Pagination
 * - Caching of computed pages
 *
 * For production use with Web Workers, see layout.worker.ts
 * which wraps this engine in a worker context.
 */

import type { LayoutConfig, LayoutResult, PageDescriptor } from './types';
import { Paginator, hashLayoutConfig } from './Paginator';

export type { LayoutConfig, LayoutResult, PageDescriptor };
export { hashLayoutConfig } from './Paginator';

/**
 * The main layout engine. Each instance can handle one chapter at a time.
 * For multi-chapter use, create one engine instance per reader session.
 *
 * Usage:
 * ```
 * const engine = new TextLayoutEngine();
 * const result = engine.layout(chapterId, text, config);
 * // result.pages contains the computed pages
 * // Call engine.layout() again with different startPageIndex to extend
 * ```
 */
export class TextLayoutEngine {
  private paginator: Paginator;
  private _currentChapterId: string = '';
  private _currentConfigHash: string = '';

  constructor() {
    this.paginator = new Paginator();
  }

  /**
   * Compute page layout for a chapter.
   *
   * @param chapterId - Unique identifier for the chapter
   * @param text - Raw chapter text content
   * @param config - Layout configuration (font, size, margins, etc.)
   * @param options - Pagination options
   * @returns LayoutResult with computed pages and metadata
   */
  layout(
    chapterId: string,
    text: string,
    config: LayoutConfig,
    options: {
      /** Page index to start computing from (0-based) */
      startPageIndex?: number;
      /** Maximum pages to compute in this call */
      maxPages?: number;
      /** Character offset to start from (alternative to startPageIndex) */
      startCharOffset?: number;
    } = {},
  ): LayoutResult {
    const {
      startPageIndex = 0,
      maxPages = 10,
      startCharOffset,
    } = options;

    const configHash = hashLayoutConfig(config);

    // Track current state
    this._currentChapterId = chapterId;
    this._currentConfigHash = configHash;

    return this.paginator.paginate(chapterId, text, config, {
      startPageIndex,
      maxPages,
      startCharOffset,
    });
  }

  /**
   * Get a specific page from cache (if already computed).
   */
  getPage(pageIndex: number): PageDescriptor | undefined {
    return this.paginator.getPage(pageIndex);
  }

  /**
   * Check if a page is in cache.
   */
  hasPage(pageIndex: number): boolean {
    return this.paginator.hasPage(pageIndex);
  }

  /**
   * Get total known pages for current chapter.
   */
  get totalPagesKnown(): number {
    return this.paginator.totalPagesKnown;
  }

  /**
   * Get current chapter ID.
   */
  get currentChapterId(): string {
    return this._currentChapterId;
  }

  /**
   * Get current config hash.
   */
  get currentConfigHash(): string {
    return this._currentConfigHash;
  }

  /**
   * 获取当前章节所有已计算的行（滚动模式使用）。
   * 必须先调用 layout() 计算布局后才能获取。
   */
  getAllLines(): import('./types').TextLine[] {
    return this.paginator.getAllLines();
  }

  /**
   * Clear all internal state.
   */
  reset(): void {
    this.paginator.reset();
    this._currentChapterId = '';
    this._currentConfigHash = '';
  }
}
