/**
 * catalogApi — 目录 API 客户端。
 *
 * 与 crawler 的 FastAPI 服务通信，获取全站小说目录。
 * 开发环境通过 Vite 代理转发 /api 请求到 FastAPI（见 vite.config.ts），
 * 生产环境需将 FastAPI 与静态资源部署到同域。
 *
 * 端点对应：
 *   GET /api/catalog  → fetchCatalog()
 *   GET /api/books    → fetchDownloadedBooks()
 *
 * 使用方式：
 *   import { fetchCatalog } from '@services/api/catalogApi';
 *   const { items, total } = await fetchCatalog({ q: '校园', limit: 20 });
 */

// ─── 配置 ───
// Vite 代理将 /api/* 转发到 FastAPI，客户端只需请求同源路径。
// 参见 vite.config.ts → server.proxy。
const API_BASE = '/api';

/** 构造带查询参数的完整 URL */
function buildUrl(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

// ─── 类型定义 ───

/** 目录中单本小说的信息（site_novels + novels LEFT JOIN） */
export interface CatalogNovel {
  /** 源站小说 ID（wenku8） */
  data_source_aid: number;
  /** 小说标题 */
  title: string;
  /** 源站详情页 URL */
  url: string;
  /** 标签列表（已下载时从 novels 回填） */
  tags: string[];
  /** 连载状态：已完结 / 连载中 */
  status: string;
  /** 评级：S / A / B / C / D */
  rating: string;
  /** 是否已下载 */
  is_downloaded: boolean;
  /** 本站小说 ID（已下载时有效） */
  downloaded_aid: number | null;
  /** 作者（已下载时从 novels 表获取） */
  author: string | null;
  /** 封面 URL（已下载时从 novels 表获取） */
  cover_url: string | null;
  /** 总章节数（已下载时从 novels 表获取） */
  total_chapters: number | null;
  /** 字数统计（已下载时从 novels 表获取） */
  word_count: string | null;
  /** 简介（已下载时从 novels 表获取） */
  description: string | null;
}

/** /api/catalog 返回的分页响应 */
export interface CatalogResponse {
  /** 符合条件的总数 */
  total: number;
  /** 当前偏移 */
  offset: number;
  /** 每页数量 */
  limit: number;
  /** 当前页小说列表 */
  items: CatalogNovel[];
}

/** /api/books 返回的已下载小说摘要 */
export interface DownloadedBook {
  aid: number;
  data_source_aid: number;
  title: string;
  author: string;
  status: string;
  total_chapters: number;
  cover_url: string;
  tags: string[];
}

/** fetchCatalog 的查询参数 */
export interface CatalogParams {
  /** 标题搜索关键词 */
  q?: string;
  /** 标签筛选，逗号分隔（如 "校园,恋爱"） */
  tags?: string;
  /** 状态筛选 */
  status?: string;
  /** 评级筛选 */
  rating?: string;
  /** 下载状态：true=仅已下载, false=仅未下载 */
  downloaded?: string;
  /** 分页偏移 */
  offset?: number;
  /** 每页数量（最大 100） */
  limit?: number;
}

// ─── API 函数 ───

/**
 * 获取全站小说目录（支持搜索、筛选、分页）。
 *
 * @example
 * // 获取前 20 本
 * const result = await fetchCatalog({ limit: 20 });
 *
 * // 按标签和状态筛选
 * const result = await fetchCatalog({ tags: '校园,恋爱', status: '已完结' });
 *
 * // 标题搜索
 * const result = await fetchCatalog({ q: '女角' });
 */
export async function fetchCatalog(
  params: CatalogParams = {},
): Promise<CatalogResponse> {
  // 将非空参数转为字符串映射
  const searchParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams[key] = String(value);
    }
  });

  const url = buildUrl(`${API_BASE}/catalog`, searchParams);
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(
      `获取目录失败 (HTTP ${resp.status})。请确认 API 服务已启动`,
    );
  }

  return resp.json() as Promise<CatalogResponse>;
}

/**
 * 获取已下载的小说列表（novels 表）。
 * 用于只需要已下载小说的场景，数据比 catalog 更精简。
 */
export async function fetchDownloadedBooks(): Promise<DownloadedBook[]> {
  const resp = await fetch(`${API_BASE}/books`);

  if (!resp.ok) {
    throw new Error(
      `获取已下载列表失败 (HTTP ${resp.status})。请确认 API 服务已启动: ${API_BASE}`,
    );
  }

  return resp.json() as Promise<DownloadedBook[]>;
}
