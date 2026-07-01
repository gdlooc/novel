/**
 * LibraryPage — 书库页。
 *
 * 从 crawler FastAPI 动态加载全站小说目录（site_novels 表，4123 本）。
 * 提供垂直分组筛选面板：完结状态 / 评分 / 题材标签，
 * 支持分页加载和 URL 参数同步。
 *
 * 数据流：
 *   1. 挂载时并行加载筛选选项 + 第一页数据
 *   2. 用户选择筛选条件 → URL 参数同步 → 重新请求
 *   3. 滚动到底部或点击「加载更多」→ 追加下一页
 *   4. 已下载小说可进入详情页
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLibraryStore } from '@store/libraryStore';
import { BookCard } from '@components/BookCard';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { ErrorView } from '@components/ErrorView';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import {
  fetchCatalog,
  fetchFilters,
  type CatalogNovel,
  type CatalogParams,
  type FilterOptions,
} from '@services/api/catalogApi';
import type { BookSource } from '@book/types';

// ─── 常量 ───

/** 每页加载数量 */
const PAGE_SIZE = 20;

/** 评分等级列表（预定义，不从 API 动态获取） */
const RATING_LEVELS = ['S', 'A', 'B', 'C', 'D'];

/** 下载状态选项 */
const DOWNLOAD_OPTIONS = [
  { label: '全部', value: '' },
  { label: '已下载', value: 'true' },
  { label: '未下载', value: 'false' },
];

// ─── 筛选组配置 ───

/** 筛选组的折叠状态 */
interface CollapsedGroups {
  status: boolean;
  downloaded: boolean;
  rating: boolean;
  tags: boolean;
}

// ─── 组件 ───

