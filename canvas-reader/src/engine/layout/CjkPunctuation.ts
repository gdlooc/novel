/**
 * CJK 标点禁则处理（禁則処理 / kinsoku shori）。
 *
 * 中文和日文排版对行首和行尾允许出现的标点符号有严格规定，
 * 称为「禁则」。本模块负责：
 * 1. 定义避头和避尾字符集
 * 2. 字符类型判断（CJK/拉丁/空格/标点）
 * 3. 断行可行性判断
 *
 * ## 核心概念
 *
 * **避头（prohibited line-start）**：
 * 不允许出现在行首的字符，如句号、逗号、右括号等标点。
 * 这些是「收尾」字符，语义上属于前文，不应被换行分隔。
 *
 * **避尾（prohibited line-end）**：
 * 不允许出现在行尾的字符，如左括号、书名号开头等。
 * 这些是「起始」字符，语义上属于后文，不应脱离后续内容。
 *
 * ## 禁则处理算法
 *
 * 遇到禁则冲突时，有两种处理方式：
 * - **拉入（pull-in）**：将下一行的首个字符拉到当前行末尾（处理避头）
 * - **推出（push-out）**：将当前行末尾字符推到下一行开头（处理避尾）
 *
 * 参考标准：W3C 中文排版需求 (clreq)
 * https://www.w3.org/TR/clreq/
 */

/**
 * 避头字符集（禁止出现在行首的字符）。
 *
 * 这些字符是「句尾型」标点，语义上属于前文内容：
 * - 句号、逗号、顿号、分号、冒号（句尾停顿类）
 * - 问号、感叹号（句尾语气类）
 * - 右括号/右引号类（成对标点的闭合侧）
 * - 省略号、破折号（通常紧跟前后文）
 * - 间隔号、长音符等日语专用符号
 *
 * 使用 Set 数据结构：O(1) 查询效率。
 */
const PROHIBITED_LINE_START = new Set([
  // Chinese closing punctuation
  '、', // 、 (ideographic comma)
  '。', // 。 (ideographic full stop)
  '，', // ， (fullwidth comma)
  '．', // ． (fullwidth full stop)
  '；', // ； (fullwidth semicolon)
  '：', // ： (fullwidth colon)
  '？', // ？ (fullwidth question mark)
  '！', // ！ (fullwidth exclamation mark)
  '」', // 」 (right corner bracket)
  '』', // 』 (right white corner bracket)
  '〉', // 〉 (right angle bracket)
  '》', // 》 (right double angle bracket)
  '）', // ） (fullwidth right parenthesis)
  '】', // 】 (right black lenticular bracket)
  '］', // ］ (fullwidth right square bracket)
  '〕', // 〕 (right tortoise shell bracket)
  '…', // … (horizontal ellipsis)
  '—', // — (em dash, sometimes treated as line-end)
  '～', // ～ (fullwidth tilde)
  // Chinese-specific
  '〃', // 〃 (ditto mark)
  '々', // 々 (iteration mark)
  '〇', // 〇 (ideographic number zero)
  'ー', // ー (katakana-hiragana prolonged sound mark)
  '－', // － (fullwidth hyphen-minus)
  '％', // ％ (fullwidth percent sign)
  '＃', // ＃ (fullwidth number sign)
  '＄', // ＄ (fullwidth dollar sign)
  '＇', // ＇ (fullwidth apostrophe)
  '＠', // ＠ (fullwidth commercial at)
  // Japanese-specific marks
  '・', // ・ (katakana middle dot)
  '･', // ･ (halfwidth katakana middle dot)
]);

/**
 * 避尾字符集（禁止出现在行尾的字符）。
 *
 * 这些字符是「句首型」标点，语义上属于后续内容：
 * - 左括号/左引号类（成对标点的开启侧）
 * - 书名号开头（《〈「『）
 * - 货币符号（￥＄，通常紧跟数字）
 *
 * 这些字符若出现在行尾，会与后面的内容脱节。
 */
const PROHIBITED_LINE_END = new Set([
  // Chinese opening punctuation
  '「', // 「 (left corner bracket)
  '『', // 『 (left white corner bracket)
  '〈', // 〈 (left angle bracket)
  '《', // 《 (left double angle bracket)
  '（', // （ (fullwidth left parenthesis)
  '【', // 【 (left black lenticular bracket)
  '［', // ［ (fullwidth left square bracket)
  '〔', // 〔 (left tortoise shell bracket)
  '￥', // ￥ (fullwidth yen sign)
  '＂', // ＂ (fullwidth quotation mark)
]);

/**
 * 判断字符是否为 CJK 字符。
 *
 * 覆盖 Unicode 中的以下区块：
 * - CJK 统一表意文字 (0x4E00–0x9FFF)：常用汉字
 * - CJK 统一表意文字扩展 A (0x3400–0x4DBF)：罕见汉字
 * - CJK 兼容表意文字 (0xF900–0xFAFF)：兼容性汉字
 * - CJK 部首补充 (0x2E80–0x2EFF)：偏旁部首
 * - CJK 符号和标点 (0x3000–0x303F)：顿号、句号等全角标点
 * - 半角/全角形式 (0xFF00–0xFFEF)：全角字母数字
 * - 平假名 (0x3040–0x309F)
 * - 片假名 (0x30A0–0x30FF)
 * - 韩文音节 (0xAC00–0xD7AF)
 *
 * 注意：中文标点（如 。，；：“”）也在 CJK 符号和标点区块中，
 * 因此会被 isCJK 返回 true。断行逻辑中需配合禁则判断来处理标点。
 */
