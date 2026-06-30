/**
 * useGestureDetector — Custom hook for pointer-based gesture detection.
 *
 * Uses Pointer Events for cross-device compatibility (touch, mouse, pen).
 * Recognizes:
 * - Tap (left/right/middle zones)
 * - Swipe (left/right/up/down)
 * - Long press
 */

import { useRef, useCallback, useEffect } from 'react';
import type {
  GestureEvent,
  GestureConfig,
  TapZone,
} from './types';
import { DEFAULT_GESTURE_CONFIG } from './types';

interface UseGestureDetectorOptions {
  /** Configuration overrides */
  config?: Partial<GestureConfig>;
  /** Called when a gesture is recognized */
  onGesture?: (event: GestureEvent) => void;
  /** Called for a simple tap */
  onTap?: (zone: TapZone) => void;
  /** Called for a swipe */
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void;
  /** Called for a long press */
  onLongPress?: (zone: TapZone) => void;
  /** Whether gesture detection is active */
  enabled?: boolean;
  /** 滚动模式 */
  scrollMode?: boolean;
  /** 滚动模式：拖动中持续回调 */
  onScrollMove?: (deltaY: number, totalDeltaY: number) => void;
  /** 滚动模式：手指抬起时回调 */
  onScrollEnd?: (velocityY: number) => void;
}

