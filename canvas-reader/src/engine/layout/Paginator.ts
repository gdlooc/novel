/**
 * Paginator — 基于滑动窗口的懒分页器。
 *
 * ## 核心设计
 *
 * 本模块是整个排版引擎中最关键的性能组件。它的设计遵循以下原则：
 *
 * ### 1. 绝不一次性分页整本书
 * 对于百万字级别的小说（如 500 章，每章 5000 字），如果一次性分页，
 * 内存和 CPU 成本都不可接受。因此采用 **懒分页（lazy pagination）**：
 * 每次只计算 `maxPages` 页（默认 10 页），按需扩展。
 *
 * ### 2. 滑动窗口
 * 用户翻页时，Paginator 维护一个以当前阅读位置为中心的「窗口」。
 * 当用户向窗口边缘移动时，窗口自动扩展（向前或向后）。
 * 窗口外的页面可被缓存淘汰，保持内存可控。
 *
 * ### 3. 配置变更 → 全量失效
 * 字号、字体、行距等任何 LayoutConfig 变化都会导致已排版页面失效。
 * 通过 `hashLayoutConfig()` 生成的哈希值检测配置变更。
 * 配置变更后：
 * - 清空所有页面缓存
 * - 清空分行结果（allLines）
 * - 使用 charOffset（而非 pageIndex）恢复阅读位置
 *
 * ### 4. charOffset 定位
 * 字符偏移量（charOffset）是排版无关的阅读位置标识。
 * 字号变化会导致总页数变化（如从第 10 页变成第 8 页），
 * 但 charOffset 始终指向文本中的同一个字符，因此：
 * - 增大字号后重排版 → 用 charOffset 找到新布局中的对应页
 * - 这个机制避免了 Bug #8（字号增大后页码越界）
 *
 * ## 使用示例
 *
 * ```
 * const paginator = new Paginator();
 * const result = paginator.paginate(chapterId, text, config, {
 *   startPageIndex: 0, maxPages: 10
 * });
 * // 阅读到第 8 页后扩展窗口
 * const more = paginator.paginate(chapterId, text, config, {
 *   startPageIndex: 10, maxPages: 10
 * });
 * ```
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
   * 对章节文本进行分页计算。
   *
   * 这是分页器的主入口方法。
   *
   * ## 工作流程
   *
   * 1. 检查配置哈希是否变化（字号/字体/行距等）
   * 2. 若配置变化：清空所有缓存，重新分行
   * 3. 若首次调用该章节：调用 breakTextIntoLines 计算全章所有行
   * 4. 将行数组分组为页面（buildPages）
   *
   * ## 参数说明
   *
   * @param chapterId - 章节唯一标识，用于缓存键和页面归属
   * @param text - 章节原始文本内容
   * @param config - 当前排版配置（字号、边距等）
   * @param options.startPageIndex - 起始页码（0-based），翻页时窗口起始位置
   * @param options.maxPages - 本次计算的最大页数（滑动窗口大小，默认 10）
   * @param options.startCharOffset - 字符偏移量（替代 startPageIndex 定位）
   *
   * ## 返回值
   *
   * LayoutResult 包含：
   * - pages: 本次计算出的页面数组（滑动窗口，非全量）
   * - totalPagesKnown: 当前已知的总页数（-1=尚未到达末尾）
   * - hasMore: 是否还有更多页面可计算
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
   * 从预计算的行数组构建页面（内部分组逻辑）。
   *
   * ## 工作流程
   *
   * 1. 定位起始行：根据 startCharOffset 或 startPageIndex 找到开始分页的行索引
   * 2. 逐行分组：从起始行开始，将行分组为页面，直到任一条件满足：
   *    - 达到 maxPages 上限
   *    - 行数组耗尽（章节末尾）
   * 3. 越界保护：如果 startPageIndex/charOffset 越界，回退到有效行
   * 4. 页码重算：从第 0 行走一遍，确定实际的 pageIndex
   *
   * ## 越界保护（Bug #8 修复）
   *
   * 字号增大后，旧 pageIndex 可能在新布局中不存在。
   * 例如：旧布局有 15 页，用户在第 12 页；字号增大后新布局仅 8 页。
   * 此时 startPageIndex=11 已越界，会被 clamp 到第 0 行。
   *
   * 更好的做法是使用 charOffset 定位（布局无关），
   * 此函数也支持 startCharOffset 参数作为替代路径。
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
