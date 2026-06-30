/** 章节预览面板 — 左侧章节目录 + 右侧正文内容 */
import { useState, useEffect } from "react"
import { X, FileText, Loader2 } from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"

interface Chapter {
  cid: number
  title: string
  volume: string
  completed: boolean
}

interface ChapterDetail {
  cid: number
  title: string
  content: string
  book_title: string
  has_images: boolean
}

interface Props {
  /** novels.id (本站 aid) */
  novelId: number
  title: string
  onClose: () => void
}

/** 后端 API base */
const BASE = "/api"

/** 获取章节列表 */
async function fetchChapters(novelId: number): Promise<Chapter[]> {
  const res = await fetch(`${BASE}/books/${novelId}/chapters`)
  if (!res.ok) throw new Error("获取章节列表失败")
  return res.json()
}

/** 获取单章内容 */
async function fetchChapter(novelId: number, cid: number): Promise<ChapterDetail> {
  const res = await fetch(`${BASE}/books/${novelId}/chapters/${cid}`)
  if (!res.ok) throw new Error("获取章节失败")
  return res.json()
}

export default function ChapterPreview({ novelId, title, onClose }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedCid, setSelectedCid] = useState<number | null>(null)
  const [chapterData, setChapterData] = useState<ChapterDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)

  // 加载章节列表
  useEffect(() => {
    fetchChapters(novelId)
      .then(setChapters)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [novelId])

  // 选择章节时加载内容
  const handleSelect = async (cid: number) => {
    setSelectedCid(cid)
    setContentLoading(true)
    try {
      const data = await fetchChapter(novelId, cid)
      setChapterData(data)
    } catch {
      setChapterData(null)
    } finally {
      setContentLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-3xl bg-background shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h2 className="font-semibold text-sm truncate flex-1">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* ── 左侧：章节目录 ── */}
          <div className="w-72 border-r overflow-y-auto shrink-0">
            {loading ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="p-2 space-y-0.5">
                {chapters.map((ch) => (
                  <button
                    key={ch.cid}
                    onClick={() => handleSelect(ch.cid)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedCid === ch.cid
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-3 w-3 shrink-0 opacity-50" />
                      <span className="truncate">{ch.title}</span>
                    </div>
                    {ch.volume && (
                      <span className="text-xs opacity-60 ml-5">{ch.volume}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── 右侧：正文内容 ── */}
          <div className="flex-1 overflow-y-auto p-6">
            {contentLoading ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : chapterData ? (
              <div>
                <h3 className="text-lg font-bold mb-4">{chapterData.title}</h3>
                {chapterData.has_images && <Badge variant="info" className="mb-3">含插图</Badge>}
                <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {chapterData.content}
                </div>
              </div>
            ) : selectedCid ? (
              <p className="text-muted-foreground text-sm">加载失败</p>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <FileText className="h-10 w-10 opacity-30" />
                <p className="text-sm">选择左侧章节查看正文</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
