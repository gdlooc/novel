/**
 * 渲染引擎子模块导出索引。
 *
 * 渲染引擎负责：
 * - Canvas 2D 页面绘制（PagePainter）
 * - Canvas 生命周期管理 + 翻页动画 + 滚动渲染（CanvasRenderer）
 * - 主题系统：三套内置主题 + DOM CSS 变量注入（ThemeApplicator）
 */

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
