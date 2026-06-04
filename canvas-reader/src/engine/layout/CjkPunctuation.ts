/**
 * CJK punctuation handling (禁则处理 / kinsoku shori).
 *
 * Chinese and Japanese typography has strict rules about which
 * punctuation characters can appear at the start or end of a line.
 *
 * Prohibited line-start characters (避头): cannot be the first character of a line.
 * Prohibited line-end characters (避尾): cannot be the last character of a line.
 *
 * Reference: W3C Requirements for Chinese Text Layout (clreq)
 * https://www.w3.org/TR/clreq/
 */

/**
 * Characters that cannot appear at the start of a line.
 * These are closing punctuation marks and certain other characters.
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
 * Characters that cannot appear at the end of a line.
 * These are opening punctuation marks.
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
 * Check if a character is a CJK character (CJK Unified Ideographs,
 * CJK Extension A, CJK Compatibility Ideographs, etc.)
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
 * Check if a character is a Latin/alphanumeric character.
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
 * Check if a character is a space or whitespace.
 */
export function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '　'; // 　 = fullwidth space
}

/**
 * Check if a character is prohibited at the start of a line.
 */
export function isProhibitedLineStart(c: string): boolean {
  return PROHIBITED_LINE_START.has(c);
}

/**
 * Check if a character is prohibited at the end of a line.
 */
export function isProhibitedLineEnd(c: string): boolean {
  return PROHIBITED_LINE_END.has(c);
}

/**
 * Check if a character can be the break point for CJK text.
 * CJK text can break after most characters except
 * prohibited line-start characters (because they can't start next line).
 */
export function canBreakAfter(c: string): boolean {
  if (c.length !== 1) return false;
  // Cannot break after opening brackets (they shouldn't end a line)
  if (isProhibitedLineEnd(c)) return false;
  // CJK characters generally allow break after
  if (isCJK(c)) return true;
  // Fullwidth punctuation — some allow break
  if (isProhibitedLineStart(c)) return true;
  return false;
}

/**
 * Check if a character can start a line.
 */
export function canStartLine(c: string): boolean {
  if (c.length !== 1) return false;
  return !isProhibitedLineStart(c);
}

/**
 * Get the type of a character for layout purposes.
 */
export type CharType = 'cjk' | 'latin' | 'space' | 'punctuation' | 'other';

export function getCharType(c: string): CharType {
  if (isSpace(c)) return 'space';
  if (isCJK(c)) return 'cjk';
  if (isLatin(c)) return 'latin';
  if (isProhibitedLineStart(c) || isProhibitedLineEnd(c)) return 'punctuation';
  return 'other';
}
