/**
 * 路由参数类型定义。
 *
 * 集中管理所有路由的 URL 参数类型，
 * 供 useParams 和 useNavigate 使用。
 */

/** 各路由对应的参数类型 */
export interface RouteParams {
  /** 书籍详情页：/book/:bookId */
  BookDetail: { bookId: string };
  /** 阅读器页：/reader/:bookId */
  Reader: { bookId: string };
  /** 搜索页：/search?q=keyword */
  Search: { q?: string };
  /** 书库页：/library?category=X&status=Y */
  Library: { category?: string; status?: string };
}
