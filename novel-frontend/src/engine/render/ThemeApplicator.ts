/**
 * ThemeApplicator — Manages rendering themes and applies theme CSS variables
 * to the document root for React UI components.
 *
 * Themes affect:
 * 1. Canvas rendering (colors passed to PagePainter)
 * 2. React UI (CSS custom properties on :root)
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

/** Built-in light theme */
export const LIGHT_THEME: RenderTheme = {
  id: 'light',
  name: '浅色模式',
  backgroundColor: '#F5F5F5',
  textColor: '#1A1A1A',
  textColorSecondary: '#8C8C8C',
  selectionColor: 'rgba(74, 144, 217, 0.3)',
  accentColor: '#4A90D9',
  cssVariables: {
    'ui-background': '#FFFFFF',
    'ui-background-secondary': '#F0F0F0',
    'ui-text': '#1A1A1A',
    'ui-text-secondary': '#6B6B6B',
    'ui-border': '#E0E0E0',
    'ui-accent': '#4A90D9',
    'ui-overlay': 'rgba(0, 0, 0, 0.05)',
    'ui-danger': '#E74C3C',
    'ui-slider-track': '#D0D0D0',
    'ui-slider-fill': '#4A90D9',
  },
};

/** Built-in dark theme */
export const DARK_THEME: RenderTheme = {
  id: 'dark',
  name: '深色模式',
  backgroundColor: '#1A1A1A',
  textColor: '#D4D4D4',
  textColorSecondary: '#6B6B6B',
  selectionColor: 'rgba(109, 179, 242, 0.3)',
  accentColor: '#6DB3F2',
  cssVariables: {
    'ui-background': '#252525',
    'ui-background-secondary': '#1E1E1E',
    'ui-text': '#D4D4D4',
    'ui-text-secondary': '#8C8C8C',
    'ui-border': '#3A3A3A',
    'ui-accent': '#6DB3F2',
    'ui-overlay': 'rgba(255, 255, 255, 0.05)',
    'ui-danger': '#E74C3C',
    'ui-slider-track': '#3A3A3A',
    'ui-slider-fill': '#6DB3F2',
  },
};

/** Built-in sepia (eye-care) theme */
export const SEPIA_THEME: RenderTheme = {
  id: 'sepia',
  name: '护眼模式',
  backgroundColor: '#F4ECD8',
  textColor: '#5B4636',
  textColorSecondary: '#9C8B7E',
  selectionColor: 'rgba(139, 115, 85, 0.3)',
  accentColor: '#8B7355',
  cssVariables: {
    'ui-background': '#EDE0C8',
    'ui-background-secondary': '#E3D5B8',
    'ui-text': '#5B4636',
    'ui-text-secondary': '#9C8B7E',
    'ui-border': '#D4C4A8',
    'ui-accent': '#8B7355',
    'ui-overlay': 'rgba(139, 115, 85, 0.08)',
    'ui-danger': '#C0392B',
    'ui-slider-track': '#D4C4A8',
    'ui-slider-fill': '#8B7355',
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
