/**
 * CanvasViewport — The canvas element that displays pages.
 *
 * Owns the <canvas> element lifecycle:
 * - Creates and sizes the canvas
 * - Exposes the canvas ref for the renderer
 * - Handles DPR scaling
 * - Reports dimensions for layout
 */

import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useCanvasResize } from '../hooks/useCanvasResize';
import type { CanvasDimensions } from '../hooks/useCanvasResize';

export interface CanvasViewportHandle {
  canvas: HTMLCanvasElement | null;
  dimensions: CanvasDimensions;
}

interface CanvasViewportProps {
  onDimensionsChange?: (dims: CanvasDimensions) => void;
}

export const CanvasViewport = forwardRef<CanvasViewportHandle, CanvasViewportProps>(
  function CanvasViewport({ onDimensionsChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const dimensions = useCanvasResize(containerRef, {
      onResize: onDimensionsChange,
    });

    // Sync canvas backing store size with dimensions
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (
        canvas.width !== dimensions.physicalWidth ||
        canvas.height !== dimensions.physicalHeight
      ) {
        canvas.width = dimensions.physicalWidth;
        canvas.height = dimensions.physicalHeight;
      }
    }, [dimensions]);

    // Expose canvas and dimensions to parent
    useImperativeHandle(
      ref,
      () => ({
        canvas: canvasRef.current,
        dimensions,
      }),
      [dimensions],
    );

    return (
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            // Prevent any browser touch actions on the canvas itself
            touchAction: 'none',
          }}
        />
      </div>
    );
  },
);
