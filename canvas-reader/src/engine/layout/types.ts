/**
 * Core type definitions for the text layout engine.
 * These types are framework-agnostic and used by both main thread and workers.
 */

/** A single line of laid-out text */
export interface TextLine {
  /** The text content of this line */
  text: string;
  /** X offset in CSS pixels from the left edge of the content area */
  x: number;
  /** Y position in CSS pixels from the top of the page */
  y: number;
  /** Actual rendered width in CSS pixels */
  width: number;
  /** Character range in the source text: [start, end) */
  charRange: [number, number];
  /** Whether this line starts a new paragraph */
  isParagraphStart: boolean;
}

/** A complete description of one page */
export interface PageDescriptor {
  /** 0-based page index within the chapter */
  pageIndex: number;
  /** Chapter identifier */
  chapterId: string;
  /** Laid-out text lines on this page */
  lines: TextLine[];
  /** Starting character offset in chapter source text (inclusive) */
  charStart: number;
  /** Ending character offset in chapter source text (exclusive) */
  charEnd: number;
  /** Whether this is the first page of the chapter */
  isFirstPage: boolean;
  /** Whether this is the last page of the chapter */
  isLastPage: boolean;
  /** Total known pages in the chapter (may grow as more are calculated) */
  totalPagesKnown: number;
}

/** Layout configuration — changes trigger re-layout */
export interface LayoutConfig {
  /** Page content area width in CSS pixels */
  pageWidth: number;
  /** Page content area height in CSS pixels */
  pageHeight: number;
  /** Font size in CSS pixels */
  fontSize: number;
  /** Font family string (e.g., 'Noto Serif CJK SC, serif') */
  fontFamily: string;
  /** Line height multiplier (1.0 = single, 2.0 = double) */
  lineHeight: number;
  /** Content padding (CSS pixels) */
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  /** Paragraph first-line indent in em units (0 = no indent) */
  paragraphIndent: number;
  /** Extra spacing between paragraphs in CSS pixels */
  paragraphSpacing: number;
}

/** Layout result returned by the engine */
export interface LayoutResult {
  /** The computed pages */
  pages: PageDescriptor[];
  /** The layout config used (hash for cache validation) */
  configHash: string;
  /** Total pages known so far */
  totalPagesKnown: number;
  /** Whether there are more pages to calculate */
  hasMore: boolean;
}

/** Paragraph info for layout decisions */
export interface ParagraphInfo {
  /** Start character index in source */
  startIndex: number;
  /** End character index in source (exclusive) */
  endIndex: number;
  /** Whether this paragraph is a heading/title */
  isHeading: boolean;
  /** Whether this paragraph is a scene separator (e.g., "***" or "※ ※ ※") */
  isSeparator: boolean;
}

/** Worker message types */
export interface LayoutRequest {
  type: 'LAYOUT';
  requestId: string;
  chapterId: string;
  text: string;
  config: LayoutConfig;
  startPageIndex: number;
  /** Maximum pages to compute in this batch */
  maxPages: number;
  /** Character offset to start pagination from (0 = beginning) */
  startCharOffset: number;
}

export interface LayoutResponse {
  type: 'LAYOUT_RESULT';
  requestId: string;
  chapterId: string;
  result: LayoutResult;
}

export interface LayoutCancelRequest {
  type: 'CANCEL';
  requestId: string;
}

export type WorkerInMessage = LayoutRequest | LayoutCancelRequest;
export type WorkerOutMessage = LayoutResponse;
