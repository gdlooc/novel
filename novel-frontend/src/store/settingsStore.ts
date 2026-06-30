/**
 * settingsStore — Reader configuration state.
 *
 * Persisted to localStorage so preferences survive page reloads.
 * Changes to layout-affecting settings (fontSize, fontFamily, margins, etc.)
 * trigger re-layout in the reader.
 */

import { create } from 'zustand';
import { getItem, setItem } from '@/services/storage/localStorage';
import type { LayoutConfig } from '@engine/layout/types';

export type ThemeId = 'light' | 'dark' | 'sepia';

export interface SettingsState {
  // ─── Layout settings ───
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paragraphIndent: number;

  // ─── Display settings ───
  theme: ThemeId;
  showProgressBar: boolean;
  showHeaderFooter: boolean;

  // ─── Page turn settings ───
  pageTurnAnimation: 'curl' | 'slide' | 'fade' | 'none';
  readingMode: 'paged' | 'scroll';

  // ─── Actions ───
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setLineHeight: (lh: number) => void;
  setPadding: (side: 'top' | 'bottom' | 'left' | 'right', value: number) => void;
  setParagraphIndent: (indent: number) => void;
  setTheme: (theme: ThemeId) => void;
  setShowProgressBar: (show: boolean) => void;
  setShowHeaderFooter: (show: boolean) => void;
  setPageTurnAnimation: (anim: 'curl' | 'slide' | 'fade' | 'none') => void;
  setReadingMode: (mode: 'paged' | 'scroll') => void;

  /** Get the full LayoutConfig for the layout engine */
  getLayoutConfig: (pageWidth: number, pageHeight: number) => LayoutConfig;
}

const STORAGE_KEY = 'reader-settings';

/** Persisted settings shape (subset of state) */
interface PersistedSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paragraphIndent: number;
  theme: ThemeId;
  showProgressBar: boolean;
  showHeaderFooter: boolean;
  pageTurnAnimation: 'curl' | 'slide' | 'fade' | 'none';
  readingMode: 'paged' | 'scroll';
}

const DEFAULTS: PersistedSettings = {
  fontSize: 18,
  fontFamily: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
  lineHeight: 1.8,
  paddingTop: 24,
  paddingBottom: 24,
  paddingLeft: 20,
  paddingRight: 20,
  paragraphIndent: 2,
  theme: 'light',
  showProgressBar: true,
  showHeaderFooter: true,
  pageTurnAnimation: 'curl',
  readingMode: 'paged',
};

function loadPersisted(): PersistedSettings {
  const stored = getItem<Partial<PersistedSettings> | null>(STORAGE_KEY, null);
  if (stored) {
    return { ...DEFAULTS, ...stored };
  }
  return DEFAULTS;
}

function persist(state: PersistedSettings): void {
  setItem(STORAGE_KEY, state);
}

export const useSettingsStore = create<SettingsState>()((set, get) => {
  const initial = loadPersisted();

  return {
    // Initial state
    ...initial,

    // Actions
    setFontSize: (size: number) => {
      const clamped = Math.max(10, Math.min(48, size));
      set({ fontSize: clamped });
      persist({ ...getPersisted(get()), fontSize: clamped });
    },

    setFontFamily: (family: string) => {
      set({ fontFamily: family });
      persist({ ...getPersisted(get()), fontFamily: family });
    },

    setLineHeight: (lh: number) => {
      const clamped = Math.max(1.0, Math.min(3.0, lh));
      set({ lineHeight: clamped });
      persist({ ...getPersisted(get()), lineHeight: clamped });
    },

    setPadding: (side, value: number) => {
      const clamped = Math.max(0, Math.min(80, value));
      const key =
        side === 'top'
          ? 'paddingTop'
          : side === 'bottom'
            ? 'paddingBottom'
            : side === 'left'
              ? 'paddingLeft'
              : 'paddingRight';
      set({ [key]: clamped } as Partial<SettingsState>);
      persist({ ...getPersisted(get()), [key]: clamped });
    },

    setParagraphIndent: (indent: number) => {
      const clamped = Math.max(0, Math.min(4, indent));
      set({ paragraphIndent: clamped });
      persist({ ...getPersisted(get()), paragraphIndent: clamped });
    },

    setTheme: (theme: ThemeId) => {
      set({ theme });
      persist({ ...getPersisted(get()), theme });
    },

    setShowProgressBar: (show: boolean) => {
      set({ showProgressBar: show });
      persist({ ...getPersisted(get()), showProgressBar: show });
    },

    setShowHeaderFooter: (show: boolean) => {
      set({ showHeaderFooter: show });
      persist({ ...getPersisted(get()), showHeaderFooter: show });
    },

    setPageTurnAnimation: (anim) => {
      set({ pageTurnAnimation: anim });
      persist({ ...getPersisted(get()), pageTurnAnimation: anim });
    },

    setReadingMode: (mode) => {
      set({ readingMode: mode });
      persist({ ...getPersisted(get()), readingMode: mode });
    },

    getLayoutConfig: (pageWidth: number, pageHeight: number): LayoutConfig => {
      const s = get();
      return {
        pageWidth,
        pageHeight,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        lineHeight: s.lineHeight,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        paragraphIndent: s.paragraphIndent,
        paragraphSpacing: s.fontSize * 0.5, // half line between paragraphs
      };
    },
  };
});

/** Extract the persistable subset */
function getPersisted(state: SettingsState): PersistedSettings {
  return {
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    lineHeight: state.lineHeight,
    paddingTop: state.paddingTop,
    paddingBottom: state.paddingBottom,
    paddingLeft: state.paddingLeft,
    paddingRight: state.paddingRight,
    paragraphIndent: state.paragraphIndent,
    theme: state.theme,
    showProgressBar: state.showProgressBar,
    showHeaderFooter: state.showHeaderFooter,
    pageTurnAnimation: state.pageTurnAnimation,
    readingMode: state.readingMode,
  };
}
