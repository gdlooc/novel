"""小说书页解析器

解析 /book/{aid}.htm 页面，提取小说的完整元数据:
- 书名、作者、文库分类
- 文章状态（连载中/已完成）、最后更新日期、全文长度
- 作品标签、热度评级
- 内容简介
- 封面图 URL
- 最新章节信息

书页 HTML 结构:
<table>
  <tr><td>文库分类：MF文库J | 小说作者：衣笠彰梧 | 文章状态：连载中 | ...</td></tr>
</table>
"""

import re
from pathlib import Path
from typing import Dict, List, Optional

from bs4 import BeautifulSoup


class BookParser:
    """解析小说书页，提取完整元数据"""

    # ---------- 构造函数 ----------

    def __init__(self, html: str, url: str = ""):
        """
        Args:
            html: 书页 HTML 文本（GBK 解码后的 unicode 字符串）
            url: 书页 URL（例: https://www.wenku8.net/book/1973.htm）
        """
        self.html = html
        self.url = url
        self.soup = BeautifulSoup(html, "lxml")

        # 从 URL 中提取 aid
        self.aid = 0
        if url:
            m = re.search(r"/book/(\d+)\.htm", url)
            if m:
                self.aid = int(m.group(1))

    # ---------- 公共方法 ----------

    def parse(self) -> Dict:
        """执行完整解析，返回结构化数据

        Returns:
            {
                "aid": 1973,
                "title": "欢迎来到实力至上主义的教室",
                "author": "衣笠彰梧",
                "publisher": "MF文库J",
                "status": "连载中",
                "last_update": "2026-05-29",
                "word_count": "4674565字",
                "tags": ["校园", "智斗", "青春", "战斗", "群像"],
                "rating": "S级",
                "description": "真正的实力，平等究竟为何？...",
                "cover_url": "http://img.wenku8.com/image/1/1973/1973s.jpg",
                "last_chapter": {
                    "title": "第二十七卷 三年级篇 4 ...",
                    "url": "/novel/1/1973/175993.htm"
                },
                "is_completed": false
            }
        """
        return {
            "aid": self.aid or self._extract_aid(),
            "title": self._extract_title(),
            "author": self._extract_author(),
            "publisher": self._extract_publisher(),
            "status": self._extract_status(),
            "last_update": self._extract_last_update(),
            "word_count": self._extract_word_count(),
            "tags": self._extract_tags(),
            "rating": self._extract_rating(),
            "description": self._extract_description(),
            "cover_url": self._extract_cover_url(),
            "last_chapter": self._extract_last_chapter(),
            "is_completed": self._extract_is_completed(),
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

    # ---------- 私有方法：基本信息 ----------

    def _extract_title(self) -> str:
        """提取书名

        <title> 格式: "书名 - 作者 - 文库 - 轻小说文库"
        """
        title_el = self.soup.find("title")
        if title_el:
            parts = title_el.get_text(strip=True).split(" - ")
            if parts:
                return parts[0].strip()
        return ""

    def _extract_author(self) -> str:
        """提取作者名

        来源1: <title> 第二个 part
        来源2: info table 中的 小说作者
        """
        row = self._find_info_row()
        if row:
            m = re.search(r"小说作者[：:]\s*(.+?)(?:\s*[|｜]|$)", row)
            if m:
                return m.group(1).strip()

        # 兜底: 从 title
        title_el = self.soup.find("title")
        if title_el:
            parts = title_el.get_text(strip=True).split(" - ")
            if len(parts) >= 2:
                return parts[1].strip()
        return ""

    def _extract_publisher(self) -> str:
        """提取文库分类"""
        row = self._find_info_row()
        if row:
            m = re.search(r"文库分类[：:]\s*(.+?)(?:\s*[|｜]|$)", row)
            if m:
                return m.group(1).strip()
        return ""

    def _extract_status(self) -> str:
        """提取文章状态（连载中/已完成）"""
        row = self._find_info_row()
        if row:
            m = re.search(r"文章状态[：:]\s*(.+?)(?:\s*[|｜]|$)", row)
            if m:
                return m.group(1).strip()
        return ""

    def _extract_last_update(self) -> str:
        """提取最后更新日期"""
        row = self._find_info_row()
        if row:
            m = re.search(r"最后更新[：:]\s*(.+?)(?:\s*[|｜]|$)", row)
            if m:
                return m.group(1).strip()
        return ""

    def _extract_word_count(self) -> str:
        """提取全文长度"""
        row = self._find_info_row()
        if row:
            m = re.search(r"全文长度[：:]\s*(.+?)(?:\s*[|｜]|$)", row)
            if m:
                return m.group(1).strip()
        return ""

    # ---------- 私有方法：标签、热度、简介 ----------

    def _extract_tags(self) -> List[str]:
        """提取作品标签列表

        来源: info row 中的 '作品Tags：校园 智斗 青春 战斗 群像'
        """
        row = self._find_info_row()
        if row:
            # 匹配: 作品Tags：标签1 标签2 ... 作品热度
            m = re.search(r"作品Tags[：:]\s*(.+?)(?:\s*作品热度|$)", row)
            if m:
                # 去除末尾可能混入的 | 分隔符
                tags_text = m.group(1).strip().rstrip("|")
                # 去除可能混入的「Tags推荐」等干扰词
                tags = [t.strip().rstrip("|") for t in tags_text.split() if t.strip()]
                # 过滤明显不是标签的项（如纯数字、过长的文本）
                tags = [t for t in tags if len(t) <= 10 and not t.isdigit() and t not in ("Tags推荐",)]
                return tags

        # 兜底: 搜索页面中所有 tags.php 链接
        tag_links = self.soup.select('a[href*="tags.php"]')
        if tag_links:
            return [t.get_text(strip=True) for t in tag_links if t.get_text(strip=True)]
        return []

    def _extract_rating(self) -> str:
        """提取作品热度评级

        格式: "作品热度：S级（当前热度指数排名为：S级）"
        """
        row = self._find_info_row()
        if row:
            m = re.search(r"作品热度[：:]\s*(.+?)(?:\s*文章章节|$)", row)
            if m:
                rating_text = m.group(1).strip()
                # 简化: 提取前几个字作为评级
                simple = re.match(r"(\S+?级)", rating_text)
                if simple:
                    return simple.group(1)
                return rating_text[:20]
        return ""

    def _extract_description(self) -> str:
        """提取内容简介

        来源: info row 中的 '内容简介：xxx'
        """
        row = self._find_info_row()
        if row:
            m = re.search(r"内容简介[：:]\s*(.+)", row)
            if m:
                desc = m.group(1).strip()
                # 清理合并行引入的分隔符
                desc = desc.lstrip("|").replace(" | ", " ").replace("|", "")
                if len(desc) > 500:
                    desc = desc[:500] + "..."
                return desc
        return ""

    # ---------- 私有方法：封面、最新章节 ----------

    def _extract_cover_url(self) -> str:
        """提取封面图 URL

        来源: <img> 标签，src 包含 /image/
        URL 格式: http://img.wenku8.com/image/{group}/{aid}/{aid}s.jpg
        """
        img = self.soup.select_one('img[src*="/image/"]')
        if img:
            return img.get("src", "")
        return ""

    def _extract_last_chapter(self) -> Dict:
        """提取最新章节信息

        来源: 书页上指向章节正文的链接
        """
        link = self.soup.select_one('a[href*="/novel/"][href$=".htm"]')
        if link:
            return {
                "title": link.get_text(strip=True),
                "url": link.get("href", ""),
            }
        return {}

    def _extract_is_completed(self) -> bool:
        """判断小说是否已完结"""
        status = self._extract_status()
        return "完成" in status or "完结" in status or "全本" in status

    # ---------- 工具方法 ----------

    # 用于查找信息行的关键字
    _INFO_KEYWORDS = [
        "文库分类", "小说作者", "文章状态", "最后更新", "全文长度",
        "作品Tags", "作品热度", "文章章节", "内容简介",
    ]

    def _find_info_row(self) -> Optional[str]:
        """在页面中定位包含小说信息的所有数据行

        书页元数据分布在多个 <tr> 中（通常2行），用 | 合并返回
        """
        rows = []
        for tr in self.soup.select("table tr"):
            row_text = tr.get_text(separator="|", strip=True)
            if any(kw in row_text for kw in self._INFO_KEYWORDS):
                rows.append(row_text)
        if rows:
            # 用 | 合并各行，保持分隔符一致
            return " | ".join(rows)
        return None

    def _extract_aid(self) -> int:
        """从页面内容中提取 aid"""
        return self.aid


# ==================== 便捷函数 ====================

def parse_book_html(html: str, url: str = "") -> Dict:
    """便捷函数：直接解析书页 HTML 字符串"""
    return BookParser(html, url).parse()


def parse_book_file(filepath: str, url: str = "") -> Dict:
    """便捷函数：从文件读取并解析书页"""
    html = Path(filepath).read_text(encoding="utf-8")
    return BookParser(html, url).parse()
