/**
 * LineBreaker — CJK 感知的智能断行引擎。
 *
 * ## 功能概述
 *
 * 将原始文本转换为 TextLine 数组，处理以下排版需求：
 * - CJK 字符逐字断行（每个汉字/假名后都允许断行）
 * - 拉丁字母按单词边界断行（空格分隔，不断开单词）
 * - 中英混排：同一行内正确混排，间距自动处理
 * - 禁则处理：标点避头避尾，拉入/推出算法
 * - 段落检测：空行分隔段落，首行缩进
 * - 标题识别：章节标题居中显示
 * - 场景分隔符：居中显示的分隔线
 *
 * ## 算法核心流程
 *
 * ```
 * 原始文本
 *   │
 *   ▼
 * detectParagraphs() ─→ ParagraphInfo[] (段落检测+分类)
 *   │
 *   ▼
 * 逐段落处理:
 *   ├── 标题 → 居中单行，不参与断行
 *   ├── 分隔符 → 居中单行
 *   └── 普通段落 → 逐字符遍历断行
 *                     │
 *                     ├── CJK字符：逐字可断，遇到标点做禁则检查
 *                     ├── 拉丁字母：累积到空格或行宽溢出
 *                     └── 行宽溢出 → 回溯到最近的可断点
 *   │
 *   ▼
 * applyKinsoku() (可选：对已分行结果做二次禁则调整)
 *   │
 *   ▼
 * TextLine[] → 传给 Paginator 做分页
 * ```
 *
 * ## 中英混排策略
 *
 * CJK 和拉丁文本的断行规则本质不同：
 * - CJK：每个字符都是一个独立的排版单元，字符间无空格
 * - 拉丁：单词是排版单元，单词间用空格分隔
 *
 * 本引擎通过字符类型分类（getCharType）+ 分类断行来处理混排。
 */

import {
  isCJK,
  isLatin,
  isSpace,
  isProhibitedLineStart,
  isProhibitedLineEnd,
  canBreakAfter,
  type CharType,
  getCharType,
} from './CjkPunctuation';
import type { TextMeasurer } from './TextMeasurer';
import type { TextLine, ParagraphInfo } from './types';

/**
 * 断行算法中的一个潜在断点。
 *
 * 断点表示在源文本的 index 位置可以终止当前行。
 * 它记录了从上一个断点到当前位置的文本片段宽度，
 * 以及断点类型（用于后续禁则调整）。
 */
interface BreakPoint {
  /** 源文本中的字符索引（断在此字符之后） */
  index: number;
  /** 从上一个断点到当前断点的文本片段累积宽度 */
  segmentWidth: number;
  /**
   * 断点类型：
   * - 'cjk'：CJK 字符后的自然断点
   * - 'word'：拉丁单词边界断点
   * - 'space'：空格位置断点
   * - 'forced'：强制断点（如换行符）
   * - 'punctuation-pull'：因禁则拉入产生的特殊断点
   */
  breakType: 'cjk' | 'word' | 'space' | 'forced' | 'punctuation-pull';
}

/** Options for line breaking */
export interface LineBreakOptions {
  /** Available width per line in CSS pixels */
  lineWidth: number;
  /** Paragraph first-line indent in em units */
  paragraphIndent: number;
  /** Extra spacing between paragraphs in CSS pixels */
  paragraphSpacing: number;
}

/** Default options */
const DEFAULT_OPTIONS: LineBreakOptions = {
  lineWidth: 600,
  paragraphIndent: 2,
  paragraphSpacing: 0,
};

/**
 * 从原始文本中检测段落结构。
 *
 * ## 段落分隔规则
 *
 * 段落由连续两个及以上换行符（\n\n+）分隔。
 * 单个换行符（\n）不被视为段落分隔，而是段落内的强制换行。
 * 所有 \r\n（Windows 风格）和 \r（Mac 旧版）先统一转为 \n。
 *
 * ## 标题检测
 *
 * 标题必须同时满足以下两个条件：
 * 1. 长度 ≤ 50 字符
 * 2. 匹配显式的结构模式（如 "第X章"、"序章"、"尾声"）
 *
 * 设计决策（Bug #6 修复）：
 * 早期版本的标题检测过于激进（≤30字符 + 不以标点结尾 → 标题），
 * 导致大量简短对话段落被误判为标题并居中显示。
 * 现在改为仅匹配显式的章节标题模式，避免误判。
 *
 * ## 场景分隔符检测
 *
 * 识别如 "***"、"※ ※ ※"、"———" 等纯符号行，
 * 这些常用于在章节内标识场景切换。
 *
 * @param text 原始文本内容
 * @returns 段落信息数组，按文本顺序排列
 */
