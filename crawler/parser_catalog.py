"""小说目录页解析器

解析 /novel/{group}/{aid}/index.htm 页面，提取：
- 小说名、作者
- 卷名与章节列表（cid、标题、URL）

HTML 结构参考:
<table class="css">
  <tr><td class="vcss" colspan="4" vid="69566">第一卷</td></tr>
  <tr>
    <td class="ccss"><a href="69567.htm">章节标题</a></td>
    ...
  </tr>
</table>
"""

import re
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag


class CatalogParser:
    """解析小说目录页，提取分卷章节列表"""

    # ---------- 构造函数 ----------

    def __init__(self, html: str, base_url: str = ""):
        """
        Args:
            html: 目录页 HTML 文本（可以是 GBK 原始字节 decode 后的字符串）
            base_url: 页面完整 URL，用于将相对链接转为绝对链接
                      例: https://www.wenku8.net/novel/1/1973/index.htm
        """
        self.html = html
        self.base_url = base_url
        # 网站使用 GBK 编码，但 BeautifulSoup 需要 unicode 字符串
        # 如果传入的是 bytes，调用方需先 .decode('gbk')
        self.soup = BeautifulSoup(html, "lxml")

    # ---------- 公共方法 ----------

    def parse(self) -> Dict:
        """执行完整解析，返回结构化数据

        Returns:
            {
                "title": "欢迎来到实力至上主义的教室",
                "author": "衣笠彰梧",
                "volumes": [
                    {
                        "name": "第一卷",
                        "vid": 69566,          # 该卷第一个章节的 cid
                        "chapters": [
                            {
                                "cid": 69567,
                                "title": "KEYWORDS",
                                "url": "https://www.wenku8.net/novel/1/1973/69567.htm"
                            },
                            ...
                        ]
                    },
                    ...
                ]
            }
        """
        return {
            "title": self._extract_title(),
            "author": self._extract_author(),
            "volumes": self._extract_volumes(),
        }

    def to_json(self, filepath: str):
        """解析并输出为 JSON 文件"""
        import json
        result = self.parse()
        Path(filepath).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return result

    # ---------- 私有方法：提取基本信息 ----------

    def _extract_title(self) -> str:
        """从 #title 元素提取小说名"""
        # 目录页标题在 <div id="title"> 中
        title_el = self.soup.select_one("#title")
        if title_el:
            return title_el.get_text(strip=True)

        # 兜底：从 <title> 标签取（格式: 书名-作者-文库-轻小说文库）
        page_title = self.soup.find("title")
        if page_title:
            full = page_title.get_text(strip=True)
            # 取第一个 - 之前的部分作为书名
            return full.split("-")[0].strip()

        return ""

    def _extract_author(self) -> str:
        """从 #info 元素提取作者名"""
        # 目录页作者在 <div id="info">作者：xxx</div> 中
        info_el = self.soup.select_one("#info")
        if info_el:
            text = info_el.get_text(strip=True)
            # 格式: "作者：衣笠彰梧"
            if "：" in text:
                return text.split("：", 1)[-1].strip()
            return text.strip()

        # 兜底：从 <title> 取（格式: 书名-作者-文库-轻小说文库）
        page_title = self.soup.find("title")
        if page_title:
            parts = page_title.get_text(strip=True).split("-")
            if len(parts) >= 2:
                return parts[1].strip()

        return ""

    # ---------- 私有方法：提取章节列表 ----------

    def _extract_volumes(self) -> List[Dict]:
        """从 table.css 提取分卷章节列表

        解析逻辑:
        1. 找到 <table class="css">
        2. 遍历所有 <tr>:
           - td.vcss → 新卷开始（也可能表示插图/番外）
           - td.ccss > a → 章节链接（href 为相对路径 {cid}.htm）
        """
        # 定位章节表格: <table class="css">
        table = self.soup.select_one("table.css")
        if not table:
            return []

        volumes = []                           # 所有卷
        current_volume = None                   # 当前卷
        current_chapters = []                   # 当前卷的章节列表

        for row in table.find_all("tr"):
            # --- 检查是否是卷标题行 ---
            # <td class="vcss" colspan="4" vid="69566">第一卷</td>
            volume_cell = row.select_one("td.vcss")
            if volume_cell:
                # 如果之前有卷数据，先保存
                if current_volume is not None and current_chapters:
                    current_volume["chapters"] = current_chapters
                    volumes.append(current_volume)

                # 开始新卷
                vid = volume_cell.get("vid", "")    # 该卷第一个章节的 cid
                current_volume = {
                    "name": volume_cell.get_text(strip=True),
                    "vid": int(vid) if vid else 0,
                }
                current_chapters = []
                continue

            # --- 检查是否是章节链接行 ---
            # <td class="ccss"><a href="69567.htm">章节标题</a></td>
            chapter_cells = row.select("td.ccss")
            if not chapter_cells:
                continue

            for cell in chapter_cells:
                link = cell.find("a")
                if not link:
                    continue

                href = link.get("href", "").strip()
                title = link.get_text(strip=True)
                if not href or not title:
                    continue

                # 将相对路径补全为绝对 URL
                full_url = urljoin(self.base_url, href)

                # 从 href 提取 cid（去掉 .htm 后缀）
                cid_str = href.replace(".htm", "")
                # cid 可能含路径前缀，只取文件名部分
                if "/" in cid_str:
                    cid_str = cid_str.rsplit("/", 1)[-1]

                try:
                    cid = int(cid_str)
                except ValueError:
                    cid = 0

                current_chapters.append({
                    "cid": cid,
                    "title": title,
                    "url": full_url,
                })

        # 保存最后一个卷
        if current_volume is not None and current_chapters:
            current_volume["chapters"] = current_chapters
            volumes.append(current_volume)

        # 如果表格中没有卷标题（只有一个大卷），把章节放到默认卷
        # 但 current_volume 为 None，说明没有 vcss 行，章节直接挂在表下
        if not volumes and current_chapters:
            volumes.append({
                "name": "正文",
                "vid": current_chapters[0]["cid"] if current_chapters else 0,
                "chapters": current_chapters,
            })

        return volumes


# ==================== 便捷函数 ====================

def parse_catalog_html(html: str, base_url: str = "") -> Dict:
    """便捷函数：直接解析目录页 HTML 字符串"""
    return CatalogParser(html, base_url).parse()


def parse_catalog_file(filepath: str, base_url: str = "") -> Dict:
    """便捷函数：从文件读取并解析目录页"""
    html = Path(filepath).read_text(encoding="utf-8")
    return CatalogParser(html, base_url).parse()
