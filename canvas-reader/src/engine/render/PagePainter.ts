/**
 * PagePainter — 将 PageDescriptor 绘制到 Canvas 2D 上下文。
 *
 * ## 职责边界
 *
 * 这是一个纯绘制函数：接收 canvas context + 页面描述 + 绘制选项，
 * 执行所有绘制调用，然后返回。
 *
 * **不负责：**
 * - Canvas 尺寸管理（由 CanvasRenderer 负责）
 * - DPR 缩放（调用者在调用前用 ctx.scale(dpr, dpr) 处理好）
 * - 动画状态管理（animationOffset/opacity 由调用者传入）
 * - 预渲染/离屏渲染（由 CanvasRenderer 协调）
 *
 * ## 绘制层级（从下到上）
 *
 * 1. 背景色填充 (theme.backgroundColor)
 * 2. 正文文本行 (逐行 drawText)
 * 3. 页眉：章节名称（居中，70% 字号，灰色）
 * 4. 页脚：页码（居中，65% 字号，灰色）
 * 5. 进度条：底部 2px 细条
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';
import type { RenderTheme, PaintOptions } from './types';

/**
 * Paint a single page onto a canvas 2D context.
 *
 * All coordinates are in CSS pixels. The caller is responsible for
 * DPR scaling on the context before calling this function.
 */
export function paintPage(
  ctx: CanvasRenderingContext2D,
  options: PaintOptions,
): void {
  const {
    page,
    config,
    theme,
    showHeaderFooter = true,
    chapterTitle,
    showProgressBar = false,
    animationOffset = 0,
    opacity = 1,
  } = options;

  const pageWidth = config.pageWidth;
  const pageHeight = config.pageHeight;

  ctx.save();

  // Apply opacity for fade transitions
  if (opacity < 1) {
    ctx.globalAlpha = opacity;
  }

  // Apply animation offset (slide)
  if (animationOffset !== 0) {
    ctx.translate(animationOffset, 0);
  }

  // 1. Draw background
  ctx.fillStyle = theme.backgroundColor;
  ctx.fillRect(0, 0, pageWidth, pageHeight);

  // 2. Draw text lines
  ctx.textBaseline = 'alphabetic';

  for (const line of page.lines) {
    drawLine(ctx, line.text, line.x, line.y, config, theme);
  }

  // 3. Draw header (chapter title)
  if (showHeaderFooter && chapterTitle) {
    drawHeader(ctx, chapterTitle, pageWidth, config, theme);
  }

  // 4. Draw footer (page number + progress)
  if (showHeaderFooter || showProgressBar) {
    const pageInfo = page.isLastPage
      ? `${page.pageIndex + 1} (终)`
      : `${page.pageIndex + 1}`;

    drawFooter(ctx, pageInfo, pageWidth, pageHeight, config, theme);

    // 5. Progress bar
    if (showProgressBar && page.totalPagesKnown > 0) {
      drawProgressBar(
        ctx,
        pageWidth,
        pageHeight,
        page.pageIndex,
        page.totalPagesKnown,
        theme,
      );
    }
  }

  ctx.restore();
}

/**
 * Draw a single line of text.
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  config: LayoutConfig,
  theme: RenderTheme,
): void {
  ctx.font = `${config.fontSize}px ${config.fontFamily}`;
  ctx.fillStyle = theme.textColor;
  // y is the baseline position
  ctx.fillText(text, x, y + config.fontSize * 0.85); // Adjust to baseline
}

/**
 * Draw the header: chapter title, centered, small, subtle.
 */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  title: string,
  pageWidth: number,
  config: LayoutConfig,
  theme: RenderTheme,
): void {
  const headerFontSize = config.fontSize * 0.7;
  ctx.font = `${headerFontSize}px ${config.fontFamily}`;
  ctx.fillStyle = theme.textColorSecondary;
  ctx.textAlign = 'center';

  // Truncate title if too long
  const maxWidth = pageWidth - config.paddingLeft - config.paddingRight;
  let displayTitle = title;
  while (ctx.measureText(displayTitle).width > maxWidth && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -4) + '…';
  }

  ctx.fillText(displayTitle, pageWidth / 2, config.paddingTop * 0.6);
  ctx.textAlign = 'left'; // reset
}

/**
 * Draw the footer: page number.
 */
function drawFooter(
  ctx: CanvasRenderingContext2D,
  pageInfo: string,
  pageWidth: number,
  pageHeight: number,
  config: LayoutConfig,
  theme: RenderTheme,
): void {
  const footerFontSize = config.fontSize * 0.65;
  ctx.font = `${footerFontSize}px ${config.fontFamily}`;
  ctx.fillStyle = theme.textColorSecondary;
  ctx.textAlign = 'center';

  ctx.fillText(
    pageInfo,
    pageWidth / 2,
    pageHeight - config.paddingBottom * 0.3,
  );
  ctx.textAlign = 'left'; // reset
}

/**
 * Draw a thin reading progress bar at the bottom of the page.
 */
function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  pageWidth: number,
  pageHeight: number,
  currentPage: number,
  totalPages: number,
  theme: RenderTheme,
): void {
  const barHeight = 2;
  const barY = pageHeight - barHeight;
  const progress = Math.max(0, Math.min(1, currentPage / Math.max(1, totalPages)));

  // Background track
  ctx.fillStyle = theme.textColorSecondary + '30'; // 30 = ~18% opacity hex
  ctx.fillRect(0, barY, pageWidth, barHeight);

  // Progress fill
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(0, barY, pageWidth * progress, barHeight);
}
