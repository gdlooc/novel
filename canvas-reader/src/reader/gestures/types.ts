/**
 * Gesture types for touch/pointer interaction.
 */

/** Tap zones on the reading surface */
export type TapZone = 'left' | 'right' | 'middle';

/** Recognized gesture types */
export type GestureType =
  | 'tap'
  | 'tap-left'
  | 'tap-right'
  | 'tap-middle'
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down'
  | 'long-press';

/** Result of gesture detection */
export interface GestureEvent {
  type: GestureType;
  /** Zone where the gesture started */
  zone: TapZone;
  /** CSS pixel position of the gesture start */
  startX: number;
  startY: number;
  /** CSS pixel position of the gesture end */
  endX: number;
  endY: number;
  /** Velocity in px/ms */
  velocityX: number;
  velocityY: number;
  /** Duration in ms */
  duration: number;
}

/** Configuration for gesture detection */
export interface GestureConfig {
  /** Tap zones: percentage of viewport width for left/middle/right */
  leftZoneWidth: number; // fraction, default 0.30
  rightZoneWidth: number; // fraction, default 0.30
  middleZoneWidth: number; // fraction, default 0.40 (remaining)

  /** Minimum swipe distance in CSS pixels */
  swipeMinDistance: number; // default 30
  /** Minimum swipe velocity in px/ms */
  swipeMinVelocity: number; // default 0.3
  /** Maximum tap duration in ms */
  tapMaxDuration: number; // default 300
  /** Maximum tap movement in CSS pixels */
  tapMaxMovement: number; // default 10
  /** Long press duration in ms */
  longPressDuration: number; // default 600
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  leftZoneWidth: 0.30,
  rightZoneWidth: 0.30,
  middleZoneWidth: 0.40,
  swipeMinDistance: 30,
  swipeMinVelocity: 0.3,
  tapMaxDuration: 300,
  tapMaxMovement: 10,
  longPressDuration: 600,
};
