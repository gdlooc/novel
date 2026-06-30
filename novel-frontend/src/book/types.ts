/**
 * Book data layer types.
 *
 * These types are format-agnostic. Format-specific adapters
 * convert their native formats into these common structures.
 */

/** How a book source is identified */
export interface BookSource {
  /** Type of source: 'wenku-local', 'txt-file', 'http-api', etc. */
  type: string;
  /** Location identifier (file path, URL, book ID) */
  uri: string;
  /** Additional metadata for the adapter */
  metadata?: Record<string, unknown>;
}

/** Book metadata (format-agnostic) */
export interface BookMetadata {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  description?: string;
  publisher?: string;
  status?: string;
  wordCount?: number;
  tags?: string[];
  source: BookSource;
}

/** A table of contents entry */
export interface TocEntry {
  chapterId: string;
  title: string;
  /** Nesting level: 0 = volume, 1 = chapter within volume, etc. */
  level: number;
  /** Child entries (for volumes containing chapters) */
  children?: TocEntry[];
  /** Position in the flat chapter list */
  order: number;
}

/** Raw chapter content */
export interface ChapterContent {
  chapterId: string;
  title: string;
  /** Plain text content (the format all adapters must produce) */
  content: string;
  /** Associated images (illustrations) */
  images: ChapterImage[];
  /** Previous chapter ID (for navigation) */
  prevChapterId?: string;
  /** Next chapter ID (for navigation) */
  nextChapterId?: string;
}

export interface ChapterImage {
  id: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

/** A flat, navigable chapter list built from TOC */
export interface ChapterNav {
  /** All chapters in reading order */
  chapters: TocEntry[];
  /** Find a chapter by ID */
  findById: (chapterId: string) => TocEntry | undefined;
  /** Get the next chapter */
  getNext: (chapterId: string) => TocEntry | undefined;
  /** Get the previous chapter */
  getPrev: (chapterId: string) => TocEntry | undefined;
  /** 根据章节 ID 查找所属分卷名称 */
  getVolumeName: (chapterId: string) => string | undefined;
  /** Total chapter count */
  totalChapters: number;
}
