/**
 * useCanvasResize — Manages canvas sizing and DPR handling.
 *
 * Observes the canvas container element for size changes using
 * ResizeObserver. Updates the canvas backing store dimensions
 * and returns the current CSS/physical dimensions.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { getDPR } from '@/utils/dpr';

export interface CanvasDimensions {
  cssWidth: number;
  cssHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  dpr: number;
}

interface UseCanvasResizeOptions {
  /** Callback fired when dimensions change */
  onResize?: (dims: CanvasDimensions) => void;
  /** Whether to observe the container (true) or window (false) */
  observeContainer?: boolean;
}

export function useCanvasResize(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseCanvasResizeOptions = {},
): CanvasDimensions {
  const { onResize } = options;
  const [dimensions, setDimensions] = useState<CanvasDimensions>({
    cssWidth: 0,
    cssHeight: 0,
    physicalWidth: 0,
    physicalHeight: 0,
    dpr: getDPR(),
  });
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const updateDimensions = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const dpr = getDPR();
    const cssWidth = el.clientWidth;
    const cssHeight = el.clientHeight;

    if (cssWidth === 0 || cssHeight === 0) return;

    const newDims: CanvasDimensions = {
      cssWidth,
      cssHeight,
      physicalWidth: Math.round(cssWidth * dpr),
      physicalHeight: Math.round(cssHeight * dpr),
      dpr,
    };

    setDimensions((prev) => {
      if (
        prev.cssWidth === newDims.cssWidth &&
        prev.cssHeight === newDims.cssHeight &&
        prev.dpr === newDims.dpr
      ) {
        return prev; // No change
      }
      return newDims;
    });

    onResizeRef.current?.(newDims);
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Initial measurement
    updateDimensions();

    // Observe container size changes
    const observer = new ResizeObserver(() => {
      updateDimensions();
    });
    observer.observe(el);

    // Also listen for DPR changes (e.g., moving window between monitors)
    const mediaQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const onDPRChange = () => updateDimensions();
    mediaQuery.addEventListener('change', onDPRChange);

    // Orientation changes on mobile
    const onOrientationChange = () => {
      // Delay slightly for the layout to settle
      setTimeout(updateDimensions, 100);
    };
    window.addEventListener('orientationchange', onOrientationChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', onDPRChange);
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, [containerRef, updateDimensions]);

  return dimensions;
}