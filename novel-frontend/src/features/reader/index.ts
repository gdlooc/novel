/**
 * 阅读器 UI 层导出索引。
 *
 * 阅读器层是 React 特定的，依赖 Zustand stores 和引擎层。
 * 负责：
 * - 阅读器外壳布局（ReaderShell）
 * - Canvas 视口管理（CanvasViewport）
 * - 触摸手势（TouchLayer + useGestureDetector）
 * - 阅读流程控制（useReader）
 * - 翻页状态机（usePageTurn）
 * - 键盘快捷键（useKeyboardNav）
 */

export { ReaderShell } from './components/ReaderShell';
export { CanvasViewport } from './components/CanvasViewport';
export { TouchLayer } from './components/TouchLayer';
export { TopBar } from './components/TopBar';
export { BottomBar } from './components/BottomBar';
export { SettingsPanel } from './components/SettingsPanel';
export { TocPanel } from './components/TocPanel';
export { useReader } from './hooks/useReader';
export { useCanvasResize } from './hooks/useCanvasResize';
export { usePageTurn } from './hooks/usePageTurn';
export { useKeyboardNav } from './hooks/useKeyboardNav';
export { useGestureDetector } from './gestures/useGestureDetector';
export type { CanvasViewportHandle } from './components/CanvasViewport';
export type { CanvasDimensions } from './hooks/useCanvasResize';
export type { PageTurnResult } from './hooks/usePageTurn';
export type { TapZone, GestureEvent, GestureConfig, GestureType } from './gestures/types';
