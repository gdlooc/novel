/**
 * BookLoader — Orchestrates book loading and format adapter selection.
 *
 * Scans registered format adapters to find one that can handle
 * the given book source, then uses it to load metadata and TOC.
 */

import type { IBookFormat } from './formats/IBookFormat';
import type { BookSource, BookMetadata, TocEntry, ChapterNav } from './types';
import { WenkuAdapter } from './formats/WenkuAdapter';
import { PlainTextAdapter } from './formats/PlainTextAdapter';

/** Build a navigable chapter list from TOC entries */
function buildChapterNav(entries: TocEntry[]): ChapterNav {
  // 扁平化章节列表（仅叶子章）
  const chapters: TocEntry[] = [];
  // 章节 ID → 所属分卷名称的映射
  const volumeMap = new Map<string, string>();

  function flatten(list: TocEntry[], parentVolumeName?: string): void {
    for (const entry of list) {
      if (entry.children && entry.children.length > 0) {
        // 当前条目是分卷，递归时传入分卷名
        flatten(entry.children, entry.title);
      } else {
        chapters.push(entry);
        // 记录叶子章所属分卷
        if (parentVolumeName) {
          volumeMap.set(entry.chapterId, parentVolumeName);
        }
      }
    }
  }
  flatten(entries);

  // 如果没有叶子章，使用全部条目
  if (chapters.length === 0) {
    chapters.push(...entries);
  }

  const chapterMap = new Map<string, TocEntry>();
  for (const ch of chapters) {
    chapterMap.set(ch.chapterId, ch);
  }

  return {
    chapters,
    findById: (id: string) => chapterMap.get(id),
    getNext: (id: string) => {
      const idx = chapters.findIndex((ch) => ch.chapterId === id);
      if (idx >= 0 && idx < chapters.length - 1) return chapters[idx + 1];
      return undefined;
    },
    getPrev: (id: string) => {
      const idx = chapters.findIndex((ch) => ch.chapterId === id);
      if (idx > 0) return chapters[idx - 1];
      return undefined;
    },
    getVolumeName: (id: string) => volumeMap.get(id),
    totalChapters: chapters.length,
  };
}

/**
 * BookLoader manages format adapters and book loading.
 */
export class BookLoader {
  private adapters: IBookFormat[] = [];

  constructor() {
    // Register built-in adapters
    this.registerAdapter(new WenkuAdapter());
    this.registerAdapter(new PlainTextAdapter());
  }

  /**
   * Register a format adapter.
   */
  registerAdapter(adapter: IBookFormat): void {
    this.adapters.push(adapter);
  }

  /**
   * Find the appropriate adapter for a book source.
   */
  findAdapter(source: BookSource): IBookFormat | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(source)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Load book metadata from a source.
   */
  async loadMetadata(source: BookSource): Promise<BookMetadata> {
    const adapter = this.findAdapter(source);
    if (!adapter) {
      throw new Error(`No adapter found for source type: ${source.type}`);
    }
    return adapter.getMetadata(source);
  }

  /**
   * Load the table of contents.
   */
  async loadToc(source: BookSource): Promise<ChapterNav> {
    const adapter = this.findAdapter(source);
    if (!adapter) {
      throw new Error(`No adapter found for source type: ${source.type}`);
    }
    const entries = await adapter.getToc(source);
    return buildChapterNav(entries);
  }

  /**
   * Load book metadata and TOC together.
   */
  async loadBook(source: BookSource): Promise<{
    metadata: BookMetadata;
    nav: ChapterNav;
  }> {
    const adapter = this.findAdapter(source);
    if (!adapter) {
      throw new Error(`No adapter found for source type: ${source.type}`);
    }

    const [metadata, tocEntries] = await Promise.all([
      adapter.getMetadata(source),
      adapter.getToc(source),
    ]);

    const nav = buildChapterNav(tocEntries);

    return { metadata, nav };
  }

  /**
   * Get all registered adapters (useful for UI to show supported formats).
   */
  getRegisteredFormats(): { id: string; name: string }[] {
    return this.adapters.map((a) => ({
      id: a.formatId,
      name: a.formatName,
    }));
  }
}

// Singleton instance
let defaultLoader: BookLoader | null = null;

export function getBookLoader(): BookLoader {
  if (!defaultLoader) {
    defaultLoader = new BookLoader();
  }
  return defaultLoader;
}
