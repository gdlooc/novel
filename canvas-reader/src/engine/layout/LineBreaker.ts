/**
 * LineBreaker — CJK-aware line breaking engine.
 *
 * Implements Chinese/Japanese/Korean text line breaking with:
 * - CJK character break after any character
 * - Latin word boundary break
 * - Mixed CJK+Latin spacing
 * - 禁则处理 (prohibited line-start/line-end characters)
 * - Paragraph detection
 * - Heading/title detection
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

/** A single break opportunity within text */
interface BreakPoint {
  /** Character index in source text */
  index: number;
  /** Width from last break point to this point */
  segmentWidth: number;
  /** Type of break (word, char, forced) */
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
 * Detect paragraphs from raw text.
 * A paragraph is separated by one or more blank lines (\n\n+).
 * We also try to detect headings: short single lines, all on one "paragraph".
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
      charIndex += raw.length + 2; // account for \n\n
      continue;
    }

    const startIndex = charIndex;
    const endIndex = startIndex + trimmed.length;

    // Detect headings: only match explicit structural patterns.
    // Chinese web novels have many short paragraphs (dialogue, transitions)
    // that must NOT be treated as headings.
    const isHeading =
      trimmed.length <= 50 &&
      // Must match an explicit chapter/section title pattern
      (/^第[一二三四五六七八九十百千零\d]+[卷章节回部]/.test(trimmed) ||
        /^[序终][章]/.test(trimmed) ||
        /^[楔跋][子]/.test(trimmed) ||
        /^(?:尾声|番外[篇]?|后记|前言|结语|附录|人物介绍|剧情简介|内容简介|\\s*[Pp]rologue|\\s*[Ee]pilogue)/.test(trimmed));

    // Detect scene separators
    const isSeparator =
      /^[*＊※~～—━]{2,}$/.test(trimmed) ||
      /^[※＊]\s*[※＊]\s*[※＊]$/.test(trimmed) ||
      /^[-－—]{3,}$/.test(trimmed);

    paragraphs.push({
      startIndex,
      endIndex,
      isHeading,
      isSeparator,
    });

    charIndex += raw.length + 2; // account for the paragraph + \n\n
  }

  return paragraphs;
}

/**
 * Find the next break position in text starting from `startIndex`.
 * For CJK: break after each character
 * For Latin: break at word boundaries (spaces)
 * Handles 禁则处理 by pulling characters across break points.
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
 * Apply CJK 禁则处理 (kinsoku shori) to adjust line breaks.
 *
 * When a break point would leave a prohibited start character at the
 * beginning of the next line, we "pull" one character from the next line
 * to end the current line (or push the prohibited char if at end).
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
 * Main CJK-aware line breaker.
 *
 * Given a text and configuration, breaks the entire text into TextLine objects
 * suitable for pagination.
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

    // Add paragraph spacing before this paragraph (except first)
    if (pIdx > 0) {
      currentY += paragraphSpacing;
    }

    // Get paragraph text
    const paraText = text.slice(para.startIndex, para.endIndex);

    // Headings: center-aligned, slightly larger spacing
    if (para.isHeading) {
      const headingWidth = measurer.measureWidth(paraText);
      const x = Math.max(0, (options.lineWidth - headingWidth) / 2);

      // Add extra space before headings
      currentY += lineHeightPx * 0.5;

      textLines.push({
        text: paraText,
        x,
        y: currentY,
        width: headingWidth,
        charRange: [para.startIndex, para.endIndex],
        isParagraphStart: true,
      });

      currentY += lineHeightPx * 1.2; // Slightly larger line height for headings
      currentY += lineHeightPx * 0.3; // Extra space after heading
      continue;
    }

    // Scene separators: centered
    if (para.isSeparator) {
      const sepWidth = measurer.measureWidth(paraText);
      const x = Math.max(0, (options.lineWidth - sepWidth) / 2);
      currentY += lineHeightPx * 0.5; // Space before separator

      textLines.push({
        text: paraText,
        x,
        y: currentY,
        width: sepWidth,
        charRange: [para.startIndex, para.endIndex],
        isParagraphStart: true,
      });

      currentY += lineHeightPx;
      currentY += lineHeightPx * 0.5; // Space after separator
      continue;
    }

    // Regular paragraph — break into lines
    let currentIdx = para.startIndex;
    let isFirstLineOfPara = true;

    while (currentIdx < para.endIndex) {
      const availableWidth = isFirstLineOfPara
        ? options.lineWidth - indentPx
        : options.lineWidth;

      // Find where this line ends
      let lineEnd = currentIdx;
      let lineWidth = 0;

      // Walk forward collecting characters until we fill available width
      while (lineEnd < para.endIndex) {
        const c = text[lineEnd];
        const ct = getCharType(c);

        if (ct === 'space') {
          // Measure the space — inter-word spaces contribute to rendered width.
          // Trailing spaces are trimmed from final line text, so measurement
          // stays conservative (won't cause overflow).
          const cw = measurer.measureChar(c);
          const proposedWidth = lineWidth + cw;
          if (proposedWidth > availableWidth && lineWidth > 0) {
            break; // even space doesn't fit, line is full
          }
          lineWidth = proposedWidth;
          lineEnd++;
          continue;
        }

        const cw = measurer.measureChar(c);
        const proposedWidth = lineWidth + cw;

        if (proposedWidth > availableWidth && lineWidth > 0) {
          // Line is full
          break;
        }

        lineWidth = proposedWidth;
        lineEnd++;

        // CJK: can break after any character
        if ((ct === 'cjk' || ct === 'punctuation') && canBreakAfter(c)) {
          // This is a natural break opportunity
          // Check if next char is prohibited at line start
          if (lineEnd < para.endIndex && isProhibitedLineStart(text[lineEnd])) {
            // Pull the punctuation to this line if possible
            const nextCw = measurer.measureChar(text[lineEnd]);
            if (lineWidth + nextCw <= availableWidth) {
              lineWidth += nextCw;
              lineEnd++;
            }
          }
        } else if (isProhibitedLineEnd(c)) {
          // Opening bracket at end of line — must pull next char
          if (lineEnd < para.endIndex) {
            const nextCw = measurer.measureChar(text[lineEnd]);
            if (lineWidth + nextCw <= availableWidth) {
              lineWidth += nextCw;
              lineEnd++;
            }
          }
        }
      }

      // Build the line text and trim trailing spaces
      let lineText = text.slice(currentIdx, lineEnd).trim();

      // Calculate x position
      const x = isFirstLineOfPara ? indentPx : 0;

      // Width of actual rendered text
      const actualWidth = measurer.measureWidth(lineText);

      textLines.push({
        text: lineText,
        x,
        y: currentY,
        width: actualWidth,
        charRange: [currentIdx, lineEnd],
        isParagraphStart: isFirstLineOfPara,
      });

      currentY += lineHeightPx;
      currentIdx = lineEnd;
      isFirstLineOfPara = false;

      // Safety: prevent infinite loop
      if (currentIdx >= para.endIndex) break;
    }
  }

  return textLines;
}
