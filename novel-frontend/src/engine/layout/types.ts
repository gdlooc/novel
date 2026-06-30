/**
 * 文本排版引擎核心类型定义。
 *
 * 这些类型是整个阅读器的基础数据结构，被用于：
 * - 主线程排版计算
 * - Web Worker 通信协议
 * - Canvas 渲染管线
 * - 页面缓存序列化
 *
 * 设计原则：
 * - 框架无关（不依赖 React、Zustand 等）
 * - 纯数据描述，不含渲染逻辑
 * - 所有尺寸单位为 CSS 像素（逻辑像素），非设备像素
 */

// ═══════════════════════════════════════════════════════════════════════════
// 文本行
// ═══════════════════════════════════════════════════════════════════════════

/** 单行排版后的文本行 */
export interface TextLine {
  /** 本行的文本内容（不含换行符） */
  text: string;
  /**
   * 相对于内容区域左边缘的 X 偏移量（CSS 像素）。
   * 居中标题会有正值偏移；普通段落为 0（靠左）。
   */
  x: number;
  /** 相对于页面顶部的 Y 位置（CSS 像素） */
  y: number;
  /** 本行实际渲染宽度（CSS 像素），用于居中计算 */
  width: number;
  /**
   * 本行在源文本中的字符范围 [start, end)。
   * - start: 源文本中此行的起始字符索引（含）
   * - end: 源文本中此行的结束字符索引（不含）
   * 用于定位阅读位置（charOffset），实现字号变化后恢复位置。
   */
  charRange: [number, number];
  /** 是否为新段落的起始行 */
  isParagraphStart: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 图片块
// ═══════════════════════════════════════════════════════════════════════════

/** 章节插图描述 */
export interface ImageBlock {
  /** 图片 URL（经过代理的可访问路径） */
  url: string;
  /** 图片说明文字（alt text，可选） */
  caption?: string;
  /** 在页面上的 X 位置（CSS 像素） */
  x: number;
  /** 在页面上的 Y 位置（CSS 像素） */
  y: number;
  /** 显示宽度（CSS 像素），受限于内容区宽度 */
  width: number;
  /** 显示高度（CSS 像素），按原始比例缩放 */
  height: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 页面
// ═══════════════════════════════════════════════════════════════════════════

/** 完整的一个页面描述 */
export interface PageDescriptor {
  /** 章节内 0-based 页码索引 */
  pageIndex: number;
  /** 所属章节标识符 */
  chapterId: string;
  /** 本页包含的已排版文本行 */
  lines: TextLine[];
  /** 本页起始字符在源文本中的偏移量（含） */
  charStart: number;
  /** 本页结束字符在源文本中的偏移量（不含） */
  charEnd: number;
  /** 是否为章节首页 */
  isFirstPage: boolean;
  /** 是否为章节末页 */
  isLastPage: boolean;
  /**
   * 当前已知的章节总页数。
   * -1 表示尚未排版到章节末尾，总页数未知。
   */
  totalPagesKnown: number;
  /**
   * 章节插图（可选）。
   * 仅章节首页可能有值，排版引擎按图片数量预留空间。
   */
  images?: ImageBlock[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 排版配置
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 排版配置 — 任何字段变化都会触发重排版（re-layout）。
 *
 * 配置变更时通过 `hashLayoutConfig()` 生成哈希值来检测，
 * 哈希不同 → 清空所有页面缓存 → 重新计算布局。
 */
export interface LayoutConfig {
  /** 页面内容区域宽度（CSS 像素），通常 = 视口宽度 */
  pageWidth: number;
  /** 页面内容区域高度（CSS 像素），通常 = 视口高度 */
  pageHeight: number;
  /** 字号（CSS 像素） */
  fontSize: number;
  /**
   * 字体族字符串，直接传给 Canvas ctx.font。
   * 示例：`'"Noto Serif CJK SC", "Source Han Serif SC", serif'`
   */
  fontFamily: string;
  /**
   * 行高倍数（1.0 = 单倍行距，2.0 = 双倍行距）。
   * 实际行高 = fontSize × lineHeight。
   */
  lineHeight: number;
  /** 上边距（CSS 像素），内容区域顶部留白 */
  paddingTop: number;
  /** 下边距（CSS 像素），内容区域底部留白 */
  paddingBottom: number;
  /** 左边距（CSS 像素），文字起始 X 偏移 */
  paddingLeft: number;
  /** 右边距（CSS 像素），文字最大 X 边界 */
  paddingRight: number;
  /**
   * 段落首行缩进（em 单位）。
   * 2 表示缩进 2 个字符宽度（对于 CJK 等宽字体 ≈ 2 × fontSize）。
   */
  paragraphIndent: number;
  /**
   * 段落间距（CSS 像素）。
   * 在段尾行和下一段首行之间插入的额外间距。
   */
  paragraphSpacing: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 排版结果
// ═══════════════════════════════════════════════════════════════════════════

/** 排版引擎返回的排版结果 */
export interface LayoutResult {
  /** 计算出的页面数组（滑动窗口，非全量） */
  pages: PageDescriptor[];
  /** 本次排版使用的配置哈希值，用于缓存校验 */
  configHash: string;
  /** 当前已知的总页数（-1 表示尚未触达末尾） */
  totalPagesKnown: number;
  /** 是否还有更多页面可以计算（true = 尚未到达章节末尾） */
  hasMore: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 段落信息
// ═══════════════════════════════════════════════════════════════════════════

/** 段落级别信息，用于断行时的排版决策（居中/缩进/分隔） */
export interface ParagraphInfo {
  /** 段落起始字符在源文本中的索引 */
  startIndex: number;
  /** 段落结束字符在源文本中的索引（不含） */
  endIndex: number;
  /** 是否为标题/章节名（如 "第X章"、"序章"、"尾声"） */
  isHeading: boolean;
  /** 是否为场景分隔符（如 "***" 或 "※ ※ ※"） */
  isSeparator: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker 通信协议类型
// ═══════════════════════════════════════════════════════════════════════════

/** 发送给排版 Worker 的排版请求 */
export interface LayoutRequest {
  /** 消息类型标识 */
  type: 'LAYOUT';
  /** 请求唯一 ID，用于匹配请求与响应 */
  requestId: string;
  /** 要排版的章节标识符 */
  chapterId: string;
  /** 章节原始文本内容 */
  text: string;
  /** 排版配置参数 */
  config: LayoutConfig;
  /** 起始页码（0-based） */
  startPageIndex: number;
  /** 本次批量计算的最大页数（滑动窗口大小） */
  maxPages: number;
  /** 起始字符偏移量（0 = 从头开始排版） */
  startCharOffset: number;
}

/** Worker 返回的排版结果 */
export interface LayoutResponse {
  /** 消息类型标识 */
  type: 'LAYOUT_RESULT';
  /** 对应的请求 ID */
  requestId: string;
  /** 章节标识符 */
  chapterId: string;
  /** 排版结果数据 */
  result: LayoutResult;
}

/** 取消正在进行的排版任务 */
export interface LayoutCancelRequest {
  type: 'CANCEL';
  /** 要取消的请求 ID */
  requestId: string;
}

/** Worker 接收的所有消息类型联合 */
export type WorkerInMessage = LayoutRequest | LayoutCancelRequest;
/** Worker 发出的所有消息类型联合 */
export type WorkerOutMessage = LayoutResponse;
