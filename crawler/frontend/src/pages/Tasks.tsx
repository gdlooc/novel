/** 任务管理 — 触发扫描/下载 + 任务状态监控 */
import { useState } from "react"
import { useTasks, useTasksSSE, useTriggerScan, useTriggerDownload, useStopTask } from "../api/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Badge } from "../components/ui/badge"
import { Progress } from "../components/ui/progress"
import { Square, RefreshCw, Loader2, Search, Download } from "lucide-react"

export default function Tasks() {
  const { data: tasks } = useTasks()
  const { connected: sseConnected } = useTasksSSE()  // 自动订阅 SSE 更新
  const scanMutation = useTriggerScan()
  const downloadMutation = useTriggerDownload()
  const stopMutation = useStopTask()

  // 扫描参数
  const [scanTop, setScanTop] = useState(100)
  const [scanConcurrent, setScanConcurrent] = useState(5)

  // 下载参数
  const [dlRating, setDlRating] = useState("S")
  const [dlStatus, setDlStatus] = useState("")
  const [dlTop, setDlTop] = useState(10)
  const [dlConcurrent, setDlConcurrent] = useState(3)

  const runningTasks = tasks?.filter((t) => t.status === "running") ?? []
  const isScanning = scanMutation.isPending
  const isDownloading = downloadMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">任务中心</h1>
        <span className={`text-xs ${sseConnected ? "text-emerald-500" : "text-muted-foreground"}`}>
          {sseConnected ? "● 实时" : "○ 离线"}
        </span>
      </div>

      {/* ── 运行中任务 ── */}
      {runningTasks.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              运行中任务
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runningTasks.map((task) => (
              <div key={task.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{task.label}</p>
                    <p className="text-xs text-muted-foreground">{task.detail}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => stopMutation.mutate(task.id)} disabled={stopMutation.isPending}>
                    <Square className="h-3 w-3 mr-1" /> 停止
                  </Button>
                </div>
                <Progress value={task.progress} />
                <p className="text-xs text-muted-foreground">{task.progress}%</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 元数据扫描 ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4" /> 元数据扫描</CardTitle>
            <CardDescription>请求书页提取评分/标签/状态，回填 site_novels 表</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">扫描数量</label>
                <Input type="number" value={scanTop} onChange={(e) => setScanTop(Number(e.target.value))} min={10} max={5000} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">并发数</label>
                <Input type="number" value={scanConcurrent} onChange={(e) => setScanConcurrent(Number(e.target.value))} min={1} max={10} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => scanMutation.mutate({ top: scanTop, concurrent: scanConcurrent })} disabled={isScanning} className="flex-1">
                {isScanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />} 扫描
              </Button>
              <Button variant="outline" onClick={() => scanMutation.mutate({ force: true, top: scanTop, concurrent: scanConcurrent })} disabled={isScanning}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {scanMutation.error && <p className="text-xs text-red-500">{(scanMutation.error as Error).message}</p>}
            {scanMutation.data && <p className="text-xs text-emerald-600">任务已启动</p>}
          </CardContent>
        </Card>

        {/* ── 批量下载 ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Download className="h-4 w-4" /> 批量下载</CardTitle>
            <CardDescription>按条件筛选并下载小说到数据库</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">最低评分</label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={dlRating} onChange={(e) => setDlRating(e.target.value)}>
                  <option value="S">S 级</option><option value="A">A 级</option><option value="B">B 级</option><option value="C">C 级</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">状态</label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={dlStatus} onChange={(e) => setDlStatus(e.target.value)}>
                  <option value="">全部</option><option value="已完结">已完结</option><option value="连载中">连载中</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">下载数量</label>
                <Input type="number" value={dlTop} onChange={(e) => setDlTop(Number(e.target.value))} min={1} max={1000} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">并发数</label>
                <Input type="number" value={dlConcurrent} onChange={(e) => setDlConcurrent(Number(e.target.value))} min={1} max={10} />
              </div>
            </div>
            <Button onClick={() => downloadMutation.mutate({ min_rating: dlRating, status: dlStatus || undefined, top: dlTop, concurrent: dlConcurrent })} disabled={isDownloading} className="w-full">
              {isDownloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} 开始下载
            </Button>
            {downloadMutation.error && <p className="text-xs text-red-500">{(downloadMutation.error as Error).message}</p>}
            {downloadMutation.data && <p className="text-xs text-emerald-600">任务已启动</p>}
          </CardContent>
        </Card>
      </div>

      {/* ── 历史任务 ── */}
      {tasks && tasks.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">历史任务</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left"><th className="py-2 px-3 font-medium">任务</th><th className="py-2 px-3 font-medium">类型</th><th className="py-2 px-3 font-medium">状态</th><th className="py-2 px-3 font-medium">进度</th></tr></thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id} className="border-b last:border-0">
                      <td className="py-2 px-3">{task.label}</td>
                      <td className="py-2 px-3">{task.type === "scan" ? "扫描" : "下载"}</td>
                      <td className="py-2 px-3">
                        <Badge variant={task.status === "running" ? "info" : task.status === "completed" ? "success" : "destructive"}>
                          {task.status === "running" ? "运行中" : task.status === "completed" ? "已完成" : "失败"}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 w-40"><Progress value={task.progress} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
