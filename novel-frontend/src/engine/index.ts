/**
 * 引擎层统一导出入口。
 *
 * 引擎层是框架无关的核心模块，包含排版、渲染、缓存三个子系统。
 * 所有导出不依赖 React/Zustand，可被主线程和 Web Worker 共同使用。
 */

// ═══════════════════════════════════════════════════
// 排版引擎
// ═══════════════════════════════════════════════════
export {
  TextLayoutEngine,
  TextMeasurer,
  Paginator,
  hashLayoutConfig,
  breakTextIntoLines,
  detectParagraphs,
  applyKinsoku,
} from './layout';

export type {
  TextLine,
  ImageBlock,
  PageDescriptor,
  LayoutConfig,
  LayoutResult,
  ParagraphInfo,
  LayoutRequest,
  LayoutResponse,
  LayoutCancelRequest,
  WorkerInMessage,
  WorkerOutMessage,
  CharType,
  LineBreakOptions,
} from './layout';

// Render engine
export {
  CanvasRenderer,
  paintPage,
  applyThemeToDOM,
  getThemeMetaColor,
  getDefaultTheme,
  getThemeById,
  LIGHT_THEME,
  DARK_THEME,
  SEPIA_THEME,
  ALL_THEMES,
} from './render';

export type {
  RenderTheme,
  PaintOptions,
  ViewportState,
  PageTurnAnimation,
  RendererConfig,
} from './render';

// Cache
export { PageCacheManager } from './cache';
export type { PageCacheOptions } from './cache';
