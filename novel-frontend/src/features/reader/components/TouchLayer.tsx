/**
 * TouchLayer — Transparent overlay that captures gestures.
 */

import React, { useRef, useCallback } from 'react';
import { useGestureDetector } from '../gestures/useGestureDetector';
import type { TapZone } from '../gestures/types';

interface TouchLayerProps {
  onTap?: (zone: TapZone) => void;
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void;
  onLongPress?: (zone: TapZone) => void;
  enabled?: boolean;
  mode?: 'paged' | 'scroll';
  onScrollMove?: (deltaY: number) => void;
  onScrollEnd?: (velocityY: number) => void;
}

export const TouchLayer: React.FC<TouchLayerProps> = ({
  onTap, onSwipe, onLongPress, enabled = true, mode = 'paged',
  onScrollMove, onScrollEnd,
}) => {
  const layerRef = useRef<HTMLDivElement>(null);

  const handleTap = useCallback((zone: TapZone) => { onTap?.(zone); }, [onTap]);
  const handleSwipe = useCallback((direction: 'left' | 'right' | 'up' | 'down') => { onSwipe?.(direction); }, [onSwipe]);
  const handleLongPress = useCallback((zone: TapZone) => { onLongPress?.(zone); }, [onLongPress]);
  const handleScrollMove = useCallback((deltaY: number, _totalDeltaY: number) => { onScrollMove?.(deltaY); }, [onScrollMove]);
  const handleScrollEnd = useCallback((velocityY: number) => { onScrollEnd?.(velocityY); }, [onScrollEnd]);

  useGestureDetector(layerRef, {
    onTap: handleTap, onSwipe: handleSwipe, onLongPress: handleLongPress,
    enabled, scrollMode: mode === 'scroll',
    onScrollMove: handleScrollMove, onScrollEnd: handleScrollEnd,
  });

  return (
    <div ref={layerRef} style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 10, background: 'transparent', touchAction: 'none',
    }} />
  );
};