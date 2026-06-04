"""双模式 HTML 抓取器"""

from dataclasses import dataclass
from typing import Dict, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


@dataclass
class FetchResult:
    url: str
    status_code: int
    html: str
    content_length: int
    headers: Dict[str, str]


class RequestsFetcher:
    """基于 requests 的 HTTP 抓取器"""

    def __init__(self, cookies: Optional[Dict[str, str]] = None, timeout: int = 30):
        self.cookies = cookies or {}
        self.timeout = timeout
        self.session = self._build_session()

    def _build_session(self) -> requests.Session:
        session = requests.Session()

        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate",
        })

        if self.cookies:
            for key, value in self.cookies.items():
                session.cookies.set(key, value)

        return session

    def fetch(self, url: str) -> FetchResult:
        resp = self.session.get(url, timeout=self.timeout)
        resp.encoding = resp.apparent_encoding or "utf-8"
        return FetchResult(
            url=url,
            status_code=resp.status_code,
            html=resp.text,
            content_length=len(resp.content),
            headers=dict(resp.headers),
        )


class PlaywrightFetcher:
    """基于 Playwright 无头浏览器的抓取器"""

    def __init__(self, cookies: Optional[Dict[str, str]] = None, timeout: int = 30):
        self.cookies = cookies or {}
        self.timeout = timeout

    async def fetch(self, url: str) -> FetchResult:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )

            if self.cookies:
                from urllib.parse import urlparse
                from cookie_utils import to_playwright_cookies
                domain = urlparse(url).netloc
                pw_cookies = to_playwright_cookies(self.cookies, domain)
                await context.add_cookies(pw_cookies)

            page = await context.new_page()
            response = await page.goto(url, wait_until="networkidle", timeout=self.timeout * 1000)
            html = await page.content()

            status_code = response.status if response else 0
            headers = {}
            if response:
                headers = dict(response.headers)
            
            await browser.close()

        return FetchResult(
            url=url,
            status_code=status_code,
            html=html,
            content_length=len(html.encode("utf-8")),
            headers=headers,
        )
