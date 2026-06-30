/** 全站目录浏览 — 搜索 + 筛选 + 分页表格 + 单本下载 */
import { useState } from "react"
import { useCatalog, useTriggerSingleDownload } from "../api/client"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Badge, getRatingVariant } from "../components/ui/badge"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Search, ChevronLeft, ChevronRight, Loader2, Download } from "lucide-react"

const PAGE_SIZE = 30

const RATING_OPTIONS = [
  { value: "S", label: "S 级以上" },
  { value: "A", label: "A 级以上" },
  { value: "B", label: "B 级以上" },
  { value: "C", label: "C 级以上" },
]

const STATUS_OPTIONS = [
  { value: "已完结", label: "已完结" },
  { value: "连载中", label: "连载中" },
]

const DL_OPTIONS = [
  { value: "true", label: "已下载" },
  { value: "false", label: "未下载" },
]

export default function Catalog() {
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState("")
  const [rating, setRating] = useState("")
  const [status, setStatus] = useState("")
  const [downloaded, setDownloaded] = useState("")

  const downloadMutation = useTriggerSingleDownload()

  const { data, isLoading } = useCatalog({
    q: query || undefined,
    rating: rating || undefined,
    status: status || undefined,
    downloaded: downloaded || undefined,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">全站目录</h1>

      {/* ── 筛选栏 ── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="搜索书名..." value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
            </div>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={rating} onChange={(e) => { setRating(e.target.value); setPage(0) }}>
              <option value="">全部评级</option>
              {RATING_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={downloaded} onChange={(e) => { setDownloaded(e.target.value); setPage(0) }}>
              <option value="">全部</option>
              {DL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* ── 表格 ── */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-muted-foreground">
            {data ? `共 ${data.total.toLocaleString()} 本` : "加载中..."}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="py-3 px-4 font-medium">书名</th>
                    <th className="py-3 px-4 font-medium w-16">评级</th>
                    <th className="py-3 px-4 font-medium w-20">状态</th>
                    <th className="py-3 px-4 font-medium w-16">章节</th>
                    <th className="py-3 px-4 font-medium hidden md:table-cell">标签</th>
                    <th className="py-3 px-4 font-medium w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((novel) => (
                    <tr key={novel.data_source_aid} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4 font-medium">{novel.title}</td>
                      <td className="py-3 px-4">
                        {novel.rating ? <Badge variant={getRatingVariant(novel.rating)}>{novel.rating}</Badge> : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{novel.status || "-"}</td>
                      <td className="py-3 px-4 text-muted-foreground">{novel.total_chapters || "-"}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {novel.tags?.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {novel.is_downloaded ? (
                          <Badge variant="success">已下载</Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadMutation.mutate({ data_source_aid: novel.data_source_aid, concurrent: 3 })}
                            disabled={downloadMutation.isPending}
                          >
                            {downloadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── 分页 ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