export function isCJK(c: string): boolean {
  if (c.length !== 1) return false;
  const cp = c.codePointAt(0)!;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x2e80 && cp <= 0x2eff) || // CJK Radicals Supplement
    (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols and Punctuation
    (cp >= 0xff00 && cp <= 0xffef) || // Halfwidth and Fullwidth Forms
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af)    // Hangul Syllables
  );
}

/**
 * 判断字符是否为拉丁字母或数字。
 *
 * 覆盖 ASCII 范围：
 * - A-Z (0x41–0x5A)
 * - a-z (0x61–0x7A)
 * - 0-9 (0x30–0x39)
 *
 * 拉丁文本的断行规则与 CJK 不同：按单词边界断行，而非逐字符。
 * 这个判断用于在混合排版（中英混排）中切换断行策略。
 */
export function isLatin(c: string): boolean {
  if (c.length !== 1) return false;
  const cp = c.codePointAt(0)!;
  return (
    (cp >= 0x0041 && cp <= 0x005a) || // A-Z
    (cp >= 0x0061 && cp <= 0x007a) || // a-z
    (cp >= 0x0030 && cp <= 0x0039)    // 0-9
  );
}

/**
 * 判断字符是否为空格或空白字符。
 *
 * 包含三种空格形式：
 * - ' ' 半角空格 (U+0020)：英文单词间
 * - '\t' 制表符 (U+0009)
 * - '　' 全角空格 (U+3000)：中文排版中少见，但可能存在
 *
 * 空格是自然的断行点，但不出现在行首（会被 trimmed）。
 */
export function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '　'; // '　' = 全角空格 (U+3000)
}

/**
 * 判断字符是否为避头字符（不可出现在行首）。
 *
 * 使用 Set.has() 实现 O(1) 查询，
 * 在断行循环中高频调用，性能关键。
 */
export function isProhibitedLineStart(c: string): boolean {
  return PROHIBITED_LINE_START.has(c);
}

/**
 * 判断字符是否为避尾字符（不可出现在行尾）。
 */
export function isProhibitedLineEnd(c: string): boolean {
  return PROHIBITED_LINE_END.has(c);
}

/**
 * 判断指定字符之后是否可以断行。
 *
 * 断行规则（按优先级）：
 * 1. 避尾字符（左括号类）之后不可断行 — 它们必须与后续内容保持连接
 * 2. CJK 字符之后通常允许断行
 * 3. 避头字符（右括号类）之后允许断行 — 它们可以留在行尾
 * 4. 其他字符（如拉丁字母在单词中间）默认不可断行
 *
 * 注意：此函数判断的是「字符后是否可以断行」，
 * 而非「字符本身是否可以出现在行尾」。
 * 例如，左括号是不可断行（canBreakAfter = false），
 * 意味着排版引擎必须将后续内容也放入当前行。
 */
export function canBreakAfter(c: string): boolean {
  if (c.length !== 1) return false;
  // 左括号类：不可断行，后续内容必须同行
  if (isProhibitedLineEnd(c)) return false;
  // CJK 字符：通常可断行
  if (isCJK(c)) return true;
  // 右括号类（句号、逗号等）：可断行（它们留在行尾是合法的）
  if (isProhibitedLineStart(c)) return true;
  // 拉丁字母在单词中间：默认不可断行
  return false;
}

/**
 * 判断字符是否可以出现在行首。
 *
 * 实际上就是检查该字符是否在避头字符集中。
 * 例如：句号 '。' 不可出现在行首（避头），因此 canStartLine('。') = false。
 */
export function canStartLine(c: string): boolean {
  if (c.length !== 1) return false;
  return !isProhibitedLineStart(c);
}

/**
 * 字符分类类型，用于断行算法中切换处理策略。
 *
 * - 'cjk'：中日韩字符，逐字符断行
 * - 'latin'：拉丁字母/数字，按单词边界断行
 * - 'space'：空格类，断行后 trimmed
 * - 'punctuation'：禁则相关标点，特殊处理
 * - 'other'：其他字符（emoji、符号等），按 CJK 规则处理
 */
export type CharType = 'cjk' | 'latin' | 'space' | 'punctuation' | 'other';

/**
 * 获取字符类型，用于断行算法分支决策。
 *
 * 判断优先级（从特殊到一般）：
 * 1. 空格 → 'space（最先判断，避免被归入其他类型）
 * 2. CJK → 'cjk'（包含中文字符和中文标点）
 * 3. 拉丁 → 'latin'（英文单词用空格分断）
 * 4. 禁则标点 → 'punctuation'（需要拉入/推出处理）
 * 5. 其他 → 'other'
 */
export function getCharType(c: string): CharType {
  if (isSpace(c)) return 'space';
  if (isCJK(c)) return 'cjk';
  if (isLatin(c)) return 'latin';
  if (isProhibitedLineStart(c) || isProhibitedLineEnd(c)) return 'punctuation';
  return 'other';
}
