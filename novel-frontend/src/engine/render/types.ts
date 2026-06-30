/**
 * Render types — frame-agnostic types for the Canvas renderer.
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';

/** Theme definition for canvas rendering */
export interface RenderTheme {
  id: string;
  name: string;
  /** Canvas background color */
  backgroundColor: string;
  /** Main body text color */
  textColor: string;
  /** Secondary text color (headers, footers, page numbers) */
  textColorSecondary: string;
  /** Selection highlight color */
  selectionColor: string;
  /** Progress bar color */
  accentColor: string;
  /** CSS custom properties for React UI (panels, bars, modals) */
  cssVariables: Record<string, string>;
}

/** Options passed to the page painter */
export interface PaintOptions {
  /** The page descriptor to render */
  page: PageDescriptor;
  /** Layout config used for this page */
  config: LayoutConfig;
  /** Theme to apply */
  theme: RenderTheme;
  /** Whether to render header/footer */
  showHeaderFooter?: boolean;
  /** Chapter title for header */
  chapterTitle?: string;
  /** Whether to show a progress bar at the bottom */
  showProgressBar?: boolean;
  /** Page turn animation offset (CSS pixels, 0 = no animation) */
  animationOffset?: number;
  /** Opacity for fade transitions (0-1, 1 = fully opaque) */
  opacity?: number;
  /** 预加载的图片元素映射（url → HTMLImageElement） */
  preloadedImages?: Map<string, HTMLImageElement>;
}

/** State of the canvas viewport */
export interface ViewportState {
  /** CSS width of the canvas element */
  cssWidth: number;
  /** CSS height of the canvas element */
  cssHeight: number;
  /** Device pixel ratio */
  dpr: number;
  /** Physical pixel width of the canvas backing store */
  physicalWidth: number;
  /** Physical pixel height of the canvas backing store */
  physicalHeight: number;
}
