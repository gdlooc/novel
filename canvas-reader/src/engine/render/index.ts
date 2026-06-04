export { CanvasRenderer } from './CanvasRenderer';
export type { PageTurnAnimation, PageTurnAnimationType, RendererConfig } from './CanvasRenderer';
export { paintPage } from './PagePainter';
export {
  applyThemeToDOM,
  getThemeMetaColor,
  getDefaultTheme,
  getThemeById,
  LIGHT_THEME,
  DARK_THEME,
  SEPIA_THEME,
  ALL_THEMES,
} from './ThemeApplicator';
export type { RenderTheme, PaintOptions, ViewportState } from './types';
