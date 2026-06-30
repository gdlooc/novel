/**
 * 设备像素比（DPR）工具函数。
 *
 * ## 核心概念
 *
 * DPR（Device Pixel Ratio）= 物理像素 / CSS 像素。
 * - DPR=1：传统桌面显示器（1 CSS像素 = 1 物理像素）
 * - DPR=2：Retina 屏（1 CSS像素 = 2×2=4 物理像素）
 * - DPR=3：高端手机（如 iPhone 14 Pro，1 CSS像素 = 9 物理像素）
 *
 * ## 为什么要限制 DPR 上限
 *
 * Canvas 的 backing store 尺寸 = CSS尺寸 × DPR。
 * 在 DPR=4 的 4K 手机上，全屏 canvas 可能占用 3840×2160×4bytes ≈ 33MB 纹理内存。
 * 将 DPR 上限限制为 3，在视觉质量可接受的前提下大幅降低内存占用。
 *
 * ## 使用场景
 *
 * - Canvas 物理尺寸计算：physicalPixels = cssPixels × DPR
 * - Canvas 上下文缩放：ctx.scale(dpr, dpr) 后使用 CSS 像素坐标系
 * - 字体渲染质量保证（低 DPR 下文字可能模糊）
 */

/**
 * 获取当前设备像素比，上限为 3。
 *
 * DPR > 3 的设备（如部分 4K 手机）被限制为 3，
 * 在高画质和低内存占用之间取得平衡。
 * 服务端渲染环境（无 window 对象）返回 1。
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
