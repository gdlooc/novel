/**
 * CanvasRenderer — Main render orchestrator.
 *
 * Manages the canvas element lifecycle:
 * - Canvas sizing and DPR scaling
 * - Frame scheduling via requestAnimationFrame
 * - Page painting coordination
 * - Double-buffer page turn transitions
 * - Pre-rendering of adjacent pages
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';
import type { RenderTheme, ViewportState, PaintOptions } from './types';
import { paintPage } from './PagePainter';

/** 翻页动画类型 */
export type PageTurnAnimationType = 'curl' | 'slide' | 'fade' | 'none';

/** Animation state for page turns */
export interface PageTurnAnimation {
  /** Type of animation */
  type: PageTurnAnimationType;
  /** Progress 0-1 (0 = starting, 1 = done) */
  progress: number;
  /** Direction: -1 = previous page, 1 = next page */
  direction: number;
  /** Previous page descriptor */
  fromPage: PageDescriptor;
  /** Target page descriptor */
  toPage: PageDescriptor;
  /** Start timestamp */
  startTime: number;
  /** Duration in ms */
  duration: number;
  /** 动画完成后的回调 */
  onComplete?: () => void;
}

/** Configuration for CanvasRenderer */
export interface RendererConfig {
  canvas: HTMLCanvasElement;
  config: LayoutConfig;
  theme: RenderTheme;
  chapterTitle?: string;
  showHeaderFooter?: boolean;
  showProgressBar?: boolean;
  /** 翻页动画类型 */
  animType?: PageTurnAnimationType;
}

