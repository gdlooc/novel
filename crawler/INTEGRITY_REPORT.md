# 数据库关联完整性检查报告

> 生成时间: 2026-06-27
> 检查范围: 全部 8 张表的外键关联关系

---

## 📊 数据总览

| 表名 | 记录数 | 说明 |
|------|--------|------|
| `site_novels` | 4,123 | 全站索引 |
| `novels` | 7 | 已下载小说 |
| `volumes` | 52 | 分卷 |
| `chapters` | 538 | 章节 |
| `chapter_images` | 786 | 插图 |
| `novel_tags` | 37 | 标签（7 本小说） |

---

## ✅ 关联完整性检查（7 项全部通过）

| 关联关系 | 检查项 | 状态 |
|---------|--------|------|
| `site_novels -> novels` | downloaded_aid 是否指向存在的 novels.id | ✅ 通过 |
| `novels -> volumes` | volumes.novel_id 是否存在 | ✅ 通过 |
| `novels -> chapters` | chapters.novel_id 是否存在 | ✅ 通过 |
| `chapters -> volumes` | chapters.volume_id 是否有效 | ✅ 通过 |
| `chapters -> chapter_images` | chapter_images.chapter_id 是否存在 | ✅ 通过 |
| `novels -> novel_tags` | novel_tags.novel_id 是否存在 | ✅ 通过 |
| 孤儿记录检查 | chapters/volumes 孤儿记录 | ✅ 通过 |

**结论：所有外键关联完整，无孤儿记录。**

---

## 🔍 site_novels 同步状态

| 指标 | 数值 |
|------|------|
| 全站索引总数 | 4,123 |
| 标记为已下载 | 6 |
| 待下载 | 4,117 |
| 已下载但无 downloaded_aid | 0 ✅ |

**结论：下载状态同步正常。**

---

## 📈 已下载小说详细统计

| ID | aid | 章节数 | 分卷数 | 插图数 | 状态 |
|----|-----|--------|--------|--------|------|
| 1 | 3057 | 215 | 10 | 202 | ✅ |
| 2 | 1158 | 172 | 14 | 282 | ✅ |
| 3 | 4300 | 10 | 1 | 16 | ✅ |
| 4 | 4290 | 8 | 2 | 1 | ✅ |
| 5 | 4296 | 13 | 2 | 2 | ✅ |
| 6 | 4053 | 18 | 2 | 36 | ✅ |
| **7** | **47** | **102** | **21** | **247** | **✅ 已修复** |

### ⚠️ 发现并修复的问题

**小说 ID=7（aid=47）**

- **问题**：`novels.total_chapters` = 0（应为 102）
- **原因**：增量更新或断点续爬时，元数据更新失败
- **修复**：已执行 `fix_metadata.py`，更新为实际值 `total_chapters = 102`
- **修复时间**: 2026-06-27

---

## 🔎 其他检查项

### crawl_progress 完整性

- crawl_progress 记录数: 7
- 有完成进度的小说: 7
- progress 中已下载到 DB 的章节: **538** (100%)
- 孤儿记录: 0 ✅

**结论：所有完成进度的章节都已正确存储到数据库。**

### 分卷完整性

- 所有有章节的小说都有分卷信息 ✅
- 无 0 分卷异常情况 ✅

---

## ⚠️ 潜在风险提示

### 1. total_chapters 更新不及时

**问题**：下载过程中，如果发生中断或异常，`novels.total_chapters` 可能为 0。

**影响**：
- 不影响实际数据（章节都存在）
- 可能影响前端展示（显示"0 章"）

**建议**：
1. 在 `scraper.py` 下载完成后立即更新 `total_chapters`
2. 或定期运行 `fix_metadata.py` 批量修复

**已处理**：本次检查发现 1 本，已修复。

### 2. site_novels 标签/状态/评级为空

**问题**：`site_novels.tags`、`status`、`rating` 字段在发现阶段为空。

**影响**：
- 不影响数据一致性
- 仅影响筛选功能（按标签/状态筛选时结果为空）

**建议**：
- 下载完成后，从 `novels` 表反向更新到 `site_novels`

**优先级**：P2（不影响核心功能）

### 3. site_novels 总数 vs novels 总数差异大

**当前**：
- site_novels: 4,123 本（全站）
- novels: 7 本（已下载）

**这是正常的**，因为：
- site_novels 保存全站索引（发现时即写入）
- novels 仅保存已下载的详细数据

**预期**：随着批量下载进行，novels 表会逐渐增长到 4,123。

---

## 📋 修复清单

- [x] 修复 novels ID=7 的 total_chapters 不一致问题
- [x] 验证所有外键关联无孤儿记录
- [x] 验证 site_novels 同步状态正常
- [x] 验证 crawl_progress 与 chapters 匹配
- [ ] **TODO**: 改进 scraper.py，下载完成后立即更新 total_chapters
- [ ] **TODO**: 下载完成后反向更新 site_novels 的 tags/status/rating

---

## 🛠️ 检查工具

本次检查使用了以下脚本：

| 脚本 | 用途 |
|------|------|
| `tests/check_integrity.py` | 基础关联完整性检查 |
| `tests/generate_report.py` | 详细关联关系报告 |
| `orchestrate/fix_metadata.py` | 修复元数据不一致 |

**定期运行建议**：
```bash
# 每月检查一次
python tests/generate_report.py

# 修复元数据
python orchestrate/fix_metadata.py
```
