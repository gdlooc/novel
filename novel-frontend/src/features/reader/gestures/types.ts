/**
 * 手势交互类型定义。
 *
 * 本模块定义了翻页模式和滚动模式共用的手势识别类型体系。
 * 支持点击（分区）、滑动（方向）、长按三种手势类型。
 *
 * ## 点击分区（Tap Zone）
 *
 * 阅读区域按宽度比例分为三个区域：
 * - **左区（left）**：默认 30% 宽度，翻页模式翻上一页，滚动模式上滚
 * - **中间（middle）**：默认 40% 宽度，切换顶/底栏显隐
 * - **右区（right）**：默认 30% 宽度，翻页模式翻下一页，滚动模式下滚
 *
 * ## 手势识别流程
 *
 * ```
 * pointerdown → 记录起始位置和时间 → 启动长按计时器
 *     │
 *     ├─ 移动超过 tapMaxMovement → 进入滑动检测
 *     │     │
 *     │     └─ pointerup → 判断位移和速度 → swipe 或 tap
 *     │
 *     └─ pointerup（未移动 or 小范围移动）
 *           ├─ 时长 < tapMaxDuration → tap
 *           └─ 时长 ≥ longPressDuration → long-press
 * ```
 *
 * ## 滚动模式特殊处理
 *
 * 滚动模式下：
 * - 垂直滑动（up/down）被拦截用于连续滚动，不触发 swipe 事件
 * - 水平滑动（left/right）仍正常触发 swipe 事件
 * - 长按仍触发（可用于文本选择等未来功能）
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
