/**
 * ReaderShell — 阅读器顶层布局。
 *
 * 组装所有阅读器子组件：
 * - CanvasViewport (Canvas 画布)
 * - TouchLayer (手势检测)
 * - TopBar / BottomBar (导航栏)
 * - SettingsPanel / TocPanel (滑出面板)
 * - 加载/错误状态
 *
 * 支持翻页和滚动两种阅读模式。
 */
import React, { useRef, useCallback, useEffect, useState } from 'react';
import { CanvasViewport } from './CanvasViewport';
import type { CanvasViewportHandle } from './CanvasViewport';
import { TouchLayer } from './TouchLayer';
import { TopBar } from './TopBar';
import { BottomBar } from './BottomBar';
import { SettingsPanel } from './SettingsPanel';
import { TocPanel } from './TocPanel';
import { Button } from '@/components/ui/button';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';
import { useReader, setPagedImageBlocks } from '../hooks/useReader';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { CanvasRenderer } from '@engine/render/CanvasRenderer';
import type { PageTurnAnimationType } from '@engine/render/CanvasRenderer';
import { getThemeById, applyThemeToDOM } from '@engine/render/ThemeApplicator';
import { hashLayoutConfig } from '@engine/layout/Paginator';
import { onPageHidden } from '@/services/lifecycle';
import { setItem } from '@/services/storage/localStorage';
import type { TextLine, ImageBlock } from '@engine/layout/types';
import type { ChapterImage } from '@book/types';
import type { BookSource } from '@book/types';
import type { TapZone } from '../gestures/types';
import type { CanvasDimensions } from '../hooks/useCanvasResize';

/**
 * 根据已预加载的图片元素创建 ImageBlock 数组。
 * 使用真实图片宽高比计算显示高度。
 */
function createImageBlocks(
  images: ChapterImage[],
  preloadedImages: Map<string, HTMLImageElement>,
  contentWidth: number,
  leftMargin: number,
): ImageBlock[] {
  const IMG_GAP = 12;
  let y = IMG_GAP;

  return images.map((img) => {
    const el = preloadedImages.get(img.url);
    const naturalW = el?.naturalWidth || 3;
    const naturalH = el?.naturalHeight || 4;
    const displayH = Math.round(contentWidth * (naturalH / naturalW));

    const block: ImageBlock = {
      url: img.url,
      x: leftMargin,
      y,
      width: contentWidth,
      height: displayH,
    };
    y += displayH + IMG_GAP;
    return block;
  });
}

interface ReaderShellProps {
  bookSource: BookSource;
  onBack: () => void;
  initialChapterId?: string;
  initialCharOffset?: number;
  initialPageIndex?: number;
  initialScrollOffset?: number;
}

