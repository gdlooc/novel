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

// ─── Raw data types matching crawler output (v2 format) ───

/** Raw metadata.json from crawler (v2: 本站 ID + 源站引用) */
interface RawMetadata {
  aid: number;                    // 本站小说 ID
  data_source?: number;           // 数据来源站 ID
  data_source_name?: string;      // 数据来源站名
  data_source_aid?: number;       // 数据来源站的小说 ID
  title: string;
  author: string;
  publisher?: string;
  status?: string;
  is_completed?: boolean;
  last_update?: string;
  word_count?: string;
  tags?: string[];
  rating?: string;
  description?: string;
  cover_url?: string;
  total_chapters?: number;
  completed_chapters?: number;
  failed_chapters?: number;
  data_source_failed_cids?: number[];     // 源站失败章节 ID
  data_source_catalog_url?: string;       // 源站目录页 URL
  data_source_book_url?: string;          // 源站书页 URL
}

/** Raw chapters.json entry from crawler (v2) */
interface RawChapterMeta {
  cid: number;                    // 本站章节 ID
  data_source_cid?: number;       // 源站章节 ID
  aid?: number;                   // 本站小说 ID
  data_source_aid?: number;       // 源站小说 ID
  volume: string;
  title: string;
  data_source_chapter_url?: string;  // 源站章节页 URL（v2）
  url?: string;                      // 旧格式兼容
  completed: boolean;
}

/** Raw chapter content JSON from crawler (v2) */
interface RawChapterContent {
  cid: number;                    // 本站章节 ID
  data_source_cid?: number;       // 源站章节 ID
  aid?: number;                   // 本站小说 ID
  data_source_aid?: number;       // 源站小说 ID
  data_source?: number;           // 数据来源站 ID
  data_source_name?: string;      // 数据来源站名
  title: string;
  book_title?: string;
  content: string;
  images?: Array<{url: string; filename: string; local_path: string; downloaded: boolean}>;
  has_images?: boolean;
  // v2: 导航 ID 已翻译为本站 cid
  prev_cid?: number;
  next_cid?: number;
  // v2: 源站引用保留字段
  data_source_prev_cid?: string;
  data_source_next_cid?: string;
  data_source_index_url?: string;
  // 旧格式兼容
  prev_cid_legacy?: string;
  next_cid_legacy?: string;
  index_url?: string;
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
    // 优先从 metadata 读取本站 aid，回退到 URI 末段
    let bookId = (source.metadata?.bookId as string) || this.extractBookId(source);

    let title = bookId;
    let author = '未知';
    let coverUrl: string | undefined;
    let wordCount: number | undefined;
    let tags: string[] | undefined;
    let description: string | undefined;

    try {
      const metaUrl = `${baseUrl}/metadata.json`;
      const meta = await fetchJSON<RawMetadata>(metaUrl);
      // 使用本站 aid 作为 bookId
      bookId = String(meta.aid || bookId);
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

    // 处理图片：兼容新旧格式，将本地路径转为可访问 URL
    const images = (raw.images || []).map((img, idx: number) => {
      if (typeof img === 'string') {
        return { id: `img_${raw.cid}_${idx}`, url: img };
      }
      // 优先使用 local_path → 转为 /api/images/... URL
      let url = img.url || '';
      if (img.local_path) {
        const normalized = img.local_path.replace(/\\/g, '/');
        const apiPath = normalized.replace(/^novels\//, '');
        url = `/api/${apiPath}`;
      }
      return { id: `img_${raw.cid}_${idx}`, url };
    });

    // 导航 ID：优先使用 v2 的 prev_cid/next_cid（本站 ID），回退到旧格式
    const prevCid = raw.prev_cid ?? (raw.data_source_prev_cid ? parseInt(raw.data_source_prev_cid, 10) || 0 : 0);
    const nextCid = raw.next_cid ?? (raw.data_source_next_cid ? parseInt(raw.data_source_next_cid, 10) || 0 : 0);

    return {
      chapterId: String(raw.cid),
      title: raw.title,
      content: raw.content,
      images,
      prevChapterId: prevCid ? String(prevCid) : undefined,
      nextChapterId: nextCid ? String(nextCid) : undefined,
    };
  }

  private extractBookId(source: BookSource): string {
    const parts = source.uri.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'unknown';
  }
}