/**
 * Canvas renderer class.
 *
 * Usage:
 * ```
 * const renderer = new CanvasRenderer({ canvas, config, theme });
 * renderer.renderPage(page);
 * // On resize:
 * renderer.resize(newWidth, newHeight);
 * // Page turn animation:
 * renderer.startPageTurn(fromPage, toPage, direction);
 * ```
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: LayoutConfig;
  private theme: RenderTheme;
  private chapterTitle: string = '';
  private showHeaderFooter: boolean = true;
  private showProgressBar: boolean = true;
  /** 当前设置的翻页动画类型 */
  private animType: PageTurnAnimationType = 'curl';

  /** Viewport state */
  private viewport: ViewportState;

  /** Animation state */
  private animation: PageTurnAnimation | null = null;
  private animationFrameId: number = 0;

  /** Offscreen canvas for pre-rendering next page */
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  /** Currently displayed page */
  private currentPage: PageDescriptor | null = null;

  /** Pre-rendered next page (ready to show) */
  private preRenderedPage: {
    page: PageDescriptor;
    canvas: HTMLCanvasElement;
  } | null = null;

  /** 预加载的图片元素（由阅读器层设置，用于 PagePainter） */
  private preloadedImages: Map<string, HTMLImageElement> = new Map();

  constructor({ canvas, config, theme, chapterTitle, showHeaderFooter, showProgressBar, animType }: RendererConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for CanvasRenderer');
    }
    this.ctx = ctx;
    this.config = config;
    this.theme = theme;
    if (chapterTitle !== undefined) this.chapterTitle = chapterTitle;
    if (showHeaderFooter !== undefined) this.showHeaderFooter = showHeaderFooter;
    if (showProgressBar !== undefined) this.showProgressBar = showProgressBar;
    if (animType) this.animType = animType;

    // Initialize viewport
    this.viewport = {
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      dpr: window.devicePixelRatio || 1,
      physicalWidth: canvas.clientWidth * (window.devicePixelRatio || 1),
      physicalHeight: canvas.clientHeight * (window.devicePixelRatio || 1),
    };
    this.applyViewportSize();
  }

  /**
   * Update configuration after construction.
   */
  updateConfig(config: Partial<RendererConfig>): void {
    if (config.config) this.config = config.config;
    if (config.theme) this.theme = config.theme;
    if (config.chapterTitle !== undefined) this.chapterTitle = config.chapterTitle || '';
    if (config.showHeaderFooter !== undefined) this.showHeaderFooter = config.showHeaderFooter;
    if (config.showProgressBar !== undefined) this.showProgressBar = config.showProgressBar;
    if (config.animType) this.animType = config.animType;
  }

  /**
   * 设置预加载的图片元素。
   * 由阅读器层在章节加载完成后调用，传入该章节的所有插图。
   */
  setPreloadedImages(images: Map<string, HTMLImageElement>): void {
    this.preloadedImages = images;
  }

  /**
   * Render a page immediately.
   */
  renderPage(page: PageDescriptor): void {
    this.cancelAnimation();
    this.currentPage = page;
    this.drawPage(page);
  }

  /**
   * Pre-render the next page to the offscreen canvas for instant display.
   */
  preRenderPage(page: PageDescriptor): void {
    if (!this.offscreenCtx) {
      this.createOffscreenCanvas();
    }
    if (!this.offscreenCtx || !this.offscreenCanvas) return;

    this.offscreenCanvas.width = this.viewport.physicalWidth;
    this.offscreenCanvas.height = this.viewport.physicalHeight;
    this.offscreenCtx.save();
    this.offscreenCtx.scale(this.viewport.dpr, this.viewport.dpr);

    const paintOpts = this.createPaintOptions(page);
    paintPage(this.offscreenCtx, paintOpts);

    this.offscreenCtx.restore();
  }

  /**
   * Check if the pre-rendered page matches the given page index.
   */
  isPreRendered(chapterId: string, pageIndex: number): boolean {
    if (!this.preRenderedPage) return false;
    const p = this.preRenderedPage.page;
    return p.chapterId === chapterId && p.pageIndex === pageIndex;
  }

  /**
   * Use a pre-rendered page (saves a paint call on page turn).
   */
  consumePreRendered(page: PageDescriptor): boolean {
    if (this.preRenderedPage &&
        this.preRenderedPage.page.chapterId === page.chapterId &&
        this.preRenderedPage.page.pageIndex === page.pageIndex) {
      // Copy pre-rendered canvas to main canvas
      this.ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);
      this.ctx.drawImage(
        this.preRenderedPage.canvas,
        0, 0,
        this.viewport.physicalWidth,
        this.viewport.physicalHeight,
      );
      this.currentPage = page;
      this.preRenderedPage = null;
      return true;
    }
    return false;
  }

  /**
   * Handle canvas resize (e.g., window resize, orientation change).
   * Returns true if a re-render is needed.
   */
  resize(cssWidth: number, cssHeight: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const newViewport: ViewportState = {
      cssWidth,
      cssHeight,
      dpr,
      physicalWidth: cssWidth * dpr,
      physicalHeight: cssHeight * dpr,
    };

    if (
      newViewport.physicalWidth !== this.viewport.physicalWidth ||
      newViewport.physicalHeight !== this.viewport.physicalHeight
    ) {
      this.viewport = newViewport;
      this.applyViewportSize();
      this.createOffscreenCanvas();
      return true;
    }

    return false;
  }

  /**
   * Get current viewport state.
   */
  getViewport(): ViewportState {
    return { ...this.viewport };
  }

  /**
   * 启动翻页动画。
   */
  startPageTurn(
    fromPage: PageDescriptor,
    toPage: PageDescriptor,
    direction: number,
    duration: number = 300,
    onComplete?: () => void,
  ): void {
    this.cancelAnimation();

    if (this.animType === 'none') {
      this.renderPage(toPage);
      onComplete?.();
      return;
    }

    this.animation = {
      type: this.animType,
      progress: 0,
      direction,
      fromPage,
      toPage,
      startTime: performance.now(),
      duration,
      onComplete,
    };

    this.tickAnimation();
  }

  /**
   * 在拖拽中渲染翻页预览（仿微信读书/Apple Books 手势跟随）。
   */
  renderDragPreview(
    fromPage: PageDescriptor,
    toPage: PageDescriptor,
    direction: number,
    progress: number,
  ): void {
    this.cancelAnimation();

    const p = Math.max(0, Math.min(1, progress));
    const pageWidth = this.config.pageWidth;
    const pageHeight = this.config.pageHeight;

    this.ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);

    if (this.animType === 'slide') {
      const offset = -direction * pageWidth * p;
      this.drawPage(fromPage, offset);
      this.drawPage(toPage, offset + direction * pageWidth);
    } else if (this.animType === 'fade') {
      this.drawPage(fromPage, 0, 1 - p);
      this.drawPage(toPage, 0, p);
    } else {
      const ctx = this.ctx;
      const dpr = this.viewport.dpr;
      const curlX = direction > 0 ? pageWidth * (1 - p) : pageWidth * p;

      ctx.save();
      ctx.scale(dpr, dpr);
      this.drawPageDirect(toPage, 0, 1);
      ctx.restore();

      ctx.save();
      ctx.scale(dpr, dpr);
      if (direction > 0) {
        ctx.beginPath(); ctx.rect(0, 0, curlX, pageHeight); ctx.clip();
      } else {
        ctx.beginPath(); ctx.rect(curlX, 0, pageWidth - curlX, pageHeight); ctx.clip();
      }
      this.drawPageDirect(fromPage, 0, 1);

      if (curlX > 0 && curlX < pageWidth) {
        if (direction > 0) {
          const sw = Math.min(30, curlX * 0.3);
          const grad = ctx.createLinearGradient(curlX - sw, 0, curlX, 0);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          grad.addColorStop(1, 'rgba(0,0,0,0.15)');
          ctx.fillStyle = grad;
          ctx.fillRect(curlX - sw, 0, sw, pageHeight);
        } else {
          const sw = Math.min(30, (pageWidth - curlX) * 0.3);
          const grad = ctx.createLinearGradient(curlX, 0, curlX + sw, 0);
          grad.addColorStop(0, 'rgba(0,0,0,0.15)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(curlX, 0, sw, pageHeight);
        }
      }
      ctx.restore();
    }
  }

  /**
   * 完成拖拽后的动画过渡。
   */
  finishDragAnimation(
    fromPage: PageDescriptor,
    toPage: PageDescriptor,
    direction: number,
    fromProgress: number,
    toProgress: number,
    duration: number = 200,
    onComplete?: () => void,
  ): void {
    this.cancelAnimation();

    const fp = Math.max(0, Math.min(1, fromProgress));
    const tp = Math.max(0, Math.min(1, toProgress));

    if (Math.abs(tp - fp) < 0.001 || this.animType === 'none' || duration <= 0) {
      this.renderPage(tp >= 1 ? toPage : fromPage);
      onComplete?.();
      return;
    }

    let finished = false;
    const startTime = performance.now();

    const tick = () => {
      if (finished) return;
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.renderDragPreview(fromPage, toPage, direction, fp + (tp - fp) * eased);

      if (t >= 1) {
        finished = true;
        this.animationFrameId = 0;
        if (tp >= 1) this.currentPage = toPage;
        onComplete?.();
        return;
      }
      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  /**
   * Cancel any running animation.
   */
  cancelAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    this.animation = null;
  }

  /**
   * 渲染滚动模式内容。
   */
  renderScrollContent(
    lines: import('../layout/types').TextLine[],
    config: LayoutConfig,
    scrollOffset: number,
    chapterTitle?: string,
    images?: import('../layout/types').ImageBlock[],
  ): number {
    this.cancelAnimation();

    const pageWidth = config.pageWidth;
    const viewportHeight = this.viewport.cssHeight;
    const dpr = this.viewport.dpr;

    let imageAreaHeight = 0;
    if (images && images.length > 0) {
      for (const img of images) { imageAreaHeight += img.height + 12; }
      imageAreaHeight += 8;
    }

    const BOTTOM_PADDING = Math.max(config.paddingBottom, 80);
    let totalHeight = config.paddingTop + imageAreaHeight;
    if (lines.length > 0) {
      totalHeight += lines[lines.length - 1].y + config.fontSize * 1.2;
    }
    totalHeight += BOTTOM_PADDING;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = this.theme.backgroundColor;
    ctx.fillRect(0, 0, pageWidth, viewportHeight);

    if (images && images.length > 0) {
      for (const imgBlock of images) {
        const drawY = config.paddingTop + imgBlock.y - scrollOffset;
        if (drawY + imgBlock.height > 0 && drawY < viewportHeight) {
          const img = this.preloadedImages.get(imgBlock.url);
          if (img && img.complete) {
            const scale = Math.min(imgBlock.width / img.naturalWidth, imgBlock.height / img.naturalHeight, 1);
            const sw = img.naturalWidth * scale;
            const sh = img.naturalHeight * scale;
            ctx.drawImage(img, imgBlock.x + (imgBlock.width - sw) / 2, drawY + (imgBlock.height - sh) / 2, sw, sh);
          }
        }
      }
    }

    const lineHeight = config.fontSize * config.lineHeight;
    const bufferPx = 5 * lineHeight;
    const renderTop = scrollOffset - bufferPx;
    const renderBottom = scrollOffset + viewportHeight + bufferPx;
    const startIdx = this.binarySearchLineStart(lines, renderTop - config.paddingTop - imageAreaHeight - lineHeight);

    ctx.font = `${config.fontSize}px ${config.fontFamily}`;
    ctx.fillStyle = this.theme.textColor;
    ctx.textBaseline = 'alphabetic';

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const lineY = line.y + config.paddingTop + imageAreaHeight;
      if (lineY > renderBottom) break;
      ctx.fillText(line.text, line.x + config.paddingLeft, lineY - scrollOffset + config.fontSize * 0.85);
    }

    if (this.showProgressBar && totalHeight > viewportHeight) {
      const barH = 2;
      const barY = viewportHeight - barH;
      const prog = Math.min(1, scrollOffset / (totalHeight - viewportHeight));
      ctx.fillStyle = this.theme.textColorSecondary + '30';
      ctx.fillRect(0, barY, pageWidth, barH);
      ctx.fillStyle = this.theme.accentColor;
      ctx.fillRect(0, barY, pageWidth * prog, barH);
    }

    ctx.restore();
    return totalHeight;
  }

  private binarySearchLineStart(lines: import('../layout/types').TextLine[], targetY: number): number {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (lines[mid].y < targetY) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private tickAnimation(): void {
    if (!this.animation) return;
    const elapsed = performance.now() - this.animation.startTime;
    const progress = Math.min(1, elapsed / this.animation.duration);
    this.animation.progress = progress;

    const { type, direction, fromPage, toPage } = this.animation;
    const pageWidth = this.config.pageWidth;
    const pageHeight = this.config.pageHeight;

    this.ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);

    if (type === 'slide') {
      const t = 1 - Math.pow(1 - progress, 3);
      const offset = -direction * pageWidth * t;
      this.drawPage(fromPage, offset);
      this.drawPage(toPage, offset + direction * pageWidth);
    } else if (type === 'fade') {
      this.drawPage(fromPage, 0, 1 - progress);
      this.drawPage(toPage, 0, progress);
    } else if (type === 'curl') {
      const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      let curlX = direction > 0 ? pageWidth * (1 - t) : pageWidth * t;
      const ctx = this.ctx;
      const dpr = this.viewport.dpr;

      ctx.save(); ctx.scale(dpr, dpr);
      this.drawPageDirect(toPage, 0, 1);
      ctx.restore();

      ctx.save(); ctx.scale(dpr, dpr);
      if (direction > 0) {
        ctx.beginPath(); ctx.rect(0, 0, curlX, pageHeight); ctx.clip();
      } else {
        ctx.beginPath(); ctx.rect(curlX, 0, pageWidth - curlX, pageHeight); ctx.clip();
      }
      this.drawPageDirect(fromPage, 0, 1);

      if (curlX > 0 && curlX < pageWidth) {
        if (direction > 0) {
          const sw = Math.min(30, curlX * 0.3);
          const grad = ctx.createLinearGradient(curlX - sw, 0, curlX, 0);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          grad.addColorStop(1, 'rgba(0,0,0,0.15)');
          ctx.fillStyle = grad; ctx.fillRect(curlX - sw, 0, sw, pageHeight);
        } else {
          const sw = Math.min(30, (pageWidth - curlX) * 0.3);
          const grad = ctx.createLinearGradient(curlX, 0, curlX + sw, 0);
          grad.addColorStop(0, 'rgba(0,0,0,0.15)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad; ctx.fillRect(curlX, 0, sw, pageHeight);
        }
      }
      ctx.restore();
    }

    if (progress >= 1) {
      this.currentPage = toPage;
      const cb = this.animation.onComplete;
      this.animation = null;
      cb?.();
    } else {
      this.animationFrameId = requestAnimationFrame(() => this.tickAnimation());
    }
  }

  private drawPage(page: PageDescriptor, animationOffset: number = 0, opacity: number = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.viewport.dpr, this.viewport.dpr);
    const paintOpts: PaintOptions = {
      ...this.createPaintOptions(page),
      animationOffset,
      opacity,
    };
    paintPage(ctx, paintOpts);
    ctx.restore();
  }

  private drawPageDirect(page: PageDescriptor, _offset: number = 0, opacity: number = 1): void {
    const paintOpts: PaintOptions = {
      ...this.createPaintOptions(page),
      animationOffset: 0,
      opacity,
    };
    if (opacity < 1) { this.ctx.globalAlpha = opacity; }
    paintPage(this.ctx, paintOpts);
    if (opacity < 1) { this.ctx.globalAlpha = 1; }
  }

  private createPaintOptions(page: PageDescriptor): PaintOptions {
    return {
      page,
      config: this.config,
      theme: this.theme,
      showHeaderFooter: this.showHeaderFooter,
      chapterTitle: this.chapterTitle,
      showProgressBar: this.showProgressBar,
      preloadedImages: this.preloadedImages,
    };
  }

  private applyViewportSize(): void {
    this.canvas.width = this.viewport.physicalWidth;
    this.canvas.height = this.viewport.physicalHeight;
    this.canvas.style.width = `${this.viewport.cssWidth}px`;
    this.canvas.style.height = `${this.viewport.cssHeight}px`;
  }

  private createOffscreenCanvas(): void {
    const oc = document.createElement('canvas');
    oc.width = this.viewport.physicalWidth;
    oc.height = this.viewport.physicalHeight;
    this.offscreenCanvas = oc;
    this.offscreenCtx = oc.getContext('2d');
  }

  destroy(): void {
    this.cancelAnimation();
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
  }
}