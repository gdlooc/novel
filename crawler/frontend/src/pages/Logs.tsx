/** 日志查看器 — 实时查看爬虫运行日志 */
import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { RefreshCw, Loader2 } from "lucide-react"

interface LogResponse {
  logs: string[]
  files: { name: string; size: number; modified: string }[]
}

const BASE = "/api"

/** 日志级别颜色映射 */
const LEVEL_COLORS: Record<string, string> = {
  ERROR: "bg-red-100 text-red-700 border-red-200",
  WARNING: "bg-amber-100 text-amber-700 border-amber-200",
  INFO: "bg-blue-100 text-blue-700 border-blue-200",
  DEBUG: "bg-slate-100 text-slate-600 border-slate-200",
}

export default function Logs() {
  const [data, setData] = useState<LogResponse | null>(null)
  const [level, setLevel] = useState("")
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ lines: "300" })
      if (level) params.set("level", level)
      const res = await fetch(`${BASE}/admin/logs?${params}`)
      setData(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  // 首次加载 + 每 5 秒自动刷新
  useEffect(() => {
    fetchLogs()
    const timer = setInterval(fetchLogs, 5000)
    return () => clearInterval(timer)
  }, [level])

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [data?.logs, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">系统日志</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── 过滤栏 ── */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">过滤级别:</span>
        {["", "ERROR", "WARNING", "INFO", "DEBUG"].map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium border transition-colors ${
              level === l
                ? l ? LEVEL_COLORS[l] || "bg-primary text-primary-foreground" : "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {l || "全部"}
          </button>
        ))}
      </div>

      {/* ── 日志列表 ── */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">
            最近日志 ({data?.logs.length ?? 0} 条)
          </CardTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="h-3 w-3" />
              自动滚动
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="max-h-[60vh] overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {data?.logs.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground">暂无日志</p>
            ) : (
              <div className="divide-y divide-muted/30">
                {data?.logs.map((line, i) => (
                  <div key={i} className={`px-4 py-1.5 hover:bg-muted/30 transition-colors ${getLineClass(line)}`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 日志文件列表 ── */}
      {data?.files && data.files.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">日志文件</CardTitle></CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              {data.files.map((f) => (
                <div key={f.name} className="flex items-center justify-between">
                  <span className="font-mono text-xs">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** 根据日志行内容返回 CSS 类名 */
function getLineClass(line: string): string {
  if (line.includes("[ERROR]")) return "bg-red-50/50 text-red-800"
  if (line.includes("[WARNING]")) return "bg-amber-50/50 text-amber-800"
  return ""
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
