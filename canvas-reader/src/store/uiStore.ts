/**
 * uiStore — UI visibility and interaction state.
 *
 * Manages panel visibility, loading overlays, and other
 * ephemeral UI state that doesn't need persistence.
 */

import { create } from 'zustand';

export interface UIState {
  // ─── Panel visibility ───
  showTopBar: boolean;
  showBottomBar: boolean;
  showSettings: boolean;
  showToc: boolean;

  // ─── Loading ───
  isLoading: boolean;
  loadingMessage: string;

  // ─── Chapter navigation ───
  chapterNavTarget: string | null;

  // ─── Fullscreen ───
  isFullscreen: boolean;

  // ─── Actions ───
  toggleBars: () => void;
  setShowTopBar: (show: boolean) => void;
  setShowBottomBar: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowToc: (show: boolean) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setChapterNavTarget: (chapterId: string | null) => void;
  setFullscreen: (fs: boolean) => void;
  toggleFullscreen: () => void;
  hideAllPanels: () => void;
}

export const useUIStore = create<UIState>()((set, get) => ({
  showTopBar: false,
  showBottomBar: false,
  showSettings: false,
  showToc: false,
  isLoading: false,
  loadingMessage: '',
  chapterNavTarget: null,
  isFullscreen: false,

  toggleBars: () => {
    const { showTopBar } = get();
    if (showTopBar) {
      set({
        showTopBar: false,
        showBottomBar: false,
        showSettings: false,
        showToc: false,
      });
    } else {
      set({
        showTopBar: true,
        showBottomBar: true,
      });
    }
  },

  setShowTopBar: (show) => set({ showTopBar: show }),
  setShowBottomBar: (show) => set({ showBottomBar: show }),

  setShowSettings: (show) =>
    set({
      showSettings: show,
      showToc: show ? false : get().showToc,
    }),

  setShowToc: (show) =>
    set({
      showToc: show,
      showSettings: show ? false : get().showSettings,
    }),

  setLoading: (loading, message = '加载中...') =>
    set({ isLoading: loading, loadingMessage: message }),

  setChapterNavTarget: (chapterId) =>
    set({ chapterNavTarget: chapterId }),

  setFullscreen: (fs) => set({ isFullscreen: fs }),

  toggleFullscreen: () => {
    const { isFullscreen } = get();
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
    set({ isFullscreen: !isFullscreen });
  },

  hideAllPanels: () =>
    set({
      showTopBar: false,
      showBottomBar: false,
      showSettings: false,
      showToc: false,
    }),
}));
