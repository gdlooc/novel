/**
 * Render Web Worker — Offloads page rendering to an OffscreenCanvas if available.
 *
 * This worker creates an OffscreenCanvas, renders pages to it, and returns
 * ImageBitmap objects to the main thread for instant display.
 *
 * This is a progressive enhancement: if OffscreenCanvas is not supported,
 * the main thread falls back to direct Canvas rendering.
 *
 * Communication protocol:
 *   Main → Worker: { type: 'RENDER', requestId, pageDescriptor, config, theme, viewportState }
 *   Worker → Main: { type: 'RENDER_RESULT', requestId, imageBitmap }
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
