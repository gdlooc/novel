/** API 客户端 — fetch 封装 + TanStack Query hooks
 *
 * 所有 API 调用集中管理，通过 TanStack Query 提供自动缓存和刷新。
 */
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { DashboardStats, PaginatedResponse, SiteNovel, DownloadedBook, TaskStatus, ApiResponse } from "../types"

/** API 基础 URL（开发时由 Vite proxy 转发到 FastAPI） */
const BASE = "/api"

/** 通用 GET 请求 */
async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== null) url.searchParams.set(k, String(v))
    })
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json()
}

/** 通用 POST 请求 */
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json()
}

// ═══════════════════════════════════════════════════════════════
// TanStack Query Hooks
// ═══════════════════════════════════════════════════════════════

/** 全站目录查询（site_novels 表，支持筛选/分页） */
export function useCatalog(params?: {
  q?: string
  tags?: string
  status?: string
  rating?: string
  downloaded?: string
  offset?: number
  limit?: number
}) {
  return useQuery<PaginatedResponse<SiteNovel>>({
    queryKey: ["catalog", params],
    queryFn: () => get("/catalog", params as Record<string, string | number>),
    staleTime: 30_000,
  })
}

/** 已下载小说列表 */
export function useBooks() {
  return useQuery<DownloadedBook[]>({
    queryKey: ["books"],
    queryFn: () => get("/books"),
    staleTime: 60_000,
  })
}

/** 仪表盘统计数据 */
export function useStats() {
  return useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => get("/admin/stats"),
    refetchInterval: 30_000, // 每30秒自动刷新
  })
}

/** 运行中任务列表 */
export function useTasks() {
  return useQuery<TaskStatus[]>({
    queryKey: ["tasks"],
    queryFn: () => get("/admin/tasks"),
    refetchInterval: 10_000,
  })
}

/** SSE 实时任务订阅 — 替换轮询，实时推送 */
export function useTasksSSE() {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const es = new EventSource("/api/admin/events")
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.addEventListener("message", (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "tasks_updated") {
          qc.setQueryData(["tasks"], data.tasks as TaskStatus[])
        }
      } catch {}
    })

    return () => {
      es.close()
      setConnected(false)
    }
  }, [qc])

  return { connected }
}

/** 触发元数据扫描 */
export function useTriggerScan() {
  const qc = useQueryClient()
  return useMutation<ApiResponse<{task_id: string}>, Error, { top?: number; force?: boolean; concurrent?: number }>({
    mutationFn: (params) => post("/admin/scan", params),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }) },
  })
}

/** 触发批量下载 */
export function useTriggerDownload() {
  const qc = useQueryClient()
  return useMutation<ApiResponse<{task_id: string}>, Error, {
    min_rating?: string; status?: string; tags?: string; top?: number; concurrent?: number
  }>({
    mutationFn: (params) => post("/admin/download", params),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }) },
  })
}

/** 单本小说下载 */
export function useTriggerSingleDownload() {
  const qc = useQueryClient()
  return useMutation<ApiResponse<{task_id: string}>, Error, { data_source_aid: number; concurrent?: number }>({
    mutationFn: (params) => post("/admin/download/single", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.invalidateQueries({ queryKey: ["catalog"] })
    },
  })
}

/** 停止指定任务 */
export function useStopTask() {
  const qc = useQueryClient()
  return useMutation<ApiResponse<{}>, Error, string>({
    mutationFn: (taskId) => post(`/admin/tasks/${taskId}/stop`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }) },
  })
}
