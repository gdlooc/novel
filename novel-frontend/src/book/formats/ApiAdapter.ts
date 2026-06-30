/**
 * ApiAdapter — HTTP API 适配器（PostgreSQL 后端）。
 *
 * 通过 FastAPI 服务读取爬虫数据，替代本地 JSON 文件模式。
 *
 * API 端点（对应 WenkuAdapter 读取的文件结构）：
 *   GET {baseUrl}/metadata          → metadata.json 结构
 *   GET {baseUrl}/chapters           → chapters.json 结构
 *   GET {baseUrl}/chapters/{cid}     → 单章 JSON 结构
 *   GET /api/images/{novel_id}/{cid}/{filename}  → 插图（baseUrl 中提取 novel_id）
 *
 * BookSource 示例：
 *   type: 'http-api'
 *   uri: 'http://localhost:8080/api/books/1'
 */

import type { IBookFormat } from './IBookFormat';
import type {
  BookSource,
  BookMetadata,
  TocEntry,
  ChapterContent,
} from '../types';

// ─── API 返回的原始类型（与爬虫导出的 JSON 结构一致）───

interface ApiMetadata {
  aid: number;
  data_source?: number;
  data_source_name?: string;
  data_source_aid?: number;
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
}

interface ApiChapterMeta {
  cid: number;
  data_source_cid?: number;
  aid?: number;
  volume?: string;
  title: string;
  completed: boolean;
}

interface ApiChapterContent {
  cid: number;
  data_source_cid?: number;
  title: string;
  content: string;
  images?: Array<{
    url: string;
    filename: string;
    local_path: string;
    downloaded: boolean;
  }>;
  has_images?: boolean;
  prev_cid: number;
  next_cid: number;
}

// ─── 辅助函数 ───

/**
 * fetch 封装：同 WenkuAdapter 的 fetchJSON，增加错误处理。
 */
async function fetchJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      `Expected JSON but got HTML from ${url}. Is the API server running?`
    );
  }
  return resp.json() as Promise<T>;
}

// ─── 适配器 ───

export class ApiAdapter implements IBookFormat {
  readonly formatId = 'http-api';
  readonly formatName = 'HTTP API (PostgreSQL)';

  canHandle(source: BookSource): boolean {
    return source.type === 'http-api';
  }

  /** 从 baseUrl 中提取 novel_id（示例: http://localhost:8080/api/books/1 → 1） */
  private extractNovelId(source: BookSource): number {
    const parts = source.uri.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    return parseInt(last, 10) || 0;
  }

  async getMetadata(source: BookSource): Promise<BookMetadata> {
    const baseUrl = source.uri;

    let title = '';
    let author = '未知';
    let coverUrl: string | undefined;
    let wordCount: number | undefined;
    let tags: string[] | undefined;
    let description: string | undefined;

    try {
      const meta = await fetchJSON<ApiMetadata>(`${baseUrl}/metadata`);
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
      console.warn('[ApiAdapter] Failed to load metadata:', err);
    }

    return {
      bookId: String(this.extractNovelId(source)),
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

    let rawChapters: ApiChapterMeta[];
    try {
      rawChapters = await fetchJSON<ApiChapterMeta[]>(`${baseUrl}/chapters`);
    } catch (err) {
      throw new Error(
        `Failed to load chapters from ${baseUrl}/chapters. Error: ${err}`
      );
    }

    if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
      throw new Error(`No chapters found`);
    }

    // 按分卷分组（复用 WenkuAdapter 的 TOC 构建逻辑）
    const volumeMap = new Map<string, ApiChapterMeta[]>();
    for (const ch of rawChapters) {
      const volName = ch.volume || '未分类';
      if (!volumeMap.has(volName)) {
        volumeMap.set(volName, []);
      }
      volumeMap.get(volName)!.push(ch);
    }

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
        chapterId: `v_${order}`,
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
    const chapterUrl = `${baseUrl}/chapters/${chapterId}`;

    let raw: ApiChapterContent;
    try {
      raw = await fetchJSON<ApiChapterContent>(chapterUrl);
    } catch (err) {
      throw new Error(
        `Failed to load chapter ${chapterId} from ${chapterUrl}. Error: ${err}`
      );
    }

    // 将本地路径转为可通过代理访问的 URL
    // local_path 格式: "novels\\images\\6\\14\\1.jpg" → /api/images/6/14/1.jpg
    const images = (raw.images || []).map((img, idx) => {
      let url = img.url;
      if (img.local_path) {
        const normalized = img.local_path.replace(/\\/g, '/');
        const apiPath = normalized.replace(/^novels\//, '');
        url = `/api/${apiPath}`;
      }
      return {
        id: `img_${raw.cid}_${idx}`,
        url,
      };
    });

    return {
      chapterId: String(raw.cid),
      title: raw.title,
      content: raw.content,
      images,
      prevChapterId: raw.prev_cid ? String(raw.prev_cid) : undefined,
      nextChapterId: raw.next_cid ? String(raw.next_cid) : undefined,
    };
  }
}
