/** 应用根组件 — 侧边栏布局 + 路由 */
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Dashboard from "./pages/Dashboard"
import Catalog from "./pages/Catalog"
import Downloads from "./pages/Downloads"
import Tasks from "./pages/Tasks"
import Logs from "./pages/Logs"
import { LayoutDashboard, Library, Download, Play, ScrollText } from "lucide-react"

/** 全局 QueryClient 实例 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

/** 导航项配置 */
const NAV_ITEMS = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/catalog", label: "全站目录", icon: Library },
  { to: "/downloads", label: "已下载", icon: Download },
  { to: "/tasks", label: "任务中心", icon: Play },
  { to: "/logs", label: "系统日志", icon: ScrollText },
]

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen bg-muted/30">
          {/* ── 侧边栏 ── */}
          <aside className="w-56 bg-card border-r flex flex-col shrink-0">
            <div className="p-4 border-b">
              <h1 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <span className="text-lg">📚</span> 爬虫管理
              </h1>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="p-4 border-t text-xs text-muted-foreground">
              wenku8.net 爬虫 v2
            </div>
          </aside>

          {/* ── 主内容区 ── */}
          <main className="flex-1 overflow-auto">
            <div className="max-w-6xl mx-auto p-6">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/catalog" element={<Catalog />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/logs" element={<Logs />} />
              </Routes>
            </div>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
