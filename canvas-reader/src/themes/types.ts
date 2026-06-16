/**
 * 主题类型和实例的便捷导出。
 *
 * 实际的主题定义和逻辑在 engine/render/ThemeApplicator.ts 中。
 * 此目录提供按主题拆分的独立导出文件（light/dark/sepia），
 * 方便在其他模块中按需引入单个主题。
 */

// 重导出渲染引擎中的主题类型
export type { RenderTheme } from '@engine/render/types';
export {
  LIGHT_THEME,
  DARK_THEME,
  SEPIA_THEME,
  ALL_THEMES,
  getThemeById,
  getDefaultTheme,
} from '@engine/render/ThemeApplicator';