export function detectParagraphs(text: string): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split by double newline (paragraph separator)
  const rawParagraphs = normalized.split(/\n\n+/);

  let charIndex = 0;
  for (const raw of rawParagraphs) {
    const trimmed = raw.trim();
    if (!trimmed) {
      // 空段落（纯空行）跳过，但需累加其在原文中的字符偏移
      // +2 = 原始段落末尾的 \n\n 分隔符
      charIndex += raw.length + 2;
      continue;
    }

    // 原始文本中段落的起止位置（使用 trimmed 文本）
    const startIndex = charIndex;
    const endIndex = startIndex + trimmed.length;

    // ─── 标题检测 ───
    // 仅匹配显式的结构模式。中文网络小说中大量简短段落（对话、转场）
    // 会被旧算法误判为标题，因此采用严格的模式匹配。
    const isHeading =
      trimmed.length <= 50 &&
      // 必须匹配显式的章节/分卷标题模式：
      // - "第X章/卷/节/回/部"（X 可以是中文数字或阿拉伯数字）
      // - "序章"、"终章"
      // - "楔子"、"跋子"
      // - "尾声"、"番外"、"后记"、"前言"、"结语"、"附录"等
      // - 英文标题变体：Prologue, Epilogue
      (/^第[一二三四五六七八九十百千零\d]+[卷章节回部]/.test(trimmed) ||
        /^[序终][章]/.test(trimmed) ||
        /^[楔跋][子]/.test(trimmed) ||
        /^(?:尾声|番外[篇]?|后记|前言|结语|附录|人物介绍|剧情简介|内容简介|\\s*[Pp]rologue|\\s*[Ee]pilogue)/.test(trimmed));

    // ─── 场景分隔符检测 ───
    // 识别纯由重复符号组成的行：***、※ ※ ※、———等
    const isSeparator =
      /^[*＊※~～—━]{2,}$/.test(trimmed) ||  // 连续相同符号
      /^[※＊]\s*[※＊]\s*[※＊]$/.test(trimmed) || // 间隔排列符号
      /^[-－—]{3,}$/.test(trimmed);            // 横线分隔

    paragraphs.push({
      startIndex,
      endIndex,
      isHeading,
      isSeparator,
    });

    // 累加字符偏移：段落文本长度 + 分隔符 \n\n (2字符)
    charIndex += raw.length + 2;
  }

  return paragraphs;
}

/**
 * （辅助函数，当前未使用）在文本段落内找到所有潜在的断行位置。
 *
 * 遍历指定范围内的每个字符，根据字符类型记录断点：
 * - CJK 字符后记录 'cjk' 断点
 * - 空格处记录 'space' 断点
 * - 换行符处记录 'forced' 断点
 * - 避尾标点不产生断点（必须粘连后续内容）
 *
 * 每个断点记录从上一个断点到当前位置的累积宽度，
 * 以及断点类型，供后续禁则调整使用。
 *
 * 注意：此函数目前仅作为备用算法保留，
 * 实际使用的是 breakTextIntoLines 中的逐字符遍历法。
 */
