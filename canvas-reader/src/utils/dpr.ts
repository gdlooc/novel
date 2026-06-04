/**
 * Device pixel ratio utilities.
 */

/**
 * Get the current device pixel ratio, capped at 3 to limit memory usage
 * on very high-DPI devices (4K+ phones).
 */
export function getDPR(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 3);
}

/**
 * Calculate the physical pixel dimensions for a canvas element.
 */
export function getPhysicalSize(
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number } {
  const dpr = getDPR();
  return {
    width: Math.round(cssWidth * dpr),
    height: Math.round(cssHeight * dpr),
  };
}

/**
 * Get a CSS pixel value from a physical pixel value.
 */
export function toCssPixels(physicalPixels: number): number {
  return physicalPixels / getDPR();
}
