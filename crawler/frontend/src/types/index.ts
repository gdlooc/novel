/** 全站目录小说条目 */
export interface SiteNovel {
  data_source_aid: number
  title: string
  url: string
  tags: string[]
  status: string
  rating: string
  is_downloaded: boolean
  downloaded_aid: number | null
  author?: string
  cover_url?: string
  total_chapters?: number
  word_count?: string
  description?: string
}

/** 已下载小说条目 */
export interface DownloadedBook {
  aid: number
  data_source_aid: number
  title: string
  author: string
  status: string
  total_chapters: number
  cover_url: string
  tags: string[]
}

/** 仪表盘统计数据 */
export interface DashboardStats {
  site_total: number
  downloaded: number
  s_rated: number
  total_chapters: number
  rating_distribution: Record<string, number>
  status_distribution: Record<string, number>
  recent_downloads: DownloadedBook[]
  download_progress: DownloadProgress | null
}

/** 下载任务进度 */
export interface DownloadProgress {
  task_id: string
  target: string
  completed: number
  total: number
  current_novel: string
  eta_seconds: number
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  total: number
  offset: number
  limit: number
  items: T[]
}

/** 任务状态 */
export interface TaskStatus {
  id: string
  type: 'scan' | 'download'
  status: 'running' | 'completed' | 'failed'
  label: string
  progress: number  // 0-100
  detail: string
  created_at: string
}

/** API 响应包装 */
export interface ApiResponse<T> {
  ok: boolean
  data?: T
  message?: string
}