export const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setBookSource = useLibraryStore((s) => s.setBookSource);

  // ── 从 URL 读取筛选状态 ──
  const urlStatus = searchParams.get('status') || '';
  const urlDownloaded = searchParams.get('downloaded') || '';
  const urlRating = searchParams.get('rating') || '';
  const urlTags = searchParams.get('tags') || '';
  const urlTag = searchParams.get('tag'); // 兼容旧版 ?tag=xxx

  // 合并 tags 参数和 tag 参数
  const initialTags = urlTags || urlTag || '';

  // ── 数据状态 ──
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [novels, setNovels] = useState<CatalogNovel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 筛选组折叠状态 ──
  const [collapsed, setCollapsed] = useState<CollapsedGroups>({
    status: false, downloaded: true, rating: false, tags: false,
  });
  /** 移动端：筛选面板是否展开 */
  const [showMobileFilter, setShowMobileFilter] = useState(false);

  // ── 自定义源输入 ──
  const [customUrl, setCustomUrl] = useState('');

  // ── 当前激活的筛选条件 ──
  const activeStatus = urlStatus;
  const activeDownloaded = urlDownloaded;
  const activeRating = urlRating;
  const activeTags = initialTags;

  // ── 计算激活的筛选数量（用于移动端角标） ──
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeStatus) count++;
    if (activeDownloaded) count++;
    if (activeRating) count++;
    if (activeTags) count++;
    return count;
  }, [activeStatus, activeDownloaded, activeRating, activeTags]);

  // ── 加载筛选选项 ──
  useEffect(() => {
    fetchFilters()
      .then(setFilters)
      .catch(() => {
        // 静默失败：标签筛选不可用，但状态和评分仍可用
      });
  }, []);

  // ── 构建 API 查询参数 ──
  const buildParams = useCallback(
    (extraOffset = 0): CatalogParams => {
      const params: CatalogParams = { offset: extraOffset, limit: PAGE_SIZE };
      if (activeStatus) params.status = activeStatus;
      if (activeDownloaded) params.downloaded = activeDownloaded;
      if (activeRating) params.rating = activeRating;
      if (activeTags) params.tags = activeTags;
      return params;
    },
    [activeStatus, activeDownloaded, activeRating, activeTags],
  );

  // ── 加载第一页 ──
  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNovels([]);
    try {
      const params = buildParams(0);
      const result = await fetchCatalog(params);
      setNovels(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载书库失败');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  // ── 加载更多 ──
  const loadMore = useCallback(async () => {
    if (loadingMore || novels.length >= total) return;
    setLoadingMore(true);
    try {
      const params = buildParams(novels.length);
      const result = await fetchCatalog(params);
      setNovels((prev) => [...prev, ...result.items]);
    } catch (err) {
      console.warn('[LibraryPage] 加载更多失败:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, novels.length, total, buildParams]);

  // ── 筛选条件变更 → URL 同步 + 重新加载 ──
  useEffect(() => {
    loadFirstPage();
  }, [activeStatus, activeDownloaded, activeRating, activeTags]);

  // ── 更新筛选（同时更新 URL）──
  const updateFilter = useCallback(
    (key: string, value: string) => {
      const newParams = new URLSearchParams(searchParams);
      if (value) {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }
      // 清除 offset，回到第一页
      setSearchParams(newParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  /** 切换标签筛选（多选，逗号分隔） */
  const toggleTag = useCallback(
    (tag: string) => {
      const current = activeTags ? activeTags.split(',').map((t) => t.trim()) : [];
      const idx = current.indexOf(tag);
      let newValue: string;
      if (idx >= 0) {
        current.splice(idx, 1);
        newValue = current.join(',');
      } else {
        current.push(tag);
        newValue = current.join(',');
      }
      const newParams = new URLSearchParams(searchParams);
      if (newValue) {
        newParams.set('tags', newValue);
      } else {
        newParams.delete('tags');
      }
      setSearchParams(newParams, { replace: true });
    },
    [activeTags, searchParams, setSearchParams],
  );

  /** 清除所有筛选 */
  const clearAllFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // ── 书籍选择 ──
  const handleSelectBook = (novel: CatalogNovel) => {
    const bookId = String(novel.downloaded_aid!);
    const source: BookSource = {
      type: 'http-api',
      uri: `/api/books/${bookId}`,
      metadata: { bookId },
    };
    setBookSource(bookId, source);
    navigate(`/book/${bookId}`);
  };

  const handleCustomSource = () => {
    if (!customUrl.trim()) return;
    const source: BookSource = {
      type: 'wenku8',
      uri: customUrl.trim(),
      metadata: { bookId: customUrl.trim().split('/').pop() || 'custom' },
    };
    const bookId = source.metadata!.bookId as string;
    setBookSource(bookId, source);
    navigate(`/book/${bookId}`);
  };

  const toggleGroup = (group: keyof CollapsedGroups) => {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  // ─── 渲染：筛选面板组件 ───

  /** 筛选组包装器：标题 + 折叠按钮 + 内容 */
  const FilterGroup: React.FC<{
    title: string;
    group: keyof CollapsedGroups;
    children: React.ReactNode;
  }> = ({ title, group, children }) => (
    <div className="border-b border-border/50 pb-3 mb-3 last:border-b-0 last:pb-0 last:mb-0">
      <button
        onClick={() => toggleGroup(group)}
        className="flex items-center justify-between w-full text-left py-1 cursor-pointer"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {collapsed[group] ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {!collapsed[group] && <div className="mt-2">{children}</div>}
    </div>
  );

  /** 选项芯片：点击切换选中态 */
  const OptionChip: React.FC<{
    label: string;
    active: boolean;
    onClick: () => void;
  }> = ({ label, active, onClick }) => (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  /** 渲染筛选面板（桌面端和移动端共用） */
  const renderFilterPanel = () => (
    <div className="space-y-0">
      {/* ── 完结状态 ── */}
      <FilterGroup title="完结状态" group="status">
        <div className="flex flex-wrap gap-1.5">
          <OptionChip label="全部" active={!activeStatus} onClick={() => updateFilter('status', '')} />
          {filters?.statuses.map((s) => (
            <OptionChip key={s} label={s} active={activeStatus === s} onClick={() => updateFilter('status', activeStatus === s ? '' : s)} />
          ))}
        </div>
      </FilterGroup>

      {/* ── 下载状态 ── */}
      <FilterGroup title="下载状态" group="downloaded">
        <div className="flex flex-wrap gap-1.5">
          {DOWNLOAD_OPTIONS.map((opt) => (
            <OptionChip
              key={opt.value}
              label={opt.label}
              active={activeDownloaded === opt.value}
              onClick={() => updateFilter('downloaded', activeDownloaded === opt.value ? '' : opt.value)}
            />
          ))}
        </div>
      </FilterGroup>

      {/* ── 评分 ── */}
      <FilterGroup title="评分" group="rating">
        <div className="flex flex-wrap gap-1.5">
          <OptionChip label="全部" active={!activeRating} onClick={() => updateFilter('rating', '')} />
          {RATING_LEVELS.map((r) => (
            <OptionChip
              key={r}
              label={r}
              active={activeRating === r}
              onClick={() => updateFilter('rating', activeRating === r ? '' : r)}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          选择最低评级，如选「A」将同时显示 S 和 A 级作品
        </p>
      </FilterGroup>

      {/* ── 题材标签 ── */}
      <FilterGroup title="题材" group="tags">
        {filters ? (
          filters.tag_options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {filters.tag_options.map((tag) => {
                const selected = activeTags
                  .split(',')
                  .map((t) => t.trim())
                  .includes(tag.value);
                return (
                  <OptionChip
                    key={tag.value}
                    label={tag.label}
                    active={selected}
                    onClick={() => toggleTag(tag.value)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无可用的题材标签</p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">加载标签中...</p>
        )}
      </FilterGroup>
    </div>
  );

  // ─── 主渲染 ───

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* ── 页面标题栏 + 移动端筛选按钮 ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          书库
          {total > 0 && (
            <span className="text-[13px] font-normal text-muted-foreground">
              共 {total} 本
            </span>
          )}
        </h2>

        {/* 移动端：筛选按钮 */}
        <Button
          variant="outline"
          size="sm"
          className="lg:hidden"
          onClick={() => setShowMobileFilter(!showMobileFilter)}
        >
          <Filter className="w-3.5 h-3.5 mr-1" />
          筛选
          {activeFilterCount > 0 && (
            <Badge variant="default" className="ml-1 px-1 py-0 text-[10px] min-w-[18px] h-[18px] flex items-center justify-center">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* ── 激活的筛选标签（快速清除） ── */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 px-4 pb-2 flex-shrink-0 flex-wrap">
          <span className="text-[11px] text-muted-foreground mr-1">筛选:</span>
          {activeStatus && (
            <Badge variant="secondary" className="gap-0.5 cursor-pointer text-[11px]" onClick={() => updateFilter('status', '')}>
              {activeStatus}<X className="w-3 h-3" />
            </Badge>
          )}
          {activeDownloaded && (
            <Badge variant="secondary" className="gap-0.5 cursor-pointer text-[11px]" onClick={() => updateFilter('downloaded', '')}>
              {activeDownloaded === 'true' ? '已下载' : '未下载'}<X className="w-3 h-3" />
            </Badge>
          )}
          {activeRating && (
            <Badge variant="secondary" className="gap-0.5 cursor-pointer text-[11px]" onClick={() => updateFilter('rating', '')}>
              {activeRating}级以上<X className="w-3 h-3" />
            </Badge>
          )}
          {activeTags && activeTags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-0.5 cursor-pointer text-[11px]" onClick={() => toggleTag(tag)}>
              {tag}<X className="w-3 h-3" />
            </Badge>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-[11px] text-primary hover:underline ml-1"
          >
            清除全部
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* ── 左侧筛选面板（桌面端） ── */}
        <aside className="hidden lg:block w-[220px] flex-shrink-0 overflow-y-auto border-r border-border px-4 py-3">
          {renderFilterPanel()}
        </aside>

        {/* ── 移动端筛选面板（抽屉式弹出） ── */}
        {showMobileFilter && (
          <>
            <div
              className="lg:hidden fixed inset-0 z-40 bg-black/30"
              onClick={() => setShowMobileFilter(false)}
            />
            <aside className="lg:hidden fixed top-0 right-0 bottom-0 z-50 w-[260px] bg-background border-l border-border overflow-y-auto px-4 py-4 animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">筛选条件</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowMobileFilter(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {renderFilterPanel()}
            </aside>
          </>
        )}

        {/* ── 右侧内容区 ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
          {/* 加载中 */}
          {loading && <LoadingSpinner message="加载书库..." />}

          {/* 错误 */}
          {error && !loading && (
            <ErrorView message={error} onRetry={loadFirstPage} />
          )}

          {/* 小说列表 */}
          {!loading && !error && (
            <>
              <div className="flex flex-col gap-2">
                {novels.map((novel) => (
                  <BookCard
                    key={novel.data_source_aid}
                    title={novel.title}
                    author={novel.author || '未下载（元数据待获取）'}
                    coverUrl={novel.cover_url || undefined}
                    tags={
                      novel.tags && novel.tags.length > 0
                        ? novel.tags
                        : novel.is_downloaded
                          ? undefined
                          : ['未下载']
                    }
                    onClick={novel.is_downloaded ? () => handleSelectBook(novel) : undefined}
                  />
                ))}

                {novels.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <div className="text-5xl mb-3">📚</div>
                    <div className="text-sm">没有找到符合条件的书籍</div>
                    {activeFilterCount > 0 && (
                      <Button variant="link" size="sm" onClick={clearAllFilters}>
                        清除筛选条件
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* 加载更多 */}
              {novels.length < total && (
                <div className="text-center mt-4">
                  {loadingMore ? (
                    <LoadingSpinner message="加载更多..." />
                  ) : (
                    <Button variant="outline" onClick={loadMore}>
                      加载更多（{novels.length}/{total}）
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── 自定义源 ── */}
          <div className="mt-8 pt-5 border-t border-border">
            <h3 className="text-[13px] text-muted-foreground font-medium mb-2">自定义源</h3>
            <Input
              type="text"
              placeholder="输入书籍目录路径或 URL..."
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="mb-2"
            />
            <Button
              onClick={handleCustomSource}
              disabled={!customUrl.trim()}
              className="w-full"
            >
              打开
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
