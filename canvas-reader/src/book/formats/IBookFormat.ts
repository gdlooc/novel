/**
 * IBookFormat — Format adapter interface.
 *
 * All book format adapters implement this interface.
 * The reader engine interacts with books exclusively through this interface,
 * making it format-agnostic and easily extensible.
 *
 * To add a new format (EPUB, PDF, etc.), implement this interface
 * and register the adapter.
 */

import type { BookSource, BookMetadata, TocEntry, ChapterContent } from '../types';

export interface IBookFormat {
  /** Unique identifier for this format */
  readonly formatId: string;

  /** Human-readable name */
  readonly formatName: string;

  /**
   * Check if this adapter can handle the given book source.
   * Source types: 'wenku-local', 'txt-file', 'epub-file', etc.
   */
  canHandle(source: BookSource): boolean;

  /**
   * Parse book metadata from the source.
   * This should be fast — just metadata, no content.
   */
  getMetadata(source: BookSource): Promise<BookMetadata>;

  /**
   * Get the full table of contents.
   */
  getToc(source: BookSource): Promise<TocEntry[]>;

  /**
   * Load a single chapter's content as plain text.
   *
   * @param source - The book source
   * @param chapterId - The chapter identifier
   * @returns Chapter content with plain text for layout
   */
  getChapterContent(source: BookSource, chapterId: string): Promise<ChapterContent>;

  /**
   * Get binary/image resources for a chapter (optional).
   * Returns an empty array if no resources exist.
   */
  getChapterResources?(
    source: BookSource,
    chapterId: string,
  ): Promise<{ id: string; url: string; data?: Blob }[]>;
}