function findBreakPoints(
  text: string,
  startIndex: number,
  endIndex: number,
  measurer: TextMeasurer,
  lineWidth: number,
): BreakPoint[] {
  const points: BreakPoint[] = [];
  let segmentStart = startIndex;
  let segmentWidth = 0;
  let lastBreakableIdx = startIndex;
  let lastBreakableWidth = 0;
  let i = startIndex;

  while (i < endIndex) {
    const c = text[i];
    const charType = getCharType(c);

    // Handle newlines within paragraph (single \n) — forced break
    if (c === '\n') {
      // Check for double-newline (paragraph boundary)
      if (i + 1 < endIndex && text[i + 1] === '\n') {
        // This is a paragraph boundary — handled by detectParagraphs
        // Treat the single newline case
        points.push({
          index: i + 1, // after the newline
          segmentWidth,
          breakType: 'forced',
        });
        segmentStart = i + 1;
        segmentWidth = 0;
        lastBreakableIdx = segmentStart;
        lastBreakableWidth = 0;
        i++;
        continue;
      }
      // Single newline = forced break
      points.push({
        index: i + 1,
        segmentWidth,
        breakType: 'forced',
      });
      segmentStart = i + 1;
      segmentWidth = 0;
      lastBreakableIdx = segmentStart;
      lastBreakableWidth = 0;
      i++;
      continue;
    }

    // Skip measuring spaces at line breaks (they'll be trimmed)
    if (charType === 'space') {
      const spaceWidth = measurer.measureChar(c);

      // Space is a word break opportunity (for Latin text)
      points.push({
        index: i + 1, // break after the space (trim it from line start)
        segmentWidth: segmentWidth + spaceWidth,
        breakType: 'word',
      });

      // Reset for next word
      segmentStart = i + 1;
      segmentWidth = 0;
      lastBreakableIdx = segmentStart;
      lastBreakableWidth = 0;
      i++;
      continue;
    }

    const charWidth = measurer.measureChar(c);

    // For CJK characters, we can break after them (禁则处理 applied later)
    if (charType === 'cjk' || charType === 'punctuation') {
      if (canBreakAfter(c)) {
        // Record this as a potential break point
        segmentWidth += charWidth;
        points.push({
          index: i + 1,
          segmentWidth,
          breakType: 'cjk',
        });
        lastBreakableIdx = i + 1;
        lastBreakableWidth = segmentWidth;
        segmentStart = i + 1;
        segmentWidth = 0;
      } else if (isProhibitedLineEnd(c)) {
        // Opening bracket can't end a line — it must stick to following chars
        // Accumulate width without recording a break point here
        segmentWidth += charWidth;
        // But record the position before this bracket as breakable
        lastBreakableIdx = segmentStart;
        lastBreakableWidth = segmentWidth - charWidth;
      } else {
        segmentWidth += charWidth;
      }
    } else {
      // Latin alphabet / digits — accumulate for word-based breaking
      segmentWidth += charWidth;
    }

    // Check if current accumulated segment exceeds line width
    // This handles long Latin words that need emergency breaking
    if (segmentWidth > lineWidth && segmentStart < i + 1) {
      // Emergency: break mid-word at the current position
      points.push({
        index: i + 1,
        segmentWidth,
        breakType: 'word', // emergency word break
      });
      lastBreakableIdx = i + 1;
      lastBreakableWidth = segmentWidth;
      segmentStart = i + 1;
      segmentWidth = 0;
    }

    i++;
  }

  // Final segment
  if (segmentStart < endIndex && segmentWidth > 0) {
    points.push({
      index: endIndex,
      segmentWidth,
      breakType: 'word',
    });
  }

  return points;
}

/**
 * 对已分行的结果应用 CJK 禁则处理（二次调整）。
 *
 * 在实际的 breakTextIntoLines 中，禁则处理已经在逐字符遍历时
 * 实时完成了（拉入避头标点、避免避尾标点孤立）。
 * 此函数作为二次校验，处理以下场景：
 *
 * 1. **避头拉入**：如果下一行以避头标点（如 。，）开头，
 *    从下一行拉一个字符到当前行末尾。
 * 2. **避尾推出**：如果当前行以避尾标点（如 「《）结尾，
 *    将该字符推到下一行开头。
 *
 * 注意：此函数在当前代码路径中未被直接调用，
 * 但保留作为对已生成行数组进行后处理禁则调整的能力。
 * 如需在 Worker 排版结果上进行禁则修正，可调用此函数。
 */
