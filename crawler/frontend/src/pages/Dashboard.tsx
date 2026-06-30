/** 仪表盘首页 — 统计概览 + 评分分布 + 最近下载 */
import { useStats, useTasksSSE } from "../api/client"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Progress } from "../components/ui/progress"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import { BookOpen, Download, Star, FileText, Loader2 } from "lucide-react"

/** 评分饼图颜色映射 */
const RATING_COLORS: Record<string, string> = {
  "S级": "#ef4444", "A级": "#f97316", "B级": "#eab308",
  "C级": "#22c55e", "D级": "#06b6d4", "E级": "#94a3b8",
}

export default function Dashboard() {
  const { data: stats, isLoading } = useStats()
  const { connected: sseConnected } = useTasksSSE()

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // 评分分布 → 饼图数据
  const pieData = Object.entries(stats.rating_distribution).map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>

      {/* ── 统计卡片 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<BookOpen className="h-5 w-5" />} label="全站索引" value={stats.site_total.toLocaleString()} color="text-blue-600" bg="bg-blue-50" />
        <StatCard icon={<Download className="h-5 w-5" />} label="已下载" value={stats.downloaded.toLocaleString()} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard icon={<Star className="h-5 w-5" />} label="S级小说" value={stats.s_rated.toLocaleString()} color="text-red-600" bg="bg-red-50" />
        <StatCard icon={<FileText className="h-5 w-5" />} label="总章节数" value={stats.total_chapters.toLocaleString()} color="text-purple-600" bg="bg-purple-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 评分分布饼图 ── */}
        <Card>
          <CardHeader><CardTitle>评分分布</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name} ${value}`}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={RATING_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── 状态分布 + 进度 ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>下载进度</CardTitle>
              <span className={`text-xs ${sseConnected ? "text-emerald-500" : "text-muted-foreground"}`}>
                {sseConnected ? "● 实时" : "○ 离线"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>整体进度</span>
                <span className="text-muted-foreground">
                  {stats.downloaded} / {stats.site_total}
                </span>
              </div>
              <Progress value={(stats.downloaded / stats.site_total) * 100} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2"><Badge variant="info">连载中</Badge> {stats.status_distribution["连载中"] ?? 0}</div>
              <div className="flex items-center gap-2"><Badge variant="success">已完结</Badge> {stats.status_distribution["已完结"] ?? 0}</div>
            </div>

            {/* ── 实时任务状态 ── */}
            {stats.download_progress && (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在下载: {stats.download_progress.current_novel}
                </div>
                <Progress value={(stats.download_progress.completed / stats.download_progress.total) * 100} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{stats.download_progress.completed} / {stats.download_progress.total}</span>
                  <span>预计剩余: {formatETA(stats.download_progress.eta_seconds)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 最近下载 ── */}
      <Card>
        <CardHeader><CardTitle>最近下载</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="py-2 px-3 font-medium">书名</th><th className="py-2 px-3 font-medium">章节</th><th className="py-2 px-3 font-medium">标签</th></tr></thead>
              <tbody>
                {stats.recent_downloads.map((book) => (
                  <tr key={book.aid} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 px-3">{book.title}</td>
                    <td className="py-2 px-3">{book.total_chapters}</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {book.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: string; color: string; bg: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-2 rounded-lg ${bg} ${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** 格式化 ETA 秒数为可读字符串 */
function formatETA(seconds: number): string {
  if (seconds <= 0) return "即将完成"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
