/**
 * TouchLayer — Transparent overlay that captures gestures.
 *
 * Sits on top of the CanvasViewport and intercepts all pointer events.
 * Uses useGestureDetector to recognize taps, swipes, and long presses.
 */

import React, { useRef, useCallback } from 'react';
import { useGestureDetector } from '../gestures/useGestureDetector';
import type { TapZone } from '../gestures/types';

interface TouchLayerProps {
  /** Called for zone taps */
  onTap?: (zone: TapZone) => void;
  /** Called for swipe gestures */
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void;
  /** Called for long press */
  onLongPress?: (zone: TapZone) => void;
  /** Whether gestures are enabled */
  enabled?: boolean;
  /**
   * 交互模式：
   * - 'paged'（默认）：翻页模式，阻止原生滚动，检测 tap/swipe
   * - 'scroll'：滚动模式，连续指针追踪，调用 onScrollMove/onScrollEnd
   */
  mode?: 'paged' | 'scroll';
  /** 滚动模式：拖动中持续回调 (deltaY 像素) */
  onScrollMove?: (deltaY: number) => void;
  /** 滚动模式：手指抬起时回调，传入速度 (px/ms) */
  onScrollEnd?: (velocityY: number) => void;
}

export const TouchLayer: React.FC<TouchLayerProps> = ({
  onTap,
  onSwipe,
  onLongPress,
  enabled = true,
  mode = 'paged',
  onScrollMove,
  onScrollEnd,
}) => {
  const layerRef = useRef<HTMLDivElement>(null);

  const handleTap = useCallback(
    (zone: TapZone) => {
      onTap?.(zone);
    },
    [onTap],
  );

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      onSwipe?.(direction);
    },
    [onSwipe],
  );

  const handleLongPress = useCallback(
    (zone: TapZone) => {
      onLongPress?.(zone);
    },
    [onLongPress],
  );

  const handleScrollMove = useCallback(
    (deltaY: number, _totalDeltaY: number) => {
      onScrollMove?.(deltaY);
    },
    [onScrollMove],
  );

  const handleScrollEnd = useCallback(
    (velocityY: number) => {
      onScrollEnd?.(velocityY);
    },
    [onScrollEnd],
  );

  useGestureDetector(layerRef, {
    onTap: handleTap,
    onSwipe: handleSwipe,
    onLongPress: handleLongPress,
    enabled,
    scrollMode: mode === 'scroll',
    onScrollMove: handleScrollMove,
    onScrollEnd: handleScrollEnd,
  });

  return (
    <div
      ref={layerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        // Transparent — passes visual through to canvas below
        background: 'transparent',
        // 全部使用 none：两种模式都完全由 Pointer Events 手动处理手势
        // pan-y 会导致浏览器在垂直滑动时接管触摸序列，中断 pointermove 事件
        touchAction: 'none',
      }}
    />
  );
};
