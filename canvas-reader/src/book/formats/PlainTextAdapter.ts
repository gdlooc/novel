/**
 * PlainTextAdapter — Adapter for raw .txt files.
 *
 * Handles plain text novels. Uses regex patterns to detect
 * chapter boundaries within the text.
 *
 * Chapter detection patterns (Chinese novels):
 * - "第X卷" / "第X章" / "第X节"
 * - "Chapter X"
 * - "序章" / "终章" / "尾声" / "楔子"
 * - "番外" / "后记" / "前言"
 */

import type { IBookFormat } from './IBookFormat';
import type {
  BookSource,
  BookMetadata,
  TocEntry,
  ChapterContent,
} from '../types';

/** Pattern for detecting chapter titles in Chinese text */
const CHAPTER_PATTERNS = [
  /^第[一二三四五六七八九十百千零\d]+[卷章节回][\s　]*(.*)/,
  /^[序终][章][\s　]*(.*)/,
  /^(?:楔子|尾声|番外|后记|前言|结语)[\s　]*(.*)/,
  /^Chapter\s+\d+[\s　]*(.*)/i,
  /^(?:Prologue|Epilogue|Extra|Afterword|Foreword)[\s　]*(.*)/i,
];

interface DetectedChapter {
  startIndex: number;
  title: string;
  chapterId: string;
}

export class PlainTextAdapter implements IBookFormat {
  readonly formatId = 'plain-text';
  readonly formatName = '纯文本 (.txt)';

  canHandle(source: BookSource): boolean {
    return source.type === 'txt-file' || source.type === 'plain-text';
  }

  async getMetadata(source: BookSource): Promise<BookMetadata> {
    // For plain text, extract filename as title
    const fileName = source.uri.split('/').pop()?.replace(/\.(txt|text)$/i, '') || '未命名';
    const bookId = source.metadata?.bookId as string || this.slugify(fileName);

    return {
      bookId,
      title: fileName,
      author: '未知',
      source,
    };
  }

  async getToc(source: BookSource): Promise<TocEntry[]> {
    const text = await this.loadText(source);
    const chapters = this.detectChapters(text);

    return chapters.map((ch, idx) => ({
      chapterId: ch.chapterId,
      title: ch.title,
      level: 1,
      order: idx,
    }));
  }

  async getChapterContent(
    source: BookSource,
    chapterId: string,
  ): Promise<ChapterContent> {
    const text = await this.loadText(source);
    const chapters = this.detectChapters(text);

    const idx = chapters.findIndex((ch) => ch.chapterId === chapterId);
    if (idx === -1) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }

    const ch = chapters[idx];
    const startIndex = ch.startIndex;
    const endIndex = idx + 1 < chapters.length
      ? chapters[idx + 1].startIndex
      : text.length;

    const content = text.slice(startIndex, endIndex).trim();
    const prevChapterId = idx > 0 ? chapters[idx - 1].chapterId : undefined;
    const nextChapterId = idx + 1 < chapters.length ? chapters[idx + 1].chapterId : undefined;

    return {
      chapterId: ch.chapterId,
      title: ch.title,
      content,
      images: [],
      prevChapterId,
      nextChapterId,
    };
  }

  // ─── Private ───

  private async loadText(source: BookSource): Promise<string> {
    const resp = await fetch(source.uri);
    if (!resp.ok) {
      throw new Error(`Failed to load text file: ${resp.status}`);
    }

    // Try to detect encoding from response
    const buffer = await resp.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    let text = decoder.decode(buffer);

    // Remove BOM if present
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    return text;
  }

  private detectChapters(text: string): DetectedChapter[] {
    const lines = text.split('\n');
    const chapters: DetectedChapter[] = [];
    let charIndex = 0;

    // First chapter starts at beginning
    chapters.push({
      startIndex: 0,
      title: '开始',
      chapterId: 'ch_0',
    });

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        charIndex += line.length + 1; // +1 for \n
        continue;
      }

      for (const pattern of CHAPTER_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
          const title = trimmed;
          chapters.push({
            startIndex: charIndex,
            title,
            chapterId: `ch_${chapters.length}`,
          });
          break;
        }
      }

      charIndex += line.length + 1;
    }

    // If only one "chapter" (the whole file), give it a better name
    if (chapters.length === 1) {
      chapters[0].title = '全文';
    }

    return chapters;
  }

  private slugify(text: string): string {
    return text
      .replace(/[^\w一-鿿]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}
