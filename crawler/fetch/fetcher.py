"""HTML 抓取器（仅 Playwright 无头浏览器模式）

使用 Playwright + stealth 绕过 Cloudflare 防护。
"""

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class FetchResult:
    """抓取结果"""
    url: str
    status_code: int
    html: str
    content_length: int
    headers: Dict[str, str]


class PlaywrightFetcher:
    """基于 Playwright 无头浏览器的抓取器

    每次 fetch() 创建新的浏览器上下文，使用提供的 cookies。
    搭配 playwright-stealth 伪装可绕过 Cloudflare。
    """

    # 浏览器启动参数：隐藏自动化标志
    _LAUNCH_ARGS = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
    ]

    # 默认 User-Agent
    _USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    def __init__(self, cookies: Optional[Dict[str, str]] = None, timeout: int = 30):
        """
        Args:
            cookies: Cookie 字典
            timeout: 页面加载超时秒数
        """
        self.cookies = cookies or {}
        self.timeout = timeout

    async def fetch(self, url: str) -> FetchResult:
        """抓取页面 HTML

        Args:
            url: 目标页面 URL

        Returns:
            FetchResult，包含 HTML 内容、状态码等信息
        """
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            # 启动浏览器
            browser = await pw.chromium.launch(
                headless=True,
                args=self._LAUNCH_ARGS,
            )

            # 创建上下文，注入 cookies
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=self._USER_AGENT,
                locale="zh-CN",
            )

            # 注入 cookies
            if self.cookies:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc
                pw_cookies = []
                for key, value in self.cookies.items():
                    pw_cookies.append({
                        "name": key,
                        "value": value,
                        "domain": domain,
                        "path": "/",
                    })
                await context.add_cookies(pw_cookies)

            page = await context.new_page()

            # 启用 stealth 伪装
            try:
                from playwright_stealth import Stealth
                stealth = Stealth()
                await stealth.apply_stealth_async(page)
            except Exception:
                pass  # stealth 失败不阻塞

            # 访问页面
            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=self.timeout * 1000,
            )

            # 等待可能的内联脚本
            await page.wait_for_timeout(2000)

            html = await page.content()
            status_code = response.status if response else 0
            headers = dict(response.headers) if response else {}

            await browser.close()

        return FetchResult(
            url=url,
            status_code=status_code,
            html=html,
            content_length=len(html.encode("utf-8")),
            headers=headers,
        )
