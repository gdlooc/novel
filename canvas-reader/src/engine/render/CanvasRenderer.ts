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

  constructor({ canvas, config, theme, chapterTitle, showHeaderFooter, showProgressBar, animType }: RendererConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for CanvasRenderer');
    }
    this.ctx = ctx;
    this.config = config;
    this.theme = theme;
    this.chapterTitle = chapterTitle || '';
    this.showHeaderFooter = showHeaderFooter ?? true;
    this.showProgressBar = showProgressBar ?? true;
    this.animType = animType || 'curl';

    // Initialize viewport
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || config.pageWidth;
    const cssHeight = canvas.clientHeight || config.pageHeight;
    this.viewport = {
      cssWidth,
      cssHeight,
      dpr,
      physicalWidth: cssWidth * dpr,
      physicalHeight: cssHeight * dpr,
    };
    this.applyViewportSize();

    // Create offscreen canvas for pre-rendering
    this.createOffscreenCanvas();
  }

  /**
   * Update renderer configuration.
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

    this.preRenderedPage = {
      page,
      canvas: this.offscreenCanvas,
    };
  }

  /**
   * Fast-flip to a pre-rendered page (no animation, instant drawImage).
   */
  flipToPreRendered(page: PageDescriptor): boolean {
    if (this.preRenderedPage && this.preRenderedPage.page === page) {
      // Draw the pre-rendered canvas to the main canvas
      this.ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);
      this.ctx.drawImage(
        this.preRenderedPage.canvas,
        0, 0,
        this.viewport.physicalWidth, this.viewport.physicalHeight,
        0, 0,
        this.viewport.physicalWidth, this.viewport.physicalHeight,
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
   * @param fromPage 起始页
   * @param toPage 目标页
   * @param direction 翻页方向（1=下一页, -1=上一页）
   * @param duration 动画时长 ms
   * @param onComplete 动画完成回调
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
   * 根据 scrollOffset 绘制可见的文本行。
   *
   * 性能优化：
   * - 二分查找定位起始行（O(log n)），避免从第 0 行遍历
   * - ctx.font / fillStyle / textBaseline 在循环外设置一次
   *
   * @returns 内容总高度（CSS 像素）
   */
  renderScrollContent(
    lines: import('../layout/types').TextLine[],
    config: LayoutConfig,
    scrollOffset: number,
    chapterTitle?: string,
  ): number {
    this.cancelAnimation();

    const pageWidth = config.pageWidth;
    const viewportHeight = this.viewport.cssHeight;
    const dpr = this.viewport.dpr;

    // 计算内容总高度（含上下边距）
    let totalHeight = config.paddingTop;
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      totalHeight += lastLine.y + config.fontSize * 1.2 + config.paddingBottom;
    }

    const ctx = this.ctx;

    // 清空画布
    ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);
    ctx.save();
    ctx.scale(dpr, dpr);

    // 填充背景
    ctx.fillStyle = this.theme.backgroundColor;
    ctx.fillRect(0, 0, pageWidth, viewportHeight);

    // ── 计算可见范围 ──
    const lineHeight = config.fontSize * config.lineHeight;
    const bufferLines = 5;
    const bufferPx = bufferLines * lineHeight;
    const renderTop = scrollOffset - bufferPx;
    const renderBottom = scrollOffset + viewportHeight + bufferPx;

    // ── 二分查找起始行索引 ──
    // 行按 Y 坐标升序排列，定位第一个可能可见的行
    const startIdx = this.binarySearchLineStart(
      lines,
      renderTop - config.paddingTop - lineHeight,
    );

    // ── 循环外设置不变属性，避免逐行重复解析 font 字符串 ──
    ctx.font = `${config.fontSize}px ${config.fontFamily}`;
    ctx.fillStyle = this.theme.textColor;
    ctx.textBaseline = 'alphabetic';

    // ── 只遍历可见范围内的行 ──
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const lineY = line.y + config.paddingTop;

      if (lineY > renderBottom) break; // 已超出可见区域，后续全部不可见

      const drawY = lineY - scrollOffset;
      // 行 x 坐标不含 paddingLeft，手动补上
      ctx.fillText(line.text, line.x + config.paddingLeft, drawY + config.fontSize * 0.85);
    }

    // 滚动进度条
    if (this.showProgressBar && totalHeight > viewportHeight) {
      const barHeight = 2;
      const barY = viewportHeight - barHeight;
      const progress = Math.min(1, scrollOffset / (totalHeight - viewportHeight));

      ctx.fillStyle = this.theme.textColorSecondary + '30';
      ctx.fillRect(0, barY, pageWidth, barHeight);
      ctx.fillStyle = this.theme.accentColor;
      ctx.fillRect(0, barY, pageWidth * progress, barHeight);
    }

    ctx.restore();

    return totalHeight;
  }

  /**
   * 二分查找第一个可能可见的行索引。
   *
   * 行数组按 line.y 升序排列，搜索 line.y >= targetY 的最小索引。
   * 时间复杂度 O(log n)，替代 O(n) 的从头遍历。
   */
  private binarySearchLineStart(
    lines: import('../layout/types').TextLine[],
    targetY: number,
  ): number {
    let lo = 0;
    let hi = lines.length - 1;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (lines[mid].y < targetY) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.cancelAnimation();
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.preRenderedPage = null;
    this.currentPage = null;
  }

  // ─── Private methods ───

  private applyViewportSize(): void {
    this.canvas.width = this.viewport.physicalWidth;
    this.canvas.height = this.viewport.physicalHeight;
    this.canvas.style.width = this.viewport.cssWidth + 'px';
    this.canvas.style.height = this.viewport.cssHeight + 'px';
  }

  private createOffscreenCanvas(): void {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = this.viewport.physicalWidth;
    this.offscreenCanvas.height = this.viewport.physicalHeight;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
  }

  private createPaintOptions(page: PageDescriptor): PaintOptions {
    return {
      page,
      config: this.config,
      theme: this.theme,
      showHeaderFooter: this.showHeaderFooter,
      chapterTitle: this.chapterTitle,
      showProgressBar: this.showProgressBar,
    };
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

  private tickAnimation(): void {
    if (!this.animation) return;

    const elapsed = performance.now() - this.animation.startTime;
    const progress = Math.min(1, elapsed / this.animation.duration);
    this.animation.progress = progress;

    const { type, direction, fromPage, toPage } = this.animation;
    const pageWidth = this.config.pageWidth;
    const pageHeight = this.config.pageHeight;

    // Clear
    this.ctx.clearRect(0, 0, this.viewport.physicalWidth, this.viewport.physicalHeight);

    if (type === 'slide') {
      // 缓出三次方曲线
      const t = 1 - Math.pow(1 - progress, 3);
      const offset = -direction * pageWidth * t;

      // 旧页滑出
      this.drawPage(fromPage, offset);
      // 新页滑入
      this.drawPage(toPage, offset + direction * pageWidth);
    } else if (type === 'fade') {
      // 旧页淡出
      this.drawPage(fromPage, 0, 1 - progress);
      // 新页淡入
      this.drawPage(toPage, 0, progress);
    } else if (type === 'curl') {
      // ─── 翻书卷曲动画 ───
      // 使用 easeInOutCubic 让卷曲更自然
      const t = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // 卷曲线 x 坐标：从页面右边界移动到左边界（正翻页）
      // direction=1（下一页）：curlX 从 pageWidth 到 0
      // direction=-1（上一页）：curlX 从 0 到 pageWidth
      let curlX: number;
      if (direction > 0) {
        curlX = pageWidth * (1 - t);
      } else {
        curlX = pageWidth * t;
      }

      const ctx = this.ctx;
      const dpr = this.viewport.dpr;

      // 1. 先绘制新页（底层，完整）
      ctx.save();
      ctx.scale(dpr, dpr);
      this.drawPageDirect(toPage, 0, 1);
      ctx.restore();

      // 2. 绘制旧页的可见部分（被卷曲裁切）
      ctx.save();
      ctx.scale(dpr, dpr);

      if (direction > 0) {
        // 下一页：旧页左侧保留，右侧被卷起
        // clip 区域为 [0, curlX]
        ctx.beginPath();
        ctx.rect(0, 0, curlX, pageHeight);
        ctx.clip();
        this.drawPageDirect(fromPage, 0, 1);

        // 在卷曲边缘绘制阴影
        if (curlX > 0 && curlX < pageWidth) {
          const shadowWidth = Math.min(30, curlX * 0.3);
          const gradient = ctx.createLinearGradient(
            curlX - shadowWidth, 0,
            curlX, 0
          );
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
          ctx.fillStyle = gradient;
          ctx.fillRect(curlX - shadowWidth, 0, shadowWidth, pageHeight);
        }

        // 绘制"翻过去的页面背面"——在卷曲线右侧做镜像渐变
        if (curlX < pageWidth) {
          const backGradient = ctx.createLinearGradient(
            curlX, 0,
            Math.min(curlX + 40, pageWidth), 0
          );
          backGradient.addColorStop(0, 'rgba(200,200,200,0.1)');
          backGradient.addColorStop(1, 'rgba(200,200,200,0)');
          ctx.fillStyle = backGradient;
          ctx.fillRect(curlX, 0, Math.min(40, pageWidth - curlX), pageHeight);
        }
      } else {
        // 上一页：旧页右侧保留，左侧被卷起
        ctx.beginPath();
        ctx.rect(curlX, 0, pageWidth - curlX, pageHeight);
        ctx.clip();
        this.drawPageDirect(fromPage, 0, 1);

        // 在卷曲边缘绘制阴影
        if (curlX > 0 && curlX < pageWidth) {
          const shadowWidth = Math.min(30, (pageWidth - curlX) * 0.3);
          const gradient = ctx.createLinearGradient(
            curlX, 0,
            curlX + shadowWidth, 0
          );
          gradient.addColorStop(0, 'rgba(0,0,0,0.15)');
          gradient.addColorStop(0.5, 'rgba(0,0,0,0.03)');
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(curlX, 0, shadowWidth, pageHeight);
        }

        // 卷曲线左侧的背面渐变
        if (curlX > 0) {
          const backGradient = ctx.createLinearGradient(
            Math.max(0, curlX - 40), 0,
            curlX, 0
          );
          backGradient.addColorStop(0, 'rgba(200,200,200,0)');
          backGradient.addColorStop(1, 'rgba(200,200,200,0.1)');
          ctx.fillStyle = backGradient;
          ctx.fillRect(Math.max(0, curlX - 40), 0, Math.min(40, curlX), pageHeight);
        }
      }

      ctx.restore();
    }

    if (progress >= 1) {
      // 动画完成
      this.currentPage = toPage;
      const onComplete = this.animation.onComplete;
      this.animation = null;
      // 回调必须在清理 animation 之后调用，以防回调中触发新的动画
      onComplete?.();
    } else {
      this.animationFrameId = requestAnimationFrame(() => this.tickAnimation());
    }
  }

  /**
   * 直接绘制页面（不带动画变换），供 curl 动画内部使用。
   * 与 drawPage 不同的是不额外做 save/restore/scale，
   * 因为调用者已设置好上下文变换。
   */
  private drawPageDirect(page: PageDescriptor, _animationOffset: number = 0, opacity: number = 1): void {
    const paintOpts: PaintOptions = {
      ...this.createPaintOptions(page),
      animationOffset: 0,
      opacity,
    };

    // 应用透明度
    if (opacity < 1) {
      this.ctx.globalAlpha = opacity;
    }

    paintPage(this.ctx, paintOpts);

    if (opacity < 1) {
      this.ctx.globalAlpha = 1;
    }
  }
}
