/**
 * WenkuAdapter — Adapter for wenku8.net novel data produced by the crawler.
 *
 * Expected file structure (matching sibling crawler/ output):
 *   {baseUrl}/
 *     metadata.json              — Book metadata (title, author, cover_url, etc.)
 *     chapters.json              — Flat chapter list with volume grouping
 *     chapters/{cid}.json        — Individual chapter content
 *     images/{cid}/*.jpg         — Chapter illustrations (optional)
 */

import type { IBookFormat } from './IBookFormat';
import type {
  BookSource,
  BookMetadata,
  TocEntry,
  ChapterContent,
} from '../types';

// ─── Raw data types matching crawler output ───

/** Raw metadata.json from crawler */
interface RawMetadata {
  aid: number;
  title: string;
  author: string;
  publisher?: string;
  status?: string;
  last_update?: string;
  word_count?: string;
  tags?: string[];
  rating?: string;
  description?: string;
  cover_url?: string;
  total_chapters?: number;
  completed_chapters?: number;
}

/** Raw chapters.json entry from crawler */
interface RawChapterMeta {
  cid: number;
  volume: string;
  title: string;
  url: string;
  completed: boolean;
}

/** Raw chapter content JSON from crawler */
interface RawChapterContent {
  cid: number;
  aid: string;
  title: string;
  book_title: string;
  content: string;
  images: string[];
  has_images: boolean;
  prev_cid: string;
  next_cid: string;
  index_url: string;
}

// ─── Helpers ───

/**
 * Wrapper around fetch that validates the response is actually JSON.
 * Vite dev server returns index.html (HTML) for 404s, which would
 * cause a cryptic "Unexpected token '<'" error from resp.json().
 */
async function fetchJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      `Expected JSON but got HTML from ${url}. The file may not exist. ` +
      `Check that the crawler output is accessible.`
    );
  }
  return resp.json() as Promise<T>;
}

// ─── Adapter ───

export class WenkuAdapter implements IBookFormat {
  readonly formatId = 'wenku8';
  readonly formatName = '轻小说文库 (wenku8)';

  canHandle(source: BookSource): boolean {
    return source.type === 'wenku-local' || source.type === 'wenku8';
  }

  async getMetadata(source: BookSource): Promise<BookMetadata> {
    const baseUrl = source.uri;
    const bookId = (source.metadata?.bookId as string) || this.extractBookId(source);

    let title = bookId;
    let author = '未知';
    let coverUrl: string | undefined;
    let wordCount: number | undefined;
    let tags: string[] | undefined;
    let description: string | undefined;

    try {
      const metaUrl = `${baseUrl}/metadata.json`;
      const meta = await fetchJSON<RawMetadata>(metaUrl);
      title = meta.title || title;
      author = meta.author || author;
      coverUrl = meta.cover_url;
      tags = meta.tags;
      description = meta.description;
      if (meta.word_count) {
        const match = meta.word_count.match(/([\d.]+)/);
        if (match) wordCount = parseInt(match[1].replace(/[^\d]/g, ''), 10);
      }
    } catch (err) {
      console.warn('[WenkuAdapter] Failed to load metadata.json, using defaults:', err);
    }

    return {
      bookId,
      title,
      author,
      coverUrl,
      wordCount,
      tags,
      description,
      source,
    };
  }

  async getToc(source: BookSource): Promise<TocEntry[]> {
    const baseUrl = source.uri;

    let rawChapters: RawChapterMeta[];
    try {
      rawChapters = await fetchJSON<RawChapterMeta[]>(`${baseUrl}/chapters.json`);
    } catch (err) {
      throw new Error(
        `Failed to load chapters.json from ${baseUrl}. ` +
        `Ensure the crawler output exists at this path. Error: ${err}`
      );
    }

    if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
      throw new Error(`No chapters found in ${baseUrl}/chapters.json`);
    }

    // Group chapters by volume
    const volumeMap = new Map<string, RawChapterMeta[]>();
    for (const ch of rawChapters) {
      const volName = ch.volume || '未分类';
      if (!volumeMap.has(volName)) {
        volumeMap.set(volName, []);
      }
      volumeMap.get(volName)!.push(ch);
    }

    // Build TOC entries
    const entries: TocEntry[] = [];
    let order = 0;

    for (const [volName, chapters] of volumeMap) {
      const children: TocEntry[] = chapters.map((ch) => ({
        chapterId: String(ch.cid),
        title: ch.title,
        level: 1,
        order: order++,
      }));

      entries.push({
        chapterId: `v_${order}`, // volume-level ID (not navigable directly)
        title: volName,
        level: 0,
        children,
        order: order++,
      });
    }

    return entries;
  }

  async getChapterContent(
    source: BookSource,
    chapterId: string,
  ): Promise<ChapterContent> {
    const baseUrl = source.uri;
    const chapterUrl = `${baseUrl}/chapters/${chapterId}.json`;

    let raw: RawChapterContent;
    try {
      raw = await fetchJSON<RawChapterContent>(chapterUrl);
    } catch (err) {
      throw new Error(
        `Failed to load chapter ${chapterId} from ${chapterUrl}. Error: ${err}`
      );
    }

    return {
      chapterId: String(raw.cid),
      title: raw.title,
      content: raw.content,
      images: (raw.images || []).map((img: string, idx: number) => ({
        id: `img_${raw.cid}_${idx}`,
        url: img,
      })),
      prevChapterId: raw.prev_cid === 'index' ? undefined : raw.prev_cid,
      nextChapterId: raw.next_cid || undefined,
    };
  }

  private extractBookId(source: BookSource): string {
    const parts = source.uri.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'unknown';
  }
}
