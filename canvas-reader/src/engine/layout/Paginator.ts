/**
 * Paginator — Lazy, sliding-window page calculator.
 *
 * Key design:
 * - Never paginates the entire text at once (supports million-word novels).
 * - Calculates pages on demand around a target position.
 * - Returns a window of pages with metadata about what's been computed.
 * - Can extend the window forward or backward.
 *
 * The paginator owns a TextMeasurer for measurement during pagination.
 * It batches work: each call to paginate() computes up to maxPages pages.
 */

import type {
  PageDescriptor,
  LayoutConfig,
  LayoutResult,
  TextLine,
} from './types';
import { TextMeasurer } from './TextMeasurer';
import { breakTextIntoLines } from './LineBreaker';

/**
 * Generate a simple hash from a layout config to track when re-layout is needed.
 */
export function hashLayoutConfig(config: LayoutConfig): string {
  const key = [
    config.pageWidth,
    config.pageHeight,
    config.fontSize,
    config.fontFamily,
    config.lineHeight,
    config.paddingTop,
    config.paddingBottom,
    config.paddingLeft,
    config.paddingRight,
    config.paragraphIndent,
    config.paragraphSpacing,
  ].join('|');
  return simpleHash(key);
}

/** Simple non-cryptographic hash function */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Paginator class that handles lazy page calculation.
 *
 * Usage:
 * ```
 * const paginator = new Paginator();
 * const result = paginator.paginate(text, config, { startPageIndex: 0, maxPages: 10 });
 * // Read pages, then extend:
 * const more = paginator.paginate(text, config, { startPageIndex: 10, maxPages: 10 });
 * ```
 */
export class Paginator {
  private measurer: TextMeasurer;
  /** Cache of already-computed pages for the current chapter */
  private pageCache: Map<number, PageDescriptor> = new Map();
  /** Current chapter text (only set via paginate) */
  private currentChapterId: string = '';
  private currentConfigHash: string = '';
  /** Pre-computed lines for the entire chapter text (lazy — computed once per config) */
  private allLines: TextLine[] | null = null;
  /** Total page count (updated as more pages are computed; -1 = unknown = text not fully paginated) */
  private _totalPagesKnown: number = -1;

  constructor() {
    this.measurer = new TextMeasurer();
  }

  /**
   * Compute pages for a chapter.
   *
   * This is the main entry point. It computes up to `maxPages` pages
   * starting from `startPageIndex`, using `startCharOffset` as the
   * character position to begin pagination.
   *
   * If the config hash changed (e.g., font size was adjusted), all
   * cached pages are invalidated and re-computed.
   */
  paginate(
    chapterId: string,
    text: string,
    config: LayoutConfig,
    options: {
      startPageIndex: number;
      maxPages: number;
      startCharOffset?: number;
    },
  ): LayoutResult {
    const configHash = hashLayoutConfig(config);

    // Config changed → invalidate cache
    if (
      configHash !== this.currentConfigHash ||
      chapterId !== this.currentChapterId
    ) {
      this.currentConfigHash = configHash;
      this.currentChapterId = chapterId;
      this.pageCache.clear();
      this.allLines = null;
      this._totalPagesKnown = -1;
    }

    // Configure measurer
    this.measurer.configure(config);

    // Compute all lines if not already done
    if (!this.allLines) {
      this.allLines = breakTextIntoLines(text, this.measurer, {
        lineWidth: config.pageWidth - config.paddingLeft - config.paddingRight,
        paragraphIndent: config.paragraphIndent,
        paragraphSpacing: config.paragraphSpacing,
      });
    }

    // Now group lines into pages
    const pages = this.buildPages(
      chapterId,
      text,
      config,
      options.startPageIndex,
      options.maxPages,
      options.startCharOffset,
    );

    return {
      pages,
      configHash,
      totalPagesKnown: this._totalPagesKnown,
      hasMore: this._totalPagesKnown < 0 || pages.length < this._totalPagesKnown,
    };
  }

