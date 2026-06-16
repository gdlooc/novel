/**
 * Render Web Worker — 将页面渲染卸载到 OffscreenCanvas 后台线程。
 *
 * ## 渐进增强策略
 *
 * OffscreenCanvas 并非所有浏览器都支持（主要是 Safari 较晚支持）。
 * 因此采用渐进增强：
 * - 支持 OffscreenCanvas → Worker 渲染，ImageBitmap 零拷贝回传主线程
 * - 不支持 → 主线程直接 Canvas 渲染（CanvasRenderer）
 *
 * ## 工作流程
 *
 * 1. 主线程发送 RENDER 请求（页面描述 + 配置 + 主题）
 * 2. Worker 创建 OffscreenCanvas，调用 paintPage() 绘制
 * 3. Worker 通过 createImageBitmap() 生成 ImageBitmap
 * 4. ImageBitmap 通过 postMessage 零拷贝传输（transfer）回主线程
 * 5. 主线程通过 ctx.drawImage(bitmap) 即时显示
 *
 * ## 零拷贝传输
 *
 * `self.postMessage(response, [imageBitmap])` 中的第二个参数
 * 是 Transferable 对象列表。被转移的对象在发送方变为无效，
 * 接收方获得所有权，避免了深拷贝的性能开销。
 *
 * ## 通信协议
 *
 * 主线程 → Worker：
 * ```
 * { type: 'RENDER', requestId, page, config, theme, chapterTitle, showHeaderFooter, showProgressBar }
 * ```
 *
 * Worker → 主线程：
 * ```
 * { type: 'RENDER_RESULT', requestId, imageBitmap | null, error? }
 * { type: 'RENDER_WORKER_READY' }
 * ```
 */

import type { PageDescriptor, LayoutConfig } from '../layout/types';
import type { RenderTheme, PaintOptions } from '../render/types';
import { paintPage } from '../render/PagePainter';

interface RenderRequest {
  type: 'RENDER';
  requestId: string;
  page: PageDescriptor;
  config: LayoutConfig;
  theme: RenderTheme;
  chapterTitle?: string;
  showHeaderFooter?: boolean;
  showProgressBar?: boolean;
}

interface RenderResponse {
  type: 'RENDER_RESULT';
  requestId: string;
  imageBitmap: ImageBitmap | null;
  error?: string;
}

type WorkerInMessage = RenderRequest;
type WorkerOutMessage = RenderResponse;

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'RENDER') {
    const {
      requestId,
      page,
      config,
      theme,
      chapterTitle,
      showHeaderFooter,
      showProgressBar,
    } = msg;

    try {
      // Create OffscreenCanvas
      const canvas = new OffscreenCanvas(config.pageWidth, config.pageHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get 2D context from OffscreenCanvas');
      }

      const paintOpts: PaintOptions = {
        page,
        config,
        theme,
        showHeaderFooter,
        chapterTitle,
        showProgressBar,
      };

      paintPage(ctx as unknown as CanvasRenderingContext2D, paintOpts);

      // Convert to ImageBitmap for transfer
      const imageBitmap = await createImageBitmap(canvas);

      const response: RenderResponse = {
        type: 'RENDER_RESULT',
        requestId,
        imageBitmap,
      };

      // Transfer the bitmap (zero-copy)
      self.postMessage(response, [imageBitmap]);
    } catch (error) {
      const response: RenderResponse = {
        type: 'RENDER_RESULT',
        requestId,
        imageBitmap: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      self.postMessage(response);
    }
  }
};

self.postMessage({ type: 'RENDER_WORKER_READY' });