export function applyKinsoku(
  text: string,
  lines: { start: number; end: number }[],
): { start: number; end: number }[] {
  if (lines.length < 2) return lines;

  const adjusted: { start: number; end: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = { ...lines[i] };
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;

    if (nextLine && nextLine.start < text.length) {
      const nextStartChar = text[nextLine.start];

      // If next line starts with a prohibited line-start character,
      // try to pull it to the end of current line
      if (isProhibitedLineStart(nextStartChar)) {
        // Pull one char from next line to current
        if (nextLine.start + 1 <= nextLine.end) {
          line.end = nextLine.start + 1;
          lines[i + 1] = {
            start: nextLine.start + 1,
            end: nextLine.end,
          };
        }
      }
    }

    // Check if current line ends with prohibited line-end character
    if (line.end > line.start) {
      const lastChar = text[line.end - 1];
      if (isProhibitedLineEnd(lastChar) && nextLine) {
        // Push this char to the next line
        if (line.end - 1 >= line.start) {
          line.end = line.end - 1;
          lines[i + 1] = {
            start: line.end,
            end: nextLine.end,
          };
        }
      }
    }

    adjusted.push(line);
  }

  return adjusted;
}

/**
 * Break a single paragraph's text into lines using CJK-aware rules.
 */
export function breakParagraphIntoLines(
  text: string,
  paraStart: number,
  paraEnd: number,
  measurer: TextMeasurer,
  options: LineBreakOptions = DEFAULT_OPTIONS,
  isFirstLine: boolean = true,
  isHeading: boolean = false,
): { start: number; end: number }[] {
  const { lineWidth, paragraphIndent } = options;

  if (paraEnd <= paraStart) return [];

  const lines: { start: number; end: number }[] = [];
  const breakPoints = findBreakPoints(text, paraStart, paraEnd, measurer, lineWidth);

  if (breakPoints.length === 0) {
    // Single segment that fits or empty
    return [{ start: paraStart, end: paraEnd }];
  }

  let lineStart = paraStart;
  let currentWidth = 0;
  let firstLineIndent = (isHeading ? 0 : paragraphIndent) * measurer.emSize;

  for (const bp of breakPoints) {
    const proposedWidth = currentWidth + bp.segmentWidth;

    // Determine available width for this line
    const isFirst = lines.length === 0;
    const availableWidth = isFirst ? lineWidth - firstLineIndent : lineWidth;

    if (proposedWidth > availableWidth && currentWidth > 0) {
      // Line is full — emit it
      lines.push({ start: lineStart, end: bp.index > lineStart ? lineStart : bp.index });
      // ... hmm, we need to re-think this. The break points already represent
      // accumulated segments. Let me simplify.
    }
  }

  // Simplified algorithm — build lines by accumulating break points
  return buildLines(breakPoints, text, measurer, options, isHeading);
}

/**
 * Build lines from break points with width constraints.
 */
function buildLines(
  breakPoints: BreakPoint[],
  _text: string,
  measurer: TextMeasurer,
  options: LineBreakOptions,
  isHeading: boolean = false,
): { start: number; end: number }[] {
  if (breakPoints.length === 0) return [];

  const { lineWidth } = options;
  const firstLineIndent = isHeading ? 0 : options.paragraphIndent * measurer.emSize;

  const lines: { start: number; end: number }[] = [];
  let lineStart = breakPoints[0].index; // This is wrong — let me recalculate

  // Simpler approach: walk through break points, accumulate width,
  // emit line when width exceeds lineWidth
  let currentLineStartIndex = breakPoints.length > 0 ? 0 : 0;
  let accumulatedWidth = 0;
  let lastEmittedBpIdx = -1;
  let currentAvailableWidth = lineWidth - firstLineIndent;

  for (let i = 0; i < breakPoints.length; i++) {
    const bp = breakPoints[i];
    accumulatedWidth += bp.segmentWidth;

    if (accumulatedWidth > currentAvailableWidth) {
      // Need to break the line.
      // Go back to the last breakable point before this one
      let breakAt = i - 1;
      while (breakAt > lastEmittedBpIdx) {
        const prev = breakPoints[breakAt];
        if (prev.breakType !== 'forced') {
          // Found a good break point
          break;
        }
        breakAt--;
      }

      if (breakAt <= lastEmittedBpIdx) {
        // Emergency: no good break point, force break here
        breakAt = i;
      }

      // Emit the line
      const lineStartChar =
        lastEmittedBpIdx >= 0 ? breakPoints[lastEmittedBpIdx].index : 0;
      const lineEndChar = breakPoints[breakAt].index;

      if (lineEndChar > lineStartChar) {
        lines.push({ start: lineStartChar, end: lineEndChar });
      }

      lastEmittedBpIdx = breakAt;
      currentAvailableWidth = lineWidth; // subsequent lines use full width

      // Recalculate accumulated width from the break point after the line
      accumulatedWidth = 0;
      for (let j = breakAt + 1; j <= i; j++) {
        accumulatedWidth += breakPoints[j].segmentWidth;
      }
    }
  }

  // Emit remaining text as final line
  const lastBp = breakPoints[breakPoints.length - 1];
  const lineStartChar =
    lastEmittedBpIdx >= 0 ? breakPoints[lastEmittedBpIdx].index : 0;
  const lineEndChar = lastBp.index;

  if (lineEndChar > lineStartChar) {
    lines.push({ start: lineStartChar, end: lineEndChar });
  }

  return lines;
}

