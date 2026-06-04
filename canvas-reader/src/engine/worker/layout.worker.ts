/**
 * Layout Web Worker — Offloads text layout computation from the main thread.
 *
 * Receives text + config via postMessage, returns PageDescriptor[].
 * Uses the TextLayoutEngine internally to perform line breaking and pagination.
 *
 * Communication protocol:
 *   Main → Worker: { type: 'LAYOUT', requestId, chapterId, text, config, startPageIndex, maxPages, startCharOffset }
 *   Worker → Main: { type: 'LAYOUT_RESULT', requestId, chapterId, result: LayoutResult }
 *   Main → Worker: { type: 'CANCEL', requestId }
 */

import { TextLayoutEngine } from '../layout/TextLayoutEngine';
import type {
  LayoutRequest,
  LayoutResponse,
  WorkerInMessage,
} from '../layout/types';

// Create a single engine instance for the worker's lifetime
const engine = new TextLayoutEngine();

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'LAYOUT': {
      handleLayout(msg);
      break;
    }
    case 'CANCEL': {
      // Cancel is handled by checking requestId in the response
      // (the main thread can ignore stale responses)
      break;
    }
    default:
      console.warn('[LayoutWorker] Unknown message type:', (msg as any).type);
  }
};

function handleLayout(msg: LayoutRequest): void {
  const {
    requestId,
    chapterId,
    text,
    config,
    startPageIndex,
    maxPages,
    startCharOffset,
  } = msg;

  try {
    const result = engine.layout(chapterId, text, config, {
      startPageIndex,
      maxPages,
      startCharOffset,
    });

    const response: LayoutResponse = {
      type: 'LAYOUT_RESULT',
      requestId,
      chapterId,
      result,
    };

    self.postMessage(response);
  } catch (error) {
    // Send error back as a layout result with empty pages
    console.error('[LayoutWorker] Layout error:', error);
    const response: LayoutResponse = {
      type: 'LAYOUT_RESULT',
      requestId,
      chapterId,
      result: {
        pages: [],
        configHash: '',
        totalPagesKnown: 0,
        hasMore: false,
      },
    };
    self.postMessage(response);
  }
}

// Tell the main thread we're ready
self.postMessage({ type: 'WORKER_READY' });
