/**
 * ReaderShell — Top-level reader layout.
 *
 * Composes all reader sub-components:
 * - CanvasViewport (the page canvas)
 * - TouchLayer (gesture detection)
 * - TopBar / BottomBar (navigation chrome)
 * - SettingsPanel / TocPanel (slide-up panels)
 * - Loading indicator
 *
 * This is the main component rendered when a book is open.
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { CanvasViewport } from './CanvasViewport';
import type { CanvasViewportHandle } from './CanvasViewport';
import { TouchLayer } from './TouchLayer';
import { TopBar } from './TopBar';
import { BottomBar } from './BottomBar';
import { SettingsPanel } from './SettingsPanel';
import { TocPanel } from './TocPanel';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';
import { useReader } from '../hooks/useReader';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { CanvasRenderer } from '@engine/render/CanvasRenderer';
import type { PageTurnAnimationType } from '@engine/render/CanvasRenderer';
import { getThemeById, applyThemeToDOM } from '@engine/render/ThemeApplicator';
import { hashLayoutConfig } from '@engine/layout/Paginator';
import type { TextLine } from '@engine/layout/types';

import type { BookSource } from '@book/types';
import type { TapZone } from '../gestures/types';
import type { CanvasDimensions } from '../hooks/useCanvasResize';

interface ReaderShellProps {
  bookSource: BookSource;
  onBack: () => void;
}

export const ReaderShell: React.FC<ReaderShellProps> = ({
  bookSource,
  onBack,
}) => {
  const viewportRef = useRef<CanvasViewportHandle>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  /** 阅读器根容器 ref，用于滚动模式的滚轮事件监听 */
  const readerRootRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = React.useState<CanvasDimensions | null>(null);
  /** 动画进行中标志，用于阻止连点翻页 */
  const isAnimatingRef = useRef(false);

  // Stores
  const store = useReaderStore();
  const settings = useSettingsStore();
  const ui = useUIStore();

  // ─── 翻页动画回调 ───
  const animType = settings.pageTurnAnimation as PageTurnAnimationType;
  const onBeforePageTurn = useCallback(
    (fromPage: import('@engine/layout/types').PageDescriptor, toPage: import('@engine/layout/types').PageDescriptor, direction: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (isAnimatingRef.current) {
          // 动画进行中，拒绝重复触发
          resolve();
          return;
        }
        isAnimatingRef.current = true;
        const renderer = rendererRef.current;
        if (renderer && animType !== 'none') {
          renderer.startPageTurn(fromPage, toPage, direction, 300, () => {
            isAnimatingRef.current = false;
            resolve();
          });
        } else {
          // 无动画或渲染器未就绪，直接完成
          isAnimatingRef.current = false;
          resolve();
        }
      });
    },
    [animType],
  );

  // ─── 滚动模式状态 ───
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  /** 中央 toast（仅点击无章节时显示） */
  const [centerToast, setCenterToast] = useState<string | null>(null);
  const centerToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCenterToast = useCallback((msg: string) => {
    setCenterToast(msg);
    if (centerToastTimerRef.current) clearTimeout(centerToastTimerRef.current);
    centerToastTimerRef.current = setTimeout(() => setCenterToast(null), 1500);
  }, []);

  /** scrollOffset 的最新值 ref（供回调读取，避免闭包陈旧） */
  const scrollOffsetRef = useRef(0);
  useEffect(() => { scrollOffsetRef.current = scrollOffset; }, [scrollOffset]);
  /** 惯量/回弹动画帧 ID */
  const momentumAnimRef = useRef(0);
  /** 惯量速度缓存 */
  const momentumVelocityRef = useRef(0);
  /** scrollContentHeight 和 canvasDims 的 ref 缓存 */
  const scrollStateRef = useRef({ contentHeight: 0, viewportHeight: 600 });
  useEffect(() => {
    scrollStateRef.current = {
      contentHeight: scrollContentHeight,
      viewportHeight: canvasDims?.cssHeight || 600,
    };
  }, [scrollContentHeight, canvasDims]);

  // Reader controller
  const {
    openBook,
    goToChapter,
    nextPage,
    prevPage,
    onSettingsChanged,
    layoutEngineRef,
  } = useReader({ canvasDimensions: canvasDims, onBeforePageTurn });

  // Apply theme to DOM
  const theme = getThemeById(settings.theme);
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Open book on mount
  useEffect(() => {
    openBook(bookSource);

    return () => {
      // Cleanup renderer
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [bookSource]);

  // Initialize canvas renderer when dimensions change
  const handleDimensionsChange = useCallback(
    (dims: CanvasDimensions) => {
      setCanvasDims(dims);

      const canvas = viewportRef.current?.canvas;
      if (!canvas) return;

      const config = settings.getLayoutConfig(dims.cssWidth, dims.cssHeight);

      if (!rendererRef.current) {
        rendererRef.current = new CanvasRenderer({
          canvas,
          config,
          theme,
          chapterTitle: store.chapterTitle || undefined,
          showHeaderFooter: settings.showHeaderFooter,
          showProgressBar: settings.showProgressBar,
          animType: settings.pageTurnAnimation as PageTurnAnimationType,
        });
      } else {
        rendererRef.current.resize(dims.cssWidth, dims.cssHeight);
        rendererRef.current.updateConfig({
          config,
          theme,
          chapterTitle: store.chapterTitle || undefined,
          showHeaderFooter: settings.showHeaderFooter,
          showProgressBar: settings.showProgressBar,
          animType: settings.pageTurnAnimation as PageTurnAnimationType,
        });
      }
    },
    [settings, theme, store.chapterTitle],
  );

  // Render current page when it changes (翻页模式)
  useEffect(() => {
    if (settings.readingMode !== 'paged') return;
    const renderer = rendererRef.current;
    const page = store.currentPage;
    if (!renderer || !page) return;

    renderer.renderPage(page);

    // Pre-render next page
    if (store.nextPage) {
      renderer.preRenderPage(store.nextPage);
    }
  }, [store.currentPage, store.nextPage, settings.readingMode]);

  // 滚动模式：排版完成后恢复上次滚动位置
  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;
    const pending = store.pendingScrollRestore;
    if (pending === null) return;
    if (scrollContentHeight === 0) return; // 内容高度尚未计算

    // 内容就绪后恢复到保存的滚动位置
    const viewportHeight = canvasDims?.cssHeight || 600;
    const maxOffset = Math.max(0, scrollContentHeight - viewportHeight);
    const clamped = Math.max(0, Math.min(maxOffset, pending));
    setScrollOffset(clamped);
    scrollOffsetRef.current = clamped;
    // 清除待恢复标记
    store.setPendingScrollRestore(null);
  }, [settings.readingMode, store.pendingScrollRestore, scrollContentHeight]);

  // 滚动模式渲染（RAF 合并，避免单帧内多次重绘）
  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;
    const renderer = rendererRef.current;
    if (!renderer || !canvasDims) return;
    if (store.status !== 'ready') return;

    // 使用 requestAnimationFrame 合并渲染：
    // scrollOffset 可能在同一个 16ms 帧内被多次更新（如触控板高频率滚动），
    // 取消上次未执行的 RAF，只保留最新的一次，确保每帧最多绘制一次。
    const rafId = requestAnimationFrame(() => {
      const lines = layoutEngineRef.current.getAllLines();
      if (lines.length === 0) return;

      const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
      // 从 ref 读取最新值，避免闭包中 scrollOffset 陈旧
      const offset = scrollOffsetRef.current;
      const totalHeight = renderer.renderScrollContent(
        lines,
        config,
        offset,
        store.chapterTitle || undefined,
      );

      if (totalHeight !== scrollStateRef.current.contentHeight) {
        scrollStateRef.current.contentHeight = totalHeight;
        setScrollContentHeight(totalHeight);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    store.status,
    store.chapterTitle,
    scrollOffset, // React 状态变更触发 effect，但实际值从 ref 读取
    settings.readingMode,
    canvasDims,
    store.chapterId,
    store.layoutVersion,
  ]);

  // Handle settings changes → re-layout
  useEffect(() => {
    if (store.status === 'ready') {
      // Update renderer config before re-layout so it uses
      // the new font size / line height when rendering the new pages.
      if (rendererRef.current && canvasDims) {
        const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
        rendererRef.current.updateConfig({
          config,
          theme: getThemeById(settings.theme),
          showHeaderFooter: settings.showHeaderFooter,
          showProgressBar: settings.showProgressBar,
          animType: settings.pageTurnAnimation as PageTurnAnimationType,
        });
      }
      onSettingsChanged();
    }
  }, [
    settings.fontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.paddingTop,
    settings.paddingBottom,
    settings.paddingLeft,
    settings.paddingRight,
    settings.paragraphIndent,
  ]);

  // Update renderer when theme changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateConfig({
        theme,
        animType: settings.pageTurnAnimation as PageTurnAnimationType,
      });
    }
  }, [theme]);

  // Re-layout when canvas dimensions change (window resize, orientation change)
  // Skip the initial mount since openBook handles that case.
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!canvasDims || canvasDims.cssWidth === 0) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return; // Initial mount — openBook handles first layout
    }
    if (store.status !== 'ready') return;
    if (!rendererRef.current) return;

    // Update renderer with new config
    const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
    rendererRef.current.updateConfig({
      config,
      animType: settings.pageTurnAnimation as PageTurnAnimationType,
    });
    rendererRef.current.resize(canvasDims.cssWidth, canvasDims.cssHeight);

    // Trigger re-layout with new page dimensions
    onSettingsChanged();
  }, [canvasDims?.cssWidth, canvasDims?.cssHeight]);

  /**
   * 保存滚动模式阅读进度。
   * 从当前 scrollOffset 计算对应的 charOffset（布局无关），
   * 同时保存视觉位置和排版配置哈希用于快速恢复。
   */
  const saveScrollProgress = useCallback(() => {
    const s = useReaderStore.getState();
    if (!s.bookMetadata || !s.chapterId) return;

    // 计算当前滚动位置对应的字符偏移量
    const lines = layoutEngineRef.current.getAllLines();
    let charOffset = 0;
    if (lines.length > 0 && canvasDims) {
      const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
      const lineHeight = config.fontSize * config.lineHeight;
      // 查找滚动位置处第一个可见行
      for (const line of lines) {
        const lineY = line.y + config.paddingTop;
        if (lineY + lineHeight >= scrollOffsetRef.current) {
          charOffset = line.charRange[0];
          break;
        }
      }
      // 兜底：使用最后一行的结束位置
      if (charOffset === 0 && lines.length > 0) {
        charOffset = lines[lines.length - 1].charRange[0];
      }

      import('@/services/storage/ProgressCache').then(({ saveReadingProgress }) => {
        saveReadingProgress({
          bookId: s.bookMetadata!.bookId,
          chapterId: s.chapterId!,
          pageIndex: 0,
          charOffset,
          scrollOffset: scrollOffsetRef.current,
          layoutConfigHash: hashLayoutConfig(config),
          updatedAt: Date.now(),
        });
      }).catch(() => {/* 静默 */});
    }
  }, [canvasDims, settings]);

  // ─── 滚动模式：连续滚动回调（始终弹性过卷）───
  const handleScrollMove = useCallback(
    (deltaY: number) => {
      // 取消任何进行中的回弹/惯量动画，由手指拖动接管
      if (momentumAnimRef.current) {
        cancelAnimationFrame(momentumAnimRef.current);
        momentumAnimRef.current = 0;
      }
      setScrollOffset((prev) => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        // 过卷弹性系数：值越小阻尼越大，0.25 表示位移降为 25%
        const ELASTIC = 0.25;

        // ── 关键修复：过卷中往回移动时也保持弹性 ──
        // 不能用 proposed 来判断，因为往回移动时 proposed 仍在过卷区间
        // 但 deltaY 方向相反，会导致两个 if 都不成立 → 直接 clamp → 瞬间回弹。
        //
        // 正确做法：检查当前位置（prev）是否在过卷状态。
        // 如果在，往回移动也应用弹性系数，直到回到正常范围。

        // 已在顶部过卷中（prev < 0），手指任意方向都弹性处理
        if (prev < 0) {
          const newPos = prev + deltaY * ELASTIC;
          // 一旦回到正常范围（≥0）就停在边界，不再弹性
          return newPos > 0 ? 0 : newPos;
        }

        // 已在底部过卷中（prev > maxOffset）
        if (maxOffset > 0 && prev > maxOffset) {
          const newPos = prev + deltaY * ELASTIC;
          return newPos < maxOffset ? maxOffset : newPos;
        }

        // ── 正常范围内 → 检查是否开始进入过卷 ──
        const proposed = prev + deltaY;

        // 向上拖拽超出顶部 → 开始弹性过卷
        if (proposed < 0) {
          return prev + deltaY * ELASTIC;
        }
        // 向下拖拽超出底部 → 开始弹性过卷
        if (maxOffset > 0 && proposed > maxOffset) {
          return prev + deltaY * ELASTIC;
        }

        // 正常范围内的滚动，1:1 跟随手指
        return Math.max(0, Math.min(maxOffset, proposed));
      });
    },
    [],
  );

  /** 章节切换辅助，返回 true 表示成功触发切换 */
  const switchToPrevChapter = useCallback((): boolean => {
    const prevChapter = chapterNavRef.current?.getPrev(chapterIdRef.current || '');
    if (prevChapter && !isLoadingNextChapterRef.current) {
      isLoadingNextChapterRef.current = true;
      goToChapterRef.current(prevChapter.chapterId, -1).finally(() => {
        setScrollOffset(0);
        isLoadingNextChapterRef.current = false;
      });
      return true;
    }
    return false;
  }, []);

  const switchToNextChapter = useCallback((): boolean => {
    const nextChapter = chapterNavRef.current?.getNext(chapterIdRef.current || '');
    if (nextChapter && !isLoadingNextChapterRef.current) {
      isLoadingNextChapterRef.current = true;
      goToChapterRef.current(nextChapter.chapterId, 0).finally(() => {
        setScrollOffset(0);
        isLoadingNextChapterRef.current = false;
      });
      return true;
    }
    return false;
  }, []);

  /** 弹性回弹到目标位置 */
  const springBackTo = useCallback((from: number, target: number) => {
    if (momentumAnimRef.current) {
      cancelAnimationFrame(momentumAnimRef.current);
      momentumAnimRef.current = 0;
    }
    const startTime = performance.now();
    const duration = 200;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const t = 1 - Math.pow(1 - progress, 3); // ease out
      setScrollOffset(from + (target - from) * t);
      if (progress < 1) {
        momentumAnimRef.current = requestAnimationFrame(animate);
      } else {
        momentumAnimRef.current = 0;
      }
    };
    momentumAnimRef.current = requestAnimationFrame(animate);
  }, []);

  const handleScrollEnd = useCallback(
    (velocityY: number) => {
      const { contentHeight, viewportHeight } = scrollStateRef.current;
      const maxOffset = Math.max(0, contentHeight - viewportHeight);
      const OVERSCROLL_THRESHOLD = 45; // 超过此阈值切换章节
      const SWITCH_VELOCITY = 0.15;

      const currentOffset = scrollOffsetRef.current;

      // 内容不足以滚动 → 用速度判断
      // velocityY > 0 = 手指上滑 → 向前翻（下一章）
      // velocityY < 0 = 手指下滑 → 向后翻（上一章）
      if (maxOffset <= 0) {
        if (velocityY > SWITCH_VELOCITY) {
          if (!switchToNextChapter()) springBackTo(currentOffset, 0);
        } else if (velocityY < -SWITCH_VELOCITY) {
          if (!switchToPrevChapter()) springBackTo(currentOffset, 0);
        }
        return;
      }

      // 过卷超过阈值 → 切换章节；若无章节则回弹
      if (currentOffset < -OVERSCROLL_THRESHOLD) {
        if (!switchToPrevChapter()) {
          springBackTo(currentOffset, 0);
        }
        return;
      }
      if (currentOffset > maxOffset + OVERSCROLL_THRESHOLD) {
        if (!switchToNextChapter()) {
          springBackTo(currentOffset, maxOffset);
        }
        return;
      }

      // 轻微过卷但不足阈值 → 回弹
      if (currentOffset < 0) {
        springBackTo(currentOffset, 0);
        return;
      }
      if (currentOffset > maxOffset) {
        springBackTo(currentOffset, maxOffset);
        return;
      }

      // 正常范围内 → 惯量滚动
      saveScrollProgress(); // 滚动停止时保存进度

      const minVelocity = 0.05;
      if (Math.abs(velocityY) < minVelocity) return;

      momentumVelocityRef.current = velocityY;

      const friction = 0.95;
      const minSpeed = 0.02;

      const animate = () => {
        const vy = momentumVelocityRef.current;
        const { contentHeight: ch, viewportHeight: vh } = scrollStateRef.current;
        const mo = Math.max(0, ch - vh);

        setScrollOffset((prev) => {
          const newOffset = prev + vy * 16;
          const clamped = Math.max(0, Math.min(mo, newOffset));

          if (clamped === 0 || clamped === mo) {
            momentumAnimRef.current = 0;
          }

          return clamped;
        });

        const newVy = vy * friction;
        if (Math.abs(newVy) > minSpeed && momentumAnimRef.current !== 0) {
          momentumVelocityRef.current = newVy;
          momentumAnimRef.current = requestAnimationFrame(animate);
        } else {
          momentumAnimRef.current = 0;
        }
      };

      momentumAnimRef.current = requestAnimationFrame(animate);
    },
    [switchToPrevChapter, switchToNextChapter, springBackTo, saveScrollProgress],
  );

  // ─── Gesture handling ───
  const handleTap = useCallback(
    (zone: TapZone) => {
      if (ui.showSettings || ui.showToc) {
        ui.hideAllPanels();
        return;
      }

      // 动画进行中拦截
      if (isAnimatingRef.current) return;

      switch (zone) {
        case 'left':
          if (settings.readingMode === 'scroll') {
            if (scrollOffsetRef.current <= 0) {
              if (!switchToPrevChapter()) showCenterToast('已经是第一章');
            } else {
              const vh = scrollStateRef.current.viewportHeight;
              const target = Math.max(0, scrollOffsetRef.current - vh * 0.8);
              springBackTo(scrollOffsetRef.current, target);
            }
          } else {
            prevPage();
          }
          break;
        case 'right':
          if (settings.readingMode === 'scroll') {
            const { contentHeight, viewportHeight } = scrollStateRef.current;
            const maxOffset = Math.max(0, contentHeight - viewportHeight);
            if (scrollOffsetRef.current >= maxOffset) {
              if (!switchToNextChapter()) showCenterToast('已经是最后一章');
            } else {
              const vh = scrollStateRef.current.viewportHeight;
              const target = Math.min(maxOffset, scrollOffsetRef.current + vh * 0.8);
              springBackTo(scrollOffsetRef.current, target);
            }
          } else {
            nextPage();
          }
          break;
        case 'middle':
          ui.toggleBars();
          break;
      }
    },
    [nextPage, prevPage, ui, settings.readingMode, switchToPrevChapter, switchToNextChapter, springBackTo, showCenterToast],
  );

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      if (ui.showSettings || ui.showToc) return;

      // 滚动模式：任何方向的滑动都禁用翻页行为
      if (settings.readingMode === 'scroll') return;

      // 动画进行中拦截（翻页模式）
      if (isAnimatingRef.current) return;

      // 翻页模式：左右滑动翻页
      if (direction === 'left') {
        nextPage();
      } else if (direction === 'right') {
        prevPage();
      }
    },
    [nextPage, prevPage, ui, settings.readingMode],
  );

  // ─── 滚动模式：章节边界检测 ───
  const chapterNavRef = useRef(store.chapterNav);
  useEffect(() => {
    chapterNavRef.current = store.chapterNav;
  }, [store.chapterNav]);

  /** 防止滚动模式重复加载章节 */
  const isLoadingNextChapterRef = useRef(false);
  /** 缓存 goToChapter，供 handleScrollEnd 等回调使用 */
  const goToChapterRef = useRef(goToChapter);
  useEffect(() => { goToChapterRef.current = goToChapter; }, [goToChapter]);
  const chapterIdRef = useRef(store.chapterId);
  useEffect(() => { chapterIdRef.current = store.chapterId; }, [store.chapterId]);

  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;

    /** 滚轮停止后的过卷检测计时器 */
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = (e: WheelEvent) => {
      // 如果设置面板打开，不拦截滚动
      if (ui.showSettings || ui.showToc) return;

      e.preventDefault();

      // 清除上次的结束检测定时器
      if (wheelEndTimer) clearTimeout(wheelEndTimer);

      const lineHeight = settings.fontSize * settings.lineHeight;
      const scrollDelta = e.deltaY * (e.deltaMode === 1 ? lineHeight : 1);

      setScrollOffset((prev) => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        // 过卷弹性系数（与手指拖动保持一致）
        const ELASTIC = 0.25;

        // ── 已在过卷中，任意方向都用弹性 ──
        // 避免往回滚动时瞬间回弹（与 handleScrollMove 相同修复）
        if (prev < 0) {
          const newPos = prev + scrollDelta * ELASTIC;
          return newPos > 0 ? 0 : newPos;
        }
        if (maxOffset > 0 && prev > maxOffset) {
          const newPos = prev + scrollDelta * ELASTIC;
          return newPos < maxOffset ? maxOffset : newPos;
        }

        // ── 正常范围内 → 检查是否开始过卷 ──
        const proposed = prev + scrollDelta;

        if (proposed < 0) return prev + scrollDelta * ELASTIC;
        if (maxOffset > 0 && proposed > maxOffset) return prev + scrollDelta * ELASTIC;

        return Math.max(0, Math.min(maxOffset, proposed));
      });

      // 150ms 无滚轮事件 → 检查过卷状态
      const OVERSCROLL_THRESHOLD = 45;
      wheelEndTimer = setTimeout(() => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const currentOffset = scrollOffsetRef.current;

        if (currentOffset < -OVERSCROLL_THRESHOLD) {
          if (!switchToPrevChapter()) springBackTo(currentOffset, 0);
        } else if (currentOffset > maxOffset + OVERSCROLL_THRESHOLD) {
          if (!switchToNextChapter()) springBackTo(currentOffset, maxOffset);
        } else if (currentOffset < 0) {
          springBackTo(currentOffset, 0);
        } else if (currentOffset > maxOffset) {
          springBackTo(currentOffset, maxOffset);
        } else {
          // 正常范围内滚动停止，保存进度
          saveScrollProgress();
        }
      }, 150);
    };

    const container = readerRootRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
    };
  }, [settings.readingMode, settings.fontSize, settings.lineHeight, ui.showSettings, ui.showToc, switchToPrevChapter, switchToNextChapter, springBackTo]);

  // ─── Keyboard navigation ───
  useKeyboardNav({
    goNext: async () => {
      if (isAnimatingRef.current) return { success: false, reason: 'loading' as const };
      await nextPage();
      return { success: true };
    },
    goPrev: async () => {
      if (isAnimatingRef.current) return { success: false, reason: 'loading' as const };
      await prevPage();
      return { success: true };
    },
    toggleBars: ui.toggleBars,
    toggleToc: () => ui.setShowToc(!ui.showToc),
    toggleSettings: () => ui.setShowSettings(!ui.showSettings),
    toggleFullscreen: ui.toggleFullscreen,
    enabled: true,
  });

  // ─── Chapter navigation ───
  const handleChapterSelect = useCallback(
    (chapterId: string) => {
      goToChapter(chapterId, 0);
    },
    [goToChapter],
  );

  // ─── 清理 ───
  useEffect(() => {
    return () => {
      if (momentumAnimRef.current) cancelAnimationFrame(momentumAnimRef.current);
      if (centerToastTimerRef.current) clearTimeout(centerToastTimerRef.current);
    };
  }, []);

  // ─── Loading state ───
  const isLoading = store.status === 'loading-book' ||
    store.status === 'loading-chapter' ||
    store.status === 'laying-out';

  // ─── Error state ───
  if (store.status === 'error') {
    return (
      <div style={fullScreenCenter}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😞</div>
          <div style={{ fontSize: 16, color: '#888', marginBottom: 16 }}>
            {store.error || '出错了'}
          </div>
          <button onClick={onBack} style={buttonStyle}>
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={readerRootRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: theme.backgroundColor,
      }}
      data-reader-theme={theme.id}
    >
      {/* Canvas viewport (base layer) */}
      <CanvasViewport
        ref={viewportRef}
        onDimensionsChange={handleDimensionsChange}
      />

{/* 过卷区域提示：显示在拉伸的空白区域 */}
      {settings.readingMode === 'scroll' && (() => {
        const OVERSCROLL_THRESHOLD = 45;
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const hasPrev = !!chapterNavRef.current?.getPrev(chapterIdRef.current || '');
        const hasNext = !!chapterNavRef.current?.getNext(chapterIdRef.current || '');

        const hintStyle: React.CSSProperties = {
          position: 'absolute', left: 0, right: 0,
          zIndex: 50, textAlign: 'center',
          color: theme.textColorSecondary,
          fontSize: 13, pointerEvents: 'none',
        };

        // 顶部过卷
        if (scrollOffset < -30) {
          let text: string;
          if (hasPrev) {
            text = scrollOffset < -OVERSCROLL_THRESHOLD ? '松开前往上一章' : '继续下拉前往上一章';
          } else {
            text = '已经是第一章';
          }
          return (
            <div style={{ ...hintStyle, top: 0, paddingTop: Math.min(-scrollOffset, 70) }}>
              {text}
            </div>
          );
        }

        // 底部过卷
        if (maxOffset > 0 && scrollOffset > maxOffset + 30) {
          let text: string;
          if (hasNext) {
            text = scrollOffset > maxOffset + OVERSCROLL_THRESHOLD ? '松开前往下一章' : '继续上拉前往下一章';
          } else {
            text = '已经是最后一章';
          }
          return (
            <div style={{ ...hintStyle, bottom: 0, paddingBottom: Math.min(scrollOffset - maxOffset, 70) }}>
              {text}
            </div>
          );
        }

        return null;
      })()}

      {/* 中央 toast：点击无章节时提示 */}
      {centerToast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 60, padding: '10px 24px', borderRadius: 8,
          background: 'rgba(0,0,0,0.72)', color: '#fff',
          fontSize: 14, pointerEvents: 'none',
        }}>
          {centerToast}
        </div>
      )}

      {/* Touch gesture overlay */}
      <TouchLayer
        onTap={handleTap}
        onSwipe={handleSwipe}
        enabled={!isLoading}
        mode={settings.readingMode}
        onScrollMove={handleScrollMove}
        onScrollEnd={handleScrollEnd}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div style={fullScreenCenter}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 36,
              height: 36,
              border: '3px solid ' + theme.cssVariables['ui-border'],
              borderTopColor: theme.accentColor,
              borderRadius: '50%',
              animation: 'reader-spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }} />
            <div style={{ fontSize: 14, color: theme.textColorSecondary }}>
              加载中...
            </div>
          </div>
          <style>{`
            @keyframes reader-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Top bar */}
      {ui.showTopBar && !isLoading && (
        <TopBar onBack={onBack} />
      )}

      {/* Bottom bar */}
      {ui.showBottomBar && !isLoading && store.status === 'ready' && (
        <BottomBar />
      )}

      {/* Settings panel */}
      {ui.showSettings && <SettingsPanel />}

      {/* Table of contents */}
      {ui.showToc && <TocPanel onChapterSelect={handleChapterSelect} />}
    </div>
  );
};

const fullScreenCenter: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 300,
  background: 'rgba(0, 0, 0, 0.45)',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 24px',
  background: '#4A90D9',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 15,
  cursor: 'pointer',
};
