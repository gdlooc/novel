/**
 * usePageLifecycle — 页面生命周期 Hook。
 *
 * 当用户切出浏览器或锁屏时，自动保存当前阅读状态。
 * 当页面重新加载后，检测是否有未完成的阅读并自动恢复。
 *
 * ## 工作原理
 *
 * ### 保存（页面前台 → 后台）
 * 1. visibilitychange → hidden 时触发
 * 2. 记录当前路由路径 + 阅读进度 + 时间戳
 * 3. 保存到 localStorage（快速） + IndexedDB（持久）
 *
 * ### 恢复（页面加载时）
 * 1. 检查是否有保存的恢复状态
 * 2. 如果状态未过期（< 30 分钟），自动导航到上次的路径
 * 3. 路径中包含阅读位置的参数（chapterId, pageIndex 等）
 *
 * ## 使用位置
 *
 * 在 AppLayout 组件中调用此 Hook，确保在所有路由下都能保存/恢复。
 *
 * ```tsx
 * // AppLayout.tsx
 * const location = useLocation();
 * usePageLifecycle({
 *   enabled: true,
 *   currentPath: location.pathname,
 * });
 * ```
 */

import { useEffect, useRef } from 'react';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { hashLayoutConfig } from '@engine/layout/Paginator';

import {
  saveRecoveryState,
  getRecoveryState,
  clearRecoveryState,
  onPageHidden,
} from '@/services/lifecycle';

/** Hook 配置选项 */
export interface UsePageLifecycleOptions {
  /** 是否启用生命周期监听 */
  enabled: boolean;
  /** 当前路由路径 */
  currentPath: string;
}

/**
 * 页面生命周期 Hook。
 *
 * 在 AppLayout 级别调用，确保在任何页面下都能：
 * - 切后台时保存恢复状态
 * - 重新加载时自动恢复
 */
export function usePageLifecycle({ enabled, currentPath }: UsePageLifecycleOptions): void {
  // 使用 ref 保持最新值，避免闭包捕获旧值
  const enabledRef = useRef(enabled);
  const currentPathRef = useRef(currentPath);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

  // ═══════════════════════════════════════════════════════════════
  // 页面隐藏时保存恢复状态
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!enabled) return;

    // 注册页面隐藏回调
    const unregister = onPageHidden(() => {
      const path = currentPathRef.current;
      if (!path) return;

      // 构建恢复状态
      const readerState = useReaderStore.getState();
      const settingsState = useSettingsStore.getState();

      // 如果在阅读器中，保存额外的阅读上下文
      const extra: Record<string, unknown> = {};

      if (readerState.bookSource) {
        extra.bookSourceType = readerState.bookSource.type;
        extra.bookSourceUri = readerState.bookSource.uri;
        // bookId 在 bookMetadata 中（下载后才会有）
        if (readerState.bookMetadata) {
          extra.bookId = readerState.bookMetadata.bookId;
        }
        extra.chapterId = readerState.chapterId;
        extra.charOffset = readerState.currentCharOffset;
        extra.pageIndex = readerState.currentPageIndex;
        extra.readingMode = settingsState.readingMode;
      }

      saveRecoveryState(path, Object.keys(extra).length > 0 ? extra : undefined);
    });

    return unregister;
  }, [enabled]);

  // ═══════════════════════════════════════════════════════════════
  // 应用启动时清除过期状态
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    // 如果是首次加载（非后台恢复），清除旧的恢复状态
    const state = getRecoveryState();
    if (state) {
      const savedAt = state.savedAt || 0;
      const timeSinceSaved = Date.now() - savedAt;

      // 超过 30 分钟 → 清理，不再恢复
      if (timeSinceSaved > 30 * 60 * 1000) {
        clearRecoveryState();
        console.log('[Lifecycle] 恢复状态已过期，已清除');
      }
    }
  }, []);
}

/**
 * 获取上次保存的恢复状态（用于 App 加载时自动导航）。
 *
 * @returns 恢复的路由路径 + 附加数据，或 null
 */
export function useRecoveryState(): {
  path: string | null;
  extra: Record<string, unknown> | null;
} {
  const state = getRecoveryState();
  if (!state) return { path: null, extra: null };

  // 清除已读取的状态（避免重复恢复）
  clearRecoveryState();

  return {
    path: state.path || null,
    extra: state.extra || null,
  };
}
