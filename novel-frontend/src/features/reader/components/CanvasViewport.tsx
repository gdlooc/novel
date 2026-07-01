/**
 * CanvasViewport — Canvas 元素容器。
 *
 * 管理 Canvas 元素生命周期：创建、尺寸同步、DPR 缩放。
 * 通过 forwardRef 向父组件暴露 canvas 引用和当前尺寸。
 */
import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
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

    // 同步 Canvas 物理像素尺寸
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

    useImperativeHandle(ref, () => ({
      canvas: canvasRef.current,
      dimensions,
    }), [dimensions]);

    return (
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ touchAction: 'none' }}
        />
      </div>
    );
  },
);