export function useGestureDetector(
  elementRef: React.RefObject<HTMLElement | null>,
  options: UseGestureDetectorOptions = {},
): void {
  const {
    config = {},
    onGesture,
    onTap,
    onSwipe,
    onLongPress,
    enabled = true,
    scrollMode = false,
    onScrollMove,
    onScrollEnd,
  } = options;

  const cfg: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, ...config };

  const pointerRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastY: number;
    pointerId: number;
    isTracking: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    hasMoved: boolean;
  }>({
    startX: 0, startY: 0, startTime: 0, lastX: 0, lastY: 0,
    pointerId: -1, isTracking: false, longPressTimer: null, hasMoved: false,
  });

  const onGestureRef = useRef(onGesture); onGestureRef.current = onGesture;
  const onTapRef = useRef(onTap); onTapRef.current = onTap;
  const onSwipeRef = useRef(onSwipe); onSwipeRef.current = onSwipe;
  const onLongPressRef = useRef(onLongPress); onLongPressRef.current = onLongPress;
  const onScrollMoveRef = useRef(onScrollMove); onScrollMoveRef.current = onScrollMove;
  const onScrollEndRef = useRef(onScrollEnd); onScrollEndRef.current = onScrollEnd;

  const getZone = useCallback(
    (x: number, width: number): TapZone => {
      const leftWidth = width * cfg.leftZoneWidth;
      const rightWidth = width * cfg.rightZoneWidth;
      if (x < leftWidth) return 'left';
      if (x > width - rightWidth) return 'right';
      return 'middle';
    },
    [cfg.leftZoneWidth, cfg.rightZoneWidth],
  );

  const clearLongPress = useCallback(() => {
    if (pointerRef.current.longPressTimer) {
      clearTimeout(pointerRef.current.longPressTimer);
      pointerRef.current.longPressTimer = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!enabled) return;
      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointerRef.current = {
        startX: x, startY: y, lastX: x, lastY: y,
        startTime: Date.now(), pointerId: e.pointerId,
        isTracking: true, longPressTimer: null, hasMoved: false,
      };
      const zone = getZone(x, el.clientWidth);
      pointerRef.current.longPressTimer = setTimeout(() => {
        if (!pointerRef.current.hasMoved) {
          const gesture: GestureEvent = {
            type: 'long-press', zone,
            startX: pointerRef.current.startX, startY: pointerRef.current.startY,
            endX: pointerRef.current.lastX, endY: pointerRef.current.lastY,
            velocityX: 0, velocityY: 0,
            duration: Date.now() - pointerRef.current.startTime,
          };
          onGestureRef.current?.(gesture);
          onLongPressRef.current?.(zone);
        }
        pointerRef.current.longPressTimer = null;
      }, cfg.longPressDuration);
    },
    [enabled, elementRef, getZone, cfg.longPressDuration],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const p = pointerRef.current;
      if (!p.isTracking || e.pointerId !== p.pointerId) return;
      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (scrollMode && onScrollMoveRef.current) {
        const deltaY = p.lastY - y;
        const totalDeltaY = p.startY - y;
        onScrollMoveRef.current(deltaY, totalDeltaY);
      }

      const dx = Math.abs(x - p.startX);
      const dy = Math.abs(y - p.startY);
      if (dx > cfg.tapMaxMovement || dy > cfg.tapMaxMovement) {
        p.hasMoved = true;
        clearLongPress();
      }
      p.lastX = x;
      p.lastY = y;
    },
    [elementRef, cfg.tapMaxMovement, clearLongPress, scrollMode],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const p = pointerRef.current;
      if (!p.isTracking || e.pointerId !== p.pointerId) return;
      p.isTracking = false;
      clearLongPress();

      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;
      const duration = Date.now() - p.startTime;
      const dx = endX - p.startX;
      const dy = endY - p.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const velocityX = duration > 0 ? Math.abs(dx) / duration : 0;
      const velocityY = duration > 0 ? Math.abs(dy) / duration : 0;
      const zone = getZone(p.startX, el.clientWidth);

      if (scrollMode && onScrollEndRef.current && p.hasMoved) {
        const vy = duration > 0 ? -(dy) / duration : 0;
        onScrollEndRef.current(vy);
      }

      if (
        (absDx > cfg.swipeMinDistance || absDy > cfg.swipeMinDistance) &&
        (velocityX > cfg.swipeMinVelocity || velocityY > cfg.swipeMinVelocity)
      ) {
        let direction: 'left' | 'right' | 'up' | 'down';
        if (absDx > absDy) { direction = dx > 0 ? 'right' : 'left'; }
        else { direction = dy > 0 ? 'down' : 'up'; }

        if (scrollMode && (direction === 'up' || direction === 'down')) return;

        const type = direction === 'left' ? 'swipe-left'
          : direction === 'right' ? 'swipe-right'
          : direction === 'up' ? 'swipe-up' : 'swipe-down';

        const gesture: GestureEvent = {
          type, zone,
          startX: p.startX, startY: p.startY,
          endX, endY, velocityX, velocityY, duration,
        };
        onGestureRef.current?.(gesture);
        onSwipeRef.current?.(direction);
        return;
      }

      if (duration < cfg.tapMaxDuration && absDx < cfg.tapMaxMovement && absDy < cfg.tapMaxMovement) {
        const type = zone === 'left' ? 'tap-left'
          : zone === 'right' ? 'tap-right' : 'tap-middle';
        const gesture: GestureEvent = {
          type, zone,
          startX: p.startX, startY: p.startY,
          endX, endY, velocityX: 0, velocityY: 0, duration,
        };
        onGestureRef.current?.(gesture);
        onTapRef.current?.(zone);
      }
    },
    [elementRef, getZone, cfg.swipeMinDistance, cfg.swipeMinVelocity, cfg.tapMaxDuration, cfg.tapMaxMovement, clearLongPress],
  );

  const handlePointerCancel = useCallback(() => {
    pointerRef.current.isTracking = false;
    clearLongPress();
  }, [clearLongPress]);

  useEffect(() => {
    const el = elementRef.current;
    if (!el || !enabled) return;

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerCancel);
    el.addEventListener('pointerleave', handlePointerCancel);

    if (!scrollMode) {
      const preventTouch = (e: TouchEvent) => {
        if (e.target === el || el.contains(e.target as Node)) e.preventDefault();
      };
      el.addEventListener('touchstart', preventTouch, { passive: false });
      return () => {
        el.removeEventListener('pointerdown', handlePointerDown);
        el.removeEventListener('pointermove', handlePointerMove);
        el.removeEventListener('pointerup', handlePointerUp);
        el.removeEventListener('pointercancel', handlePointerCancel);
        el.removeEventListener('pointerleave', handlePointerCancel);
        el.removeEventListener('touchstart', preventTouch);
      };
    }

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerCancel);
      el.removeEventListener('pointerleave', handlePointerCancel);
    };
  }, [elementRef, enabled, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel]);
}