  /**
   * Build pages from pre-computed lines.
   */
  private buildPages(
    chapterId: string,
    text: string,
    config: LayoutConfig,
    startPageIndex: number,
    maxPages: number,
    startCharOffset?: number,
  ): PageDescriptor[] {
    const pageHeight = config.pageHeight - config.paddingTop - config.paddingBottom;
    const lines = this.allLines!;
    const pages: PageDescriptor[] = [];

    if (lines.length === 0) {
      // Empty chapter → one empty page
      this._totalPagesKnown = 1;
      return [
        {
          pageIndex: 0,
          chapterId,
          lines: [],
          charStart: 0,
          charEnd: 0,
          isFirstPage: true,
          isLastPage: true,
          totalPagesKnown: 1,
        },
      ];
    }

    // Find the starting line: which line corresponds to startCharOffset or startPageIndex
    let startLineIdx = 0;

    if (startCharOffset !== undefined && startCharOffset > 0) {
      // Find the line containing this character offset
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].charRange[1] > startCharOffset) {
          startLineIdx = i;
          break;
        }
      }
    } else if (startPageIndex > 0) {
      // We need to find which line starts page `startPageIndex`
      // Walk through lines, grouping into pages
      let currentPageIdx = 0;
      let currentPageTop = 0;
      let lineIdx = 0;

      while (lineIdx < lines.length && currentPageIdx < startPageIndex) {
        const line = lines[lineIdx];
        const lineBottom = line.y + this.measurer.lineHeightPx;

        if (lineBottom - currentPageTop > pageHeight && lineIdx > 0) {
          // Page is full, move to next
          currentPageIdx++;
          currentPageTop = line.y;
        }
        lineIdx++;
      }
      startLineIdx = lineIdx;
    }

    // Guard: if startPageIndex or startCharOffset is beyond the text end
    // (e.g., font size increased → fewer pages), clamp to valid range.
    if (startLineIdx >= lines.length) {
      startLineIdx = Math.max(0, lines.length - 1);
    }

    // Build pages from startLineIdx.
    // Recalculate actual page index by walking from line 0 to startLineIdx.
    let pageIdx = 0;
    if (startLineIdx > 0) {
      let pageTop = 0;
      for (let i = 0; i < startLineIdx; i++) {
        const lb = lines[i].y + this.measurer.lineHeightPx - pageTop;
        if (lb > pageHeight) {
          pageIdx++;
          pageTop = lines[i].y;
        }
      }
    }
    let lineIdx = startLineIdx;
    let pagesBuilt = 0;
    let allDone = false;

    while (lineIdx < lines.length && pagesBuilt < maxPages) {
      const pageLines: TextLine[] = [];
      const pageTop = lines[lineIdx].y; // Y of first line on this page
      let firstLineCharStart = lines[lineIdx].charRange[0];
      let lastLineCharEnd = firstLineCharStart;

      // Collect lines that fit on this page
      while (lineIdx < lines.length) {
        const line = lines[lineIdx];
        const relativeY = line.y - pageTop;
        const lineBottom = relativeY + this.measurer.lineHeightPx;

        if (lineBottom > pageHeight && pageLines.length > 0) {
          // Line doesn't fit → page is full
          break;
        }

        // Adjust line Y to be relative to the page content area
        const adjustedLine: TextLine = {
          ...line,
          y: relativeY + config.paddingTop,
          x: line.x + config.paddingLeft,
        };
        pageLines.push(adjustedLine);

        if (pageLines.length === 1) {
          firstLineCharStart = line.charRange[0];
        }
        lastLineCharEnd = line.charRange[1];
        lineIdx++;
      }

      if (pageLines.length === 0) break;

      const isLastPage = lineIdx >= lines.length;
      if (isLastPage) {
        allDone = true;
        this._totalPagesKnown = pageIdx + 1;
      }

      pages.push({
        pageIndex: pageIdx,
        chapterId,
        lines: pageLines,
        charStart: firstLineCharStart,
        charEnd: lastLineCharEnd,
        isFirstPage: pageIdx === 0,
        isLastPage,
        totalPagesKnown: allDone ? pageIdx + 1 : -1,
      });

      pageIdx++;
      pagesBuilt++;
    }

    if (allDone) {
      this._totalPagesKnown = pageIdx;
    }

    // Cache and return
    for (const page of pages) {
      this.pageCache.set(page.pageIndex, page);
    }

    return pages;
  }

  /**
   * Get a previously computed page from cache.
   */
  getPage(pageIndex: number): PageDescriptor | undefined {
    return this.pageCache.get(pageIndex);
  }

  /**
   * Check if a page has been computed.
   */
  hasPage(pageIndex: number): boolean {
    return this.pageCache.has(pageIndex);
  }

  /**
   * Get the known total pages for the current chapter.
   * Returns -1 if the end hasn't been reached yet.
   */
  get totalPagesKnown(): number {
    return this._totalPagesKnown;
  }

  /**
   * 获取所有已计算的行（滚动模式使用）。
   */
  getAllLines(): TextLine[] {
    return this.allLines || [];
  }

  /**
   * Clear all cached data.
   */
  reset(): void {
    this.pageCache.clear();
    this.allLines = null;
    this.currentChapterId = '';
    this.currentConfigHash = '';
    this._totalPagesKnown = -1;
  }
}
