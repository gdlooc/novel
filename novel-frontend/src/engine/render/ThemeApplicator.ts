/**
 * ThemeApplicator — Manages rendering themes and applies theme CSS variables
 * to the document root for React UI components.
 *
 * Themes affect:
 * 1. Canvas rendering (colors passed to PagePainter)
 * 2. React UI (CSS custom properties on :root)
 *
 * 配色方案基于 bilibili APP 风格：
 * - 品牌主色 #FB7299（bilibili 粉）
 * - 文字主色 #18191C（浅色）/ #E8E8EA（深色）
 * - 背景层次分明，圆角卡片风格
 */

import type { RenderTheme } from './types';

/** Apply theme CSS variables to document root */
export function applyThemeToDOM(theme: RenderTheme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.cssVariables)) {
    root.style.setProperty(`--reader-${key}`, value);
  }
  // Also set a data attribute for conditional CSS
  root.dataset.readerTheme = theme.id;
}

/** Get the meta theme-color for the browser chrome */
export function getThemeMetaColor(theme: RenderTheme): string {
  return theme.backgroundColor;
}

/** Built-in light theme — bilibili 风格 */
export const LIGHT_THEME: RenderTheme = {
  id: 'light',
  name: '浅色模式',
  backgroundColor: '#F6F7F8',
  textColor: '#18191C',
  textColorSecondary: '#9499A0',
  selectionColor: 'rgba(251, 114, 153, 0.25)',
  accentColor: '#FB7299',
  cssVariables: {
    'ui-background': '#FFFFFF',
    'ui-background-secondary': '#F6F7F8',
    'ui-text': '#18191C',
    'ui-text-secondary': '#9499A0',
    'ui-border': '#E3E5E7',
    'ui-accent': '#FB7299',
    'ui-overlay': 'rgba(251, 114, 153, 0.06)',
    'ui-danger': '#F85A5A',
    'ui-slider-track': '#E3E5E7',
    'ui-slider-fill': '#FB7299',
  },
};

/** Built-in dark theme — bilibili 深色模式风格 */
export const DARK_THEME: RenderTheme = {
  id: 'dark',
  name: '深色模式',
  backgroundColor: '#1A1A1C',
  textColor: '#E8E8EA',
  textColorSecondary: '#9499A0',
  selectionColor: 'rgba(252, 140, 172, 0.25)',
  accentColor: '#FC8CAC',
  cssVariables: {
    'ui-background': '#1E1E20',
    'ui-background-secondary': '#28282C',
    'ui-text': '#E8E8EA',
    'ui-text-secondary': '#9499A0',
    'ui-border': '#38383C',
    'ui-accent': '#FC8CAC',
    'ui-overlay': 'rgba(255, 255, 255, 0.06)',
    'ui-danger': '#F85A5A',
    'ui-slider-track': '#38383C',
    'ui-slider-fill': '#FC8CAC',
  },
};

/** Built-in sepia (eye-care) theme — bilibili 品牌色 + 暖黄底 */
export const SEPIA_THEME: RenderTheme = {
  id: 'sepia',
  name: '护眼模式',
  backgroundColor: '#F5F0E8',
  textColor: '#4A4036',
  textColorSecondary: '#8C8276',
  selectionColor: 'rgba(251, 114, 153, 0.25)',
  accentColor: '#FB7299',
  cssVariables: {
    'ui-background': '#EDE8DE',
    'ui-background-secondary': '#E3DDD2',
    'ui-text': '#4A4036',
    'ui-text-secondary': '#8C8276',
    'ui-border': '#D4C9B8',
    'ui-accent': '#FB7299',
    'ui-overlay': 'rgba(180, 160, 140, 0.10)',
    'ui-danger': '#C0392B',
    'ui-slider-track': '#D4C9B8',
    'ui-slider-fill': '#FB7299',
  },
};

/** Get the default theme based on system preference */
export function getDefaultTheme(): RenderTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return DARK_THEME;
    }
  }
  return LIGHT_THEME;
}

/** Get a theme by ID */
export function getThemeById(id: string): RenderTheme {
  switch (id) {
    case 'dark':
      return DARK_THEME;
    case 'sepia':
      return SEPIA_THEME;
    case 'light':
    default:
      return LIGHT_THEME;
  }
}

/** All available themes */
export const ALL_THEMES: RenderTheme[] = [LIGHT_THEME, DARK_THEME, SEPIA_THEME];
