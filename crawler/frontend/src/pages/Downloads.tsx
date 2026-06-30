/** 已下载管理 — 已下载小说列表 + 章节预览 */
import { useState } from "react"
import { useBooks } from "../api/client"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Badge, getRatingVariant } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import ChapterPreview from "../components/ChapterPreview"
import { Download, BookOpen, Loader2 } from "lucide-react"

export default function Downloads() {
  const { data: books, isLoading } = useBooks()
  const [previewNovel, setPreviewNovel] = useState<{ id: number; title: string } | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">已下载小说</h1>
        <span className="text-sm text-muted-foreground">
          共 {books?.length ?? 0} 本
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {books?.map((book) => (
          <Card key={book.aid} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base leading-snug line-clamp-2">{book.title}</CardTitle>
                {book.tags.includes("S级") || book.tags.some(t => t.includes("S级")) ? null : null}
              </div>
              <p className="text-xs text-muted-foreground">{book.author}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={getRatingVariant(book.tags?.find(t => t.includes("级")) ?? "")}>{book.tags?.find(t => t.includes("级")) ?? "-"}</Badge>
                <Badge variant={book.status === "已完结" ? "success" : "info"}>{book.status}</Badge>
                <span className="text-xs text-muted-foreground">{book.total_chapters} 章</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {book.tags?.filter((t: string) => !t.includes("级")).slice(0, 4).map((t: string) => (
                  <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setPreviewNovel({ id: book.aid, title: book.title })}><BookOpen className="h-3.5 w-3.5 mr-1" /> 查看</Button>
                <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5 mr-1" /> 导出</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {books?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            暂无已下载小说，请先在「任务中心」触发下载
          </CardContent>
        </Card>
      )}

      {/* ── 章节预览侧边栏 ── */}
      {previewNovel && (
        <ChapterPreview
          novelId={previewNovel.id}
          title={previewNovel.title}
          onClose={() => setPreviewNovel(null)}
        />
      )}
    </div>
  )
}