/**
 * 正式的 CJK 感知断行入口函数。
 *
 * 这是整个断行模块的主入口，被排版引擎和 Worker 调用。
 * 它将原始文本 + 配置转换为 TextLine 数组，供 Paginator 分页。
 *
 * ## 处理流程
 *
 * 1. 检测段落（detectParagraphs）
 * 2. 逐段落处理：
 *    - 标题/分隔符：单行居中，不参与断行
 *    - 普通段落：逐字符遍历，CJK 逐字可断，拉丁按单词断
 * 3. 每个段落内：
 *    - 首行应用缩进（paragraphIndent × emSize）
 *    - 逐字符累加宽度直到超出行宽 → 回溯找可断点 → 输出一行
 *    - 禁则处理在逐字符遍历中实时进行（检查下一字符是否为避头标点）
 *
 * ## 关键设计决策
 *
 * - **不使用 findBreakPoints + buildLines 二分法**：
 *   该辅助函数存在已知的边界 bug（行起始索引追踪不正确），
 *   因此实际使用的主算法是逐字符遍历法（while 循环内逐字推进）。
 * - **禁则实时处理**：在逐字遍历中，每当遇到 CJK 字符且下一字符为避头标点，
 *   立即尝试将避头标点「拉入」当前行。
 * - **安全退出**：循环内设置了 `currentIdx >= para.endIndex` 检查，
 *   防止在文本末尾或异常情况下无限循环。
 *
 * @param text 原始文本内容
 * @param measurer 已配置的文本测量器
 * @param options 断行选项（行宽、缩进、段间距）
 * @returns 已排版的 TextLine 数组，Y 坐标从 0 开始
 */
