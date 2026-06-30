/**
 * uiStore — UI 可见性和交互状态管理。
 *
 * ## 职责范围
 *
 * 管理以下临时 UI 状态（不需要持久化到 localStorage）：
 * - 面板显隐（顶栏、底栏、设置面板、目录面板）
 * - 加载状态（全屏遮罩 + 加载文案）
 * - 全屏模式
 * - 章节导航目标
 *
 * ## 设计约束
 *
 * - 设置面板和目录面板互斥（打开一个时自动关闭另一个）
 * - 点击阅读区域中央（tap-middle）切换顶/底栏显隐
 * - 翻页/滚动时自动隐藏所有面板（hideAllPanels）
 *
 * ## 与 readerStore 的关系
 *
 * uiStore 只管 UI 显隐，readerStore 管阅读数据和位置。
 * 两者通过 ReaderShell 组件协调工作。
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
