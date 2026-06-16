/**
 * TextMeasurer — 基于 Canvas 2D measureText API 的文本测量封装。
 *
 * ## 设计动机
 *
 * Canvas 的 measureText() 需要正确的 font 属性才能给出准确宽度。
 * 本模块维护一个离屏 canvas，确保：
 * 1. 测量操作不影响可见画布
 * 2. font 字符串缓存，避免每次测量都拼接字符串
 * 3. 统一的测量接口，方便后续替换测量策略（如使用字体度量表）
 *
 * ## 使用模式
 *
 * ```
 * const measurer = new TextMeasurer();
 * measurer.configure(config);           // 一次配置
 * const w = measurer.measureWidth('你好'); // 多次测量
 * const h = measurer.lineHeightPx;       // 获取行高
 * ```
 *
 * 所有测量结果单位为 CSS 像素（逻辑像素），非设备像素。
 * 排版引擎依赖这些测量值来确定每行能容纳的字符数。
 */
import type { LayoutConfig } from './types';

/**
 * 创建一个文本测量器，内部持有持久离屏 2D 上下文。
 *
 * 离屏 canvas 尺寸为 1×1 像素，创建开销极小（< 1ms），
 * 但足以支持所有 measureText 调用。
 */
export class TextMeasurer {
  /** 离屏测量用的 Canvas 2D 上下文 */
  private ctx: CanvasRenderingContext2D;
  /** 当前字号（CSS 像素） */
  private _fontSize: number = 16;
  /** 当前字体族字符串 */
  private _fontFamily: string = 'serif';
  /** 当前行高倍数 */
  private _lineHeight: number = 1.8;
  /** 缓存的完整 CSS font 字符串，避免每次测量都拼接 */
  private _fontString: string = '16px serif';

  constructor() {
    // 创建最小尺寸的离屏 canvas 用于文字测量
    // 1×1 像素足够 Canvas API 进行 measureText 调用
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法为 TextMeasurer 创建 2D 上下文');
    }
    this.ctx = ctx;
    this.updateFontString();
  }

  /**
   * 从 LayoutConfig 同步更新测量器配置。
   *
   * 此方法在排版本中每个新章节布局前调用，
   * 确保测量参数与实际渲染参数一致。
   */
  configure(config: LayoutConfig): void {
    this._fontSize = config.fontSize;
    this._fontFamily = config.fontFamily;
    this._lineHeight = config.lineHeight;
    this.updateFontString();
  }

  /**
   * 直接设置字号（CSS 像素）。
   * 变更后自动更新底层 Canvas 的 font 属性。
   */
  set fontSize(size: number) {
    this._fontSize = size;
    this.updateFontString();
  }

  get fontSize(): number {
    return this._fontSize;
  }

  /**
   * 直接设置字体族。
   * 变更后自动更新底层 Canvas 的 font 属性。
   */
  set fontFamily(family: string) {
    this._fontFamily = family;
    this.updateFontString();
  }

  get fontFamily(): string {
    return this._fontFamily;
  }

  /**
   * 设置行高倍数。
   * 1.0 = 单倍行距，1.8 = 舒适阅读，2.5 = 宽行距。
   * 不影响 Canvas font 属性（行高由排版引擎在 Y 坐标计算中使用）。
   */
  set lineHeight(lh: number) {
    this._lineHeight = lh;
  }

  get lineHeight(): number {
    return this._lineHeight;
  }

  /**
   * 更新缓存的 CSS font 字符串。
   *
   * Canvas 的 font 属性需要完整的 CSS font shorthand 字符串，
   * 格式：`"{size}px {family}"`。
   * 每次字号或字体变更时调用此方法重建缓存。
   */
  private updateFontString(): void {
    this._fontString = `${this._fontSize}px ${this._fontFamily}`;
  }

  /**
   * 获取当前的 CSS font 字符串，可用于直接设置 ctx.font。
   */
  get fontString(): string {
    return this._fontString;
  }

  /**
   * 测量文本的渲染宽度（CSS 像素）。
   *
   * 使用 Canvas 2D measureText API，返回当前字体配置下的实际宽度。
   * 空字符串返回 0。
   *
   * 注意：measureText 返回的是浏览器渲染引擎的预计算宽度，
   * 与实际绘制宽度一致；但若字体未加载完毕，可能不准确。
   * 生产环境中应在 FontFaceSet.ready 后使用。
   */
  measureWidth(text: string): number {
    if (!text) return 0;
    this.ctx.font = this._fontString;
    return this.ctx.measureText(text).width;
  }

  /**
   * 测量单个字符的宽度。
   * 等价于 measureWidth(c)，但语义更清晰。
   * 在断行循环中逐字符测量时调用。
   */
  measureChar(c: string): number {
    return this.measureWidth(c);
  }

  /**
   * 获取行高（CSS 像素）。
   *
   * 计算公式：fontSize × lineHeight。
   * 例如：fontSize=18, lineHeight=1.8 → 行高 = 32.4px。
   *
   * 排版引擎使用行高计算：
   * - 每行文本的 Y 偏移量
   * - 页面可容纳的行数
   * - 滚动模式下内容总高度
   */
  get lineHeightPx(): number {
    return this._fontSize * this._lineHeight;
  }

  /**
   * 获取 EM 单位大小（即当前字号）。
   *
   * 用于计算：
   * - 段落首行缩进（paragraphIndent × emSize）
   * - 其他以 em 为单位的排版参数
   */
  get emSize(): number {
    return this._fontSize;
  }

  /**
   * 批量测量多个字符串的宽度。
   *
   * 相比逐次调用 measureWidth，此方法只设置一次 font，
   * 在大批量测量时性能更优。
   */
  measureWidths(texts: string[]): number[] {
    this.ctx.font = this._fontString;
    return texts.map((t) => (t ? this.ctx.measureText(t).width : 0));
  }
}