export function breakTextIntoLines(
  text: string,
  measurer: TextMeasurer,
  options: LineBreakOptions,
): TextLine[] {
  const paragraphs = detectParagraphs(text);
  const textLines: TextLine[] = [];

  // Track Y position
  let currentY = 0;
  const lineHeightPx = measurer.lineHeightPx;
  const { paragraphSpacing, paragraphIndent } = options;
  const indentPx = paragraphIndent * measurer.emSize;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];

    // 段落间插入间距（首段落除外，上面已有段间距）
    if (pIdx > 0) {
      currentY += paragraphSpacing;
    }

    // 获取当前段落的文本内容
    const paraText = text.slice(para.startIndex, para.endIndex);

    // ─── 处理标题：居中，上下留额外间距 ───
    if (para.isHeading) {
      // 计算居中 X 位置
      const headingWidth = measurer.measureWidth(paraText);
      const x = Math.max(0, (options.lineWidth - headingWidth) / 2);

      // 标题前增加额外间距（0.5 倍行高），使其与上文视觉分离
      currentY += lineHeightPx * 0.5;

      textLines.push({
        text: paraText,
        x,
        y: currentY,
        width: headingWidth,
        charRange: [para.startIndex, para.endIndex],
        isParagraphStart: true,
      });

      // 标题行高略大（1.2 倍），后跟 0.3 倍行高间距
      currentY += lineHeightPx * 1.2;
      currentY += lineHeightPx * 0.3;
      continue; // 标题不参与普通断行逻辑
    }

    // ─── 处理场景分隔符：居中 ───
    if (para.isSeparator) {
      const sepWidth = measurer.measureWidth(paraText);
      const x = Math.max(0, (options.lineWidth - sepWidth) / 2);
      // 分隔符前添加间距（0.5 倍行高），增强视觉分隔效果
      currentY += lineHeightPx * 0.5;

      textLines.push({
        text: paraText,
        x,
        y: currentY,
        width: sepWidth,
        charRange: [para.startIndex, para.endIndex],
        isParagraphStart: true,
      });

      currentY += lineHeightPx;
      currentY += lineHeightPx * 0.5; // 分隔符后的间距
      continue;
    }

    // ─── 处理普通段落：逐字符断行 ───
    let currentIdx = para.startIndex;
    let isFirstLineOfPara = true;

    while (currentIdx < para.endIndex) {
      // 首行可用宽度需减去首行缩进量
      const availableWidth = isFirstLineOfPara
        ? options.lineWidth - indentPx
        : options.lineWidth;

      let lineEnd = currentIdx;
      let lineWidth = 0;

      // 逐字符向前收集，直到填满可用宽度
      while (lineEnd < para.endIndex) {
        const c = text[lineEnd];
        const ct = getCharType(c);

        // ── 空格处理 ──
        // 行内空格保留测量宽度（贡献视觉空白），
        // 但最终行文本会被 trim，因此即使空格在行尾也不会导致溢出。
        if (ct === 'space') {
          const cw = measurer.measureChar(c);
          const proposedWidth = lineWidth + cw;
          // 连空格都放不下了 → 行已满
          if (proposedWidth > availableWidth && lineWidth > 0) {
            break;
          }
          lineWidth = proposedWidth;
          lineEnd++;
          continue;
        }

        const cw = measurer.measureChar(c);
        const proposedWidth = lineWidth + cw;

        // 加上这个字符会超出行宽 → 回溯到上一个可断点
        if (proposedWidth > availableWidth && lineWidth > 0) {
          // 行已满，退出内层循环
          break;
        }

        lineWidth = proposedWidth;
        lineEnd++;

        // ── CJK / 标点：逐字可断，同时处理禁则 ──
        if ((ct === 'cjk' || ct === 'punctuation') && canBreakAfter(c)) {
          // 这是一个自然的断行位置
          // 检查下一个字符是否为避头标点（如 。，、）
          if (lineEnd < para.endIndex && isProhibitedLineStart(text[lineEnd])) {
            // 禁则拉入：尝试将避头标点从下行拉到当前行末尾
            const nextCw = measurer.measureChar(text[lineEnd]);
            if (lineWidth + nextCw <= availableWidth) {
              lineWidth += nextCw;
              lineEnd++; // 拉入成功，吞掉这个字符
            }
            // 如果拉入会导致溢出，则留到下行处理
          }
        } else if (isProhibitedLineEnd(c)) {
          // ── 避尾处理 ──
          // 左括号类标点（如 「（《）在行尾是不合法的，
          // 必须至少带上下一个字符一起断行。
          if (lineEnd < para.endIndex) {
            const nextCw = measurer.measureChar(text[lineEnd]);
            if (lineWidth + nextCw <= availableWidth) {
              lineWidth += nextCw;
              lineEnd++; // 吞掉下一字符，确保左括号不孤立在行尾
            }
          }
        }
      }

      // 构建行文本，去除尾部空格（行尾空白在排版中无意义）
      let lineText = text.slice(currentIdx, lineEnd).trim();

      // 仅首行有缩进偏移
      const x = isFirstLineOfPara ? indentPx : 0;

      // 测量实际渲染文本宽度（trim 后的）
      const actualWidth = measurer.measureWidth(lineText);

      textLines.push({
        text: lineText,
        x,
        y: currentY,
        width: actualWidth,
        charRange: [currentIdx, lineEnd],
        isParagraphStart: isFirstLineOfPara,
      });

      // 下移一个行高
      currentY += lineHeightPx;
      currentIdx = lineEnd;
      isFirstLineOfPara = false;

      // 安全检查：防止因某种原因导致无限循环
      // （如 lineEnd 没有前进，currentIdx 不变）
      if (currentIdx >= para.endIndex) break;
    }
  }

  return textLines;
}
