/**
 * 排版引擎子模块导出索引。
 *
 * 排版引擎是阅读器最核心的子系统，负责：
 * - 字符类型识别（CJK/拉丁/标点）
 * - CJK 禁则断行
 * - 段落检测与标题/分隔符识别
 * - 滑动窗口懒分页
 * - Canvas 文本测量
 */

export { TextLayoutEngine, hashLayoutConfig } from './TextLayoutEngine';
export { TextMeasurer } from './TextMeasurer';
export { Paginator } from './Paginator';
export {
  breakTextIntoLines,
  detectParagraphs,
  applyKinsoku,
} from './LineBreaker';
export {
  isCJK,
  isLatin,
  isSpace,
  isProhibitedLineStart,
  isProhibitedLineEnd,
  canBreakAfter,
  canStartLine,
  getCharType,
} from './CjkPunctuation';
export type { CharType } from './CjkPunctuation';
export type { LineBreakOptions } from './LineBreaker';
export type {
  TextLine,
  PageDescriptor,
  LayoutConfig,
  LayoutResult,
  ParagraphInfo,
  LayoutRequest,
  LayoutResponse,
  LayoutCancelRequest,
  WorkerInMessage,
  WorkerOutMessage,
} from './types';