export const ReaderShell: React.FC<ReaderShellProps> = ({
  bookSource,
  onBack,
  initialChapterId,
  initialCharOffset,
  initialPageIndex,
  initialScrollOffset,
}) => {
  const viewportRef = useRef<CanvasViewportHandle>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = React.useState<CanvasDimensions | null>(null);
  const isAnimatingRef = useRef(false);

  const store = useReaderStore();
  const settings = useSettingsStore();
  const ui = useUIStore();

  const lastRenderedChapterRef = useRef<string>('');
  const [imagesVersion, setImagesVersion] = useState(0);
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // 图片预加载
  useEffect(() => {
    const images = store.chapterImages;
    if (!images || images.length === 0) {
      preloadedImagesRef.current = new Map();
      rendererRef.current?.setPreloadedImages(new Map());
      setImagesVersion(0);
      return;
    }
    const imageMap = new Map<string, HTMLImageElement>();
    preloadedImagesRef.current = imageMap;
    setImagesVersion(0);
    let loaded = 0;
    images.forEach((img) => {
      const el = new Image();
      el.onload = el.onerror = () => {
        loaded++;
        if (loaded >= images.length) {
          rendererRef.current?.setPreloadedImages(imageMap);
          setImagesVersion((v) => v + 1);
        }
      };
      el.src = img.url;
      imageMap.set(img.url, el);
    });
  }, [store.chapterImages]);

  // 翻页动画回调
  const animType = settings.pageTurnAnimation as PageTurnAnimationType;
  const onBeforePageTurn = useCallback(
    (fromPage: import('@engine/layout/types').PageDescriptor, toPage: import('@engine/layout/types').PageDescriptor, direction: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (isAnimatingRef.current) { resolve(); return; }
        isAnimatingRef.current = true;
        const renderer = rendererRef.current;
        if (renderer && animType !== 'none') {
          renderer.startPageTurn(fromPage, toPage, direction, 300, () => {
            isAnimatingRef.current = false;
            resolve();
          });
        } else {
          isAnimatingRef.current = false;
          resolve();
        }
      });
    },
    [animType],
  );

  // 滚动模式状态
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const [centerToast, setCenterToast] = useState<string | null>(null);
  const centerToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCenterToast = useCallback((msg: string) => {
    setCenterToast(msg);
    if (centerToastTimerRef.current) clearTimeout(centerToastTimerRef.current);
    centerToastTimerRef.current = setTimeout(() => setCenterToast(null), 1500);
  }, []);

  const scrollOffsetRef = useRef(0);
  useEffect(() => { scrollOffsetRef.current = scrollOffset; }, [scrollOffset]);
  const momentumAnimRef = useRef(0);
  const momentumVelocityRef = useRef(0);
  const scrollStateRef = useRef({ contentHeight: 0, viewportHeight: 600 });
  useEffect(() => {
    scrollStateRef.current = {
      contentHeight: scrollContentHeight,
      viewportHeight: canvasDims?.cssHeight || 600,
    };
  }, [scrollContentHeight, canvasDims]);

  const {
    openBook,
    goToChapter,
    nextPage,
    prevPage,
    onSettingsChanged,
    layoutEngineRef,
  } = useReader({
    canvasDimensions: canvasDims,
    onBeforePageTurn,
    initialChapterId,
    initialCharOffset,
    initialPageIndex,
    initialScrollOffset,
  });

  // 注入主题 CSS 变量到 DOM
  const theme = getThemeById(settings.theme);
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // 挂载时打开书籍
  useEffect(() => {
    openBook(bookSource);
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [bookSource]);

  // 初始化/更新 Canvas 渲染器
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

  // 预计算图片块（翻页模式）
  const imageBlocksRef = useRef<ImageBlock[]>([]);
  useEffect(() => {
    const images = store.chapterImages;
    if (!images || images.length === 0 || !canvasDims) {
      imageBlocksRef.current = [];
      return;
    }
    const pageH = canvasDims.cssHeight;
    const cw = canvasDims.cssWidth - settings.paddingLeft - settings.paddingRight;
    const left = settings.paddingLeft;
    const blocks: ImageBlock[] = images.map((img) => {
      const el = preloadedImagesRef.current.get(img.url);
      const nw = el?.naturalWidth || 3;
      const nh = el?.naturalHeight || 4;
      const h = Math.round(cw * (nh / nw));
      return { url: img.url, x: left, y: Math.max(0, (pageH - h) / 2), width: cw, height: h };
    });
    imageBlocksRef.current = blocks;
    setPagedImageBlocks(blocks);
  }, [store.chapterImages, canvasDims, imagesVersion, settings.paddingLeft, settings.paddingRight]);

  // 翻页模式渲染
  useEffect(() => {
    if (settings.readingMode !== 'paged') return;
    const renderer = rendererRef.current;
    const page = store.currentPage;
    if (!renderer || !page) return;
    const images = store.chapterImages;
    const imgCount = images?.length || 0;
    const totalPages = imgCount + Math.max(1, store.totalPagesInChapter);
    const curIdx = page.pageIndex;
    if (imgCount > 0 && curIdx < imgCount && imageBlocksRef.current.length > 0) {
      const imgPage: import('@engine/layout/types').PageDescriptor = {
        pageIndex: curIdx, chapterId: page.chapterId, lines: [],
        charStart: 0, charEnd: 0,
        isFirstPage: curIdx === 0, isLastPage: curIdx >= totalPages - 1,
        totalPagesKnown: totalPages, images: [imageBlocksRef.current[curIdx]],
      };
      renderer.renderPage(imgPage);
      return;
    }
    const renderPage = imgCount > 0
      ? { ...page, pageIndex: curIdx, totalPagesKnown: totalPages, isLastPage: curIdx >= totalPages - 1 }
      : page;
    renderer.renderPage(renderPage);
  }, [store.currentPage, settings.readingMode, store.chapterImages, canvasDims, imagesVersion, store.totalPagesInChapter]);

  // 滚动模式：恢复上次位置
  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;
    const pending = store.pendingScrollRestore;
    if (pending === null) return;
    if (scrollContentHeight === 0) return;
    const viewportHeight = canvasDims?.cssHeight || 600;
    const maxOffset = Math.max(0, scrollContentHeight - viewportHeight);
    const clamped = Math.max(0, Math.min(maxOffset, pending));
    setScrollOffset(clamped);
    scrollOffsetRef.current = clamped;
    store.setPendingScrollRestore(null);
  }, [settings.readingMode, store.pendingScrollRestore, scrollContentHeight]);

  // 滚动模式：RAF 合并渲染
  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;
    const renderer = rendererRef.current;
    if (!renderer || !canvasDims) return;
    if (store.status !== 'ready') return;

    if (store.chapterId !== lastRenderedChapterRef.current) {
      lastRenderedChapterRef.current = store.chapterId || '';
      setScrollOffset(0);
      scrollOffsetRef.current = 0;
    }

    const chapterImages = store.chapterImages;
    let scrollImages: ImageBlock[] | undefined;
    if (chapterImages && chapterImages.length > 0) {
      const contentWidth = canvasDims.cssWidth - settings.paddingLeft - settings.paddingRight;
      scrollImages = createImageBlocks(chapterImages, preloadedImagesRef.current, contentWidth, settings.paddingLeft);
    }

    const rafId = requestAnimationFrame(() => {
      const engine = layoutEngineRef.current;
      const lines = engine.getAllLines();
      if (lines.length === 0 && (!scrollImages || scrollImages.length === 0)) return;
      const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
      const offset = scrollOffsetRef.current;
      const totalHeight = renderer.renderScrollContent(lines, config, offset, store.chapterTitle || undefined, scrollImages);
      if (totalHeight !== scrollStateRef.current.contentHeight) {
        scrollStateRef.current.contentHeight = totalHeight;
        setScrollContentHeight(totalHeight);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    store.status, store.chapterTitle, store.chapterImages, scrollOffset,
    settings.readingMode, canvasDims, store.chapterId, store.layoutVersion, imagesVersion,
  ]);

  // 设置变更 → 重排版 + 更新渲染器
  useEffect(() => {
    if (store.status === 'ready') {
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
    settings.fontSize, settings.fontFamily, settings.lineHeight,
    settings.paddingTop, settings.paddingBottom, settings.paddingLeft, settings.paddingRight,
    settings.paragraphIndent,
  ]);

  // 主题变更 → 更新渲染器
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateConfig({ theme, animType: settings.pageTurnAnimation as PageTurnAnimationType });
    }
  }, [theme]);

  // Canvas 尺寸变更 → 重排版（跳过首次挂载）
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!canvasDims || canvasDims.cssWidth === 0) return;
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (store.status !== 'ready') return;
    if (!rendererRef.current) return;
    const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
    rendererRef.current.updateConfig({ config, animType: settings.pageTurnAnimation as PageTurnAnimationType });
    rendererRef.current.resize(canvasDims.cssWidth, canvasDims.cssHeight);
    onSettingsChanged();
  }, [canvasDims?.cssWidth, canvasDims?.cssHeight]);

  // 保存滚动进度
  const saveScrollProgress = useCallback(() => {
    const s = useReaderStore.getState();
    if (!s.bookMetadata || !s.chapterId) return;
    const lines = layoutEngineRef.current.getAllLines();
    let charOffset = 0;
    if (lines.length > 0 && canvasDims) {
      const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
      const lineHeight = config.fontSize * config.lineHeight;
      for (const line of lines) {
        const lineY = line.y + config.paddingTop;
        if (lineY + lineHeight >= scrollOffsetRef.current) {
          charOffset = line.charRange[0];
          break;
        }
      }
      if (charOffset === 0 && lines.length > 0) {
        charOffset = lines[lines.length - 1].charRange[0];
      }
      import('@/services/storage/ProgressCache').then(({ saveReadingProgress }) => {
        saveReadingProgress({
          bookId: s.bookMetadata!.bookId,
          chapterId: s.chapterId!,
          pageIndex: 0, charOffset,
          scrollOffset: scrollOffsetRef.current,
          layoutConfigHash: hashLayoutConfig(config),
          updatedAt: Date.now(),
        });
      }).catch(() => {});
    }
  }, [canvasDims, settings]);

  // 滚动手势回调
  const handleScrollMove = useCallback(
    (deltaY: number) => {
      if (momentumAnimRef.current) { cancelAnimationFrame(momentumAnimRef.current); momentumAnimRef.current = 0; }
      setScrollOffset((prev) => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const ELASTIC = 0.25;
        if (prev < 0) { const newPos = prev + deltaY * ELASTIC; return newPos > 0 ? 0 : newPos; }
        if (maxOffset > 0 && prev > maxOffset) { const newPos = prev + deltaY * ELASTIC; return newPos < maxOffset ? maxOffset : newPos; }
        const proposed = prev + deltaY;
        if (proposed < 0) return prev + deltaY * ELASTIC;
        if (maxOffset > 0 && proposed > maxOffset) return prev + deltaY * ELASTIC;
        return Math.max(0, Math.min(maxOffset, proposed));
      });
    }, [],
  );

  const chapterNavRef = useRef(store.chapterNav);
  const isLoadingNextChapterRef = useRef(false);
  const goToChapterRef = useRef(goToChapter);
  const chapterIdRef = useRef(store.chapterId);
  useEffect(() => { chapterNavRef.current = store.chapterNav; }, [store.chapterNav]);
  useEffect(() => { goToChapterRef.current = goToChapter; }, [goToChapter]);
  useEffect(() => { chapterIdRef.current = store.chapterId; }, [store.chapterId]);

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

  const springBackTo = useCallback((from: number, target: number) => {
    if (momentumAnimRef.current) { cancelAnimationFrame(momentumAnimRef.current); momentumAnimRef.current = 0; }
    const startTime = performance.now();
    const duration = 200;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const t = 1 - Math.pow(1 - progress, 3);
      setScrollOffset(from + (target - from) * t);
      if (progress < 1) { momentumAnimRef.current = requestAnimationFrame(animate); }
      else { momentumAnimRef.current = 0; }
    };
    momentumAnimRef.current = requestAnimationFrame(animate);
  }, []);

  const handleScrollEnd = useCallback(
    (velocityY: number) => {
      const { contentHeight, viewportHeight } = scrollStateRef.current;
      const maxOffset = Math.max(0, contentHeight - viewportHeight);
      const OVERSCROLL_THRESHOLD = 45;
      const SWITCH_VELOCITY = 0.15;
      const currentOffset = scrollOffsetRef.current;

      if (maxOffset <= 0) {
        if (velocityY > SWITCH_VELOCITY) { if (!switchToNextChapter()) springBackTo(currentOffset, 0); }
        else if (velocityY < -SWITCH_VELOCITY) { if (!switchToPrevChapter()) springBackTo(currentOffset, 0); }
        return;
      }
      if (currentOffset < -OVERSCROLL_THRESHOLD) { if (!switchToPrevChapter()) springBackTo(currentOffset, 0); return; }
      if (currentOffset > maxOffset + OVERSCROLL_THRESHOLD) { if (!switchToNextChapter()) springBackTo(currentOffset, maxOffset); return; }
      if (currentOffset < 0) { springBackTo(currentOffset, 0); return; }
      if (currentOffset > maxOffset) { springBackTo(currentOffset, maxOffset); return; }

      saveScrollProgress();
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
          if (clamped === 0 || clamped === mo) momentumAnimRef.current = 0;
          return clamped;
        });
        const newVy = vy * friction;
        if (Math.abs(newVy) > minSpeed && momentumAnimRef.current !== 0) {
          momentumVelocityRef.current = newVy;
          momentumAnimRef.current = requestAnimationFrame(animate);
        } else { momentumAnimRef.current = 0; }
      };
      momentumAnimRef.current = requestAnimationFrame(animate);
    },
    [switchToPrevChapter, switchToNextChapter, springBackTo, saveScrollProgress],
  );

  // 手势处理
  const handleTap = useCallback(
    (zone: TapZone) => {
      if (ui.showSettings || ui.showToc) { ui.hideAllPanels(); return; }
      if (isAnimatingRef.current) return;
      switch (zone) {
        case 'left':
          if (settings.readingMode === 'scroll') {
            if (scrollOffsetRef.current <= 0) { if (!switchToPrevChapter()) showCenterToast('已经是第一章'); }
            else { const vh = scrollStateRef.current.viewportHeight; const target = Math.max(0, scrollOffsetRef.current - vh * 0.8); springBackTo(scrollOffsetRef.current, target); }
          } else { prevPage(); }
          break;
        case 'right':
          if (settings.readingMode === 'scroll') {
            const { contentHeight, viewportHeight } = scrollStateRef.current;
            const maxOffset = Math.max(0, contentHeight - viewportHeight);
            if (scrollOffsetRef.current >= maxOffset) { if (!switchToNextChapter()) showCenterToast('已经是最后一章'); }
            else { const vh = scrollStateRef.current.viewportHeight; const target = Math.min(maxOffset, scrollOffsetRef.current + vh * 0.8); springBackTo(scrollOffsetRef.current, target); }
          } else { nextPage(); }
          break;
        case 'middle': ui.toggleBars(); break;
      }
    },
    [nextPage, prevPage, ui, settings.readingMode, switchToPrevChapter, switchToNextChapter, springBackTo, showCenterToast],
  );

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      if (ui.showSettings || ui.showToc) return;
      if (settings.readingMode === 'scroll') return;
      if (isAnimatingRef.current) return;
      if (direction === 'left') nextPage();
      else if (direction === 'right') prevPage();
    },
    [nextPage, prevPage, ui, settings.readingMode],
  );

  // 滚轮事件 → 滚动模式
  useEffect(() => {
    if (settings.readingMode !== 'scroll') return;
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWheel = (e: WheelEvent) => {
      if (ui.showSettings || ui.showToc) return;
      e.preventDefault();
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
      const lineHeight = settings.fontSize * settings.lineHeight;
      const scrollDelta = e.deltaY * (e.deltaMode === 1 ? lineHeight : 1);
      setScrollOffset((prev) => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const ELASTIC = 0.25;
        if (prev < 0) { const newPos = prev + scrollDelta * ELASTIC; return newPos > 0 ? 0 : newPos; }
        if (maxOffset > 0 && prev > maxOffset) { const newPos = prev + scrollDelta * ELASTIC; return newPos < maxOffset ? maxOffset : newPos; }
        const proposed = prev + scrollDelta;
        if (proposed < 0) return prev + scrollDelta * ELASTIC;
        if (maxOffset > 0 && proposed > maxOffset) return prev + scrollDelta * ELASTIC;
        return Math.max(0, Math.min(maxOffset, proposed));
      });
      const OVERSCROLL_THRESHOLD = 45;
      wheelEndTimer = setTimeout(() => {
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const currentOffset = scrollOffsetRef.current;
        if (currentOffset < -OVERSCROLL_THRESHOLD) { if (!switchToPrevChapter()) springBackTo(currentOffset, 0); }
        else if (currentOffset > maxOffset + OVERSCROLL_THRESHOLD) { if (!switchToNextChapter()) springBackTo(currentOffset, maxOffset); }
        else if (currentOffset < 0) { springBackTo(currentOffset, 0); }
        else if (currentOffset > maxOffset) { springBackTo(currentOffset, maxOffset); }
        else { saveScrollProgress(); }
      }, 150);
    };
    const container = readerRootRef.current;
    if (container) container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel);
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
    };
  }, [settings.readingMode, settings.fontSize, settings.lineHeight, ui.showSettings, ui.showToc, switchToPrevChapter, switchToNextChapter, springBackTo, saveScrollProgress]);

  // 键盘导航
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

  const handleChapterSelect = useCallback((chapterId: string) => { goToChapter(chapterId, 0); }, [goToChapter]);

  useEffect(() => {
    return () => {
      if (momentumAnimRef.current) cancelAnimationFrame(momentumAnimRef.current);
      if (centerToastTimerRef.current) clearTimeout(centerToastTimerRef.current);
    };
  }, []);

  // ─── 切后台/锁屏时保存完整阅读进度（翻页 + 滚动双模式）───
  // 使用同步 setItem 确保在 pagehide/beforeunload 时可靠写入。
  // 与 usePageLifecycle 并存（multi-callback），互补保存。
  // 关键：滚动模式下 store 中的 currentCharOffset 不会随滚动更新，
  // 必须从当前 scrollOffset 反算 charOffset。
  useEffect(() => {
    const unregister = onPageHidden(() => {
      const s = useReaderStore.getState();
      if (!s.bookMetadata || !s.chapterId || !canvasDims) return;

      const config = settings.getLayoutConfig(canvasDims.cssWidth, canvasDims.cssHeight);
      let charOffset = s.currentCharOffset;

      // 滚动模式：从当前滚动位置反算 charOffset（store 值是陈旧的）
      if (settings.readingMode === 'scroll') {
        const lines = layoutEngineRef.current.getAllLines();
        const offset = scrollOffsetRef.current;
        const lineHeight = config.fontSize * config.lineHeight;
        for (const line of lines) {
          const lineY = line.y + config.paddingTop;
          if (lineY + lineHeight >= offset) {
            charOffset = line.charRange[0];
            break;
          }
        }
      }

      setItem(`progress:${s.bookMetadata.bookId}`, {
        bookId: s.bookMetadata.bookId,
        chapterId: s.chapterId,
        pageIndex: s.currentPageIndex,
        charOffset,
        scrollOffset: settings.readingMode === 'scroll' ? scrollOffsetRef.current : undefined,
        layoutConfigHash: hashLayoutConfig(config),
        updatedAt: Date.now(),
      });
    });

    return unregister;
  }, [settings.readingMode, canvasDims, settings]);

  const isLoading = store.status === 'loading-book' || store.status === 'loading-chapter' || store.status === 'laying-out';

  // ─── 错误状态 ───
  if (store.status === 'error') {
    return (
      <div className="absolute inset-0 z-[300] flex items-center justify-center bg-black/45">
        <div className="text-center p-8">
          <div className="text-5xl mb-4">😞</div>
          <div className="text-base text-muted-foreground mb-4">{store.error || '出错了'}</div>
          <Button onClick={onBack}>返回</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={readerRootRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: theme.backgroundColor }}
      data-reader-theme={theme.id}
    >
      {/* Canvas 视口（底层） */}
      <CanvasViewport ref={viewportRef} onDimensionsChange={handleDimensionsChange} />

      {/* 过卷区域提示（滚动模式） */}
      {settings.readingMode === 'scroll' && (() => {
        const OVERSCROLL_THRESHOLD = 45;
        const { contentHeight, viewportHeight } = scrollStateRef.current;
        const maxOffset = Math.max(0, contentHeight - viewportHeight);
        const hasPrev = !!chapterNavRef.current?.getPrev(chapterIdRef.current || '');
        const hasNext = !!chapterNavRef.current?.getNext(chapterIdRef.current || '');

        // 顶部过卷
        if (scrollOffset < -30) {
          let text: string;
          if (hasPrev) { text = scrollOffset < -OVERSCROLL_THRESHOLD ? '松开前往上一章' : '继续下拉前往上一章'; }
          else { text = '已经是第一章'; }
          return (
            <div className="absolute left-0 right-0 z-50 text-center text-[13px] pointer-events-none"
              style={{ top: 0, paddingTop: Math.min(-scrollOffset, 70), color: theme.textColorSecondary }}>
              {text}
            </div>
          );
        }

        // 底部过卷
        if (maxOffset > 0 && scrollOffset > maxOffset + 30) {
          let text: string;
          if (hasNext) { text = scrollOffset > maxOffset + OVERSCROLL_THRESHOLD ? '松开前往下一章' : '继续上拉前往下一章'; }
          else { text = '已经是最后一章'; }
          return (
            <div className="absolute left-0 right-0 z-50 text-center text-[13px] pointer-events-none"
              style={{ bottom: 0, paddingBottom: Math.min(scrollOffset - maxOffset, 70), color: theme.textColorSecondary }}>
              {text}
            </div>
          );
        }
        return null;
      })()}

      {/* 中央 toast */}
      {centerToast && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] px-6 py-2.5 rounded-lg bg-black/70 text-white text-sm pointer-events-none">
          {centerToast}
        </div>
      )}

      {/* 触摸手势层 */}
      <TouchLayer
        onTap={handleTap} onSwipe={handleSwipe}
        enabled={!isLoading} mode={settings.readingMode}
        onScrollMove={handleScrollMove} onScrollEnd={handleScrollEnd}
      />

      {/* 加载遮罩 */}
      {isLoading && (
        <div className="absolute inset-0 z-[300] flex items-center justify-center bg-black/45">
          <div className="text-center">
            <div className="w-9 h-9 border-[3px] border-border border-t-primary rounded-full animate-spin mb-3 mx-auto" />
            <div className="text-sm" style={{ color: theme.textColorSecondary }}>加载中...</div>
          </div>
        </div>
      )}

      {/* 顶部工具栏 */}
      {ui.showTopBar && !isLoading && <TopBar onBack={onBack} />}

      {/* 底部工具栏 */}
      {ui.showBottomBar && !isLoading && store.status === 'ready' && <BottomBar />}

      {/* 设置面板 */}
      {ui.showSettings && <SettingsPanel />}

      {/* 目录面板 */}
      {ui.showToc && <TocPanel onChapterSelect={handleChapterSelect} />}
    </div>
  );
};
