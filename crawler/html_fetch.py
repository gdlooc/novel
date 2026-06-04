#!/usr/bin/env python3
"""HTML 抓取器"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

from cookie_utils import parse_cookie_string
from fetcher import FetchResult, PlaywrightFetcher, RequestsFetcher


def ensure_dependencies(browser_mode: bool = False):
    """检查并提示安装依赖"""
    missing = []
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    try:
        import bs4  # noqa: F401
    except ImportError:
        missing.append("beautifulsoup4")
    if browser_mode:
        try:
            import playwright  # noqa: F401
        except ImportError:
            missing.append("playwright")

    if missing:
        print(f"[!] 缺少依赖: {', '.join(missing)}")
        print(f"[!] 请运行: pip install -r requirements.txt")
        if "playwright" in missing:
            print("[!] 安装 playwright 后还需运行: playwright install chromium")
        sys.exit(1)


def ensure_playwright_browser():
    """确保 Chromium 浏览器已安装"""
    import subprocess
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            browser.close()
    except Exception:
        print("[!] Playwright 浏览器未安装，正在安装 chromium...")
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        print("[+] Chromium 安装完成")


def install_dependencies():
    """自动安装所有依赖"""
    import subprocess
    req_path = Path(__file__).parent / "requirements.txt"
    print(f"[*] 安装依赖: {req_path}")
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(req_path)], check=True)
    print("[*] 安装 Playwright 浏览器...")
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
    print("[+] 安装完成")


def save_html(html: str, url: str, output_dir: str) -> str:
    """保存 HTML 到文件"""
    from urllib.parse import urlparse

    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)

    parsed = urlparse(url)
    safe_name = parsed.netloc.replace(":", "_") + parsed.path.replace("/", "_") or "index"
    safe_name = safe_name[:100]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"{safe_name}_{timestamp}.html"
    filepath = path / filename

    filepath.write_text(html, encoding="utf-8")
    return str(filepath)


def main():
    parser = argparse.ArgumentParser(
        description="HTML 抓取器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python html_fetch.py https://example.com/page.html
  python html_fetch.py https://example.com --cookie "token=abc; uid=123"
  python novel_fetch.py https://example.com --browser
  python novel_fetch.py --install
        """,
    )
    parser.add_argument("url", nargs="?", help="目标 URL")
    parser.add_argument("--cookie", "-c", default="", help="Cookie 字符串 (例: 'key1=val1; key2=val2')")
    parser.add_argument("--browser", "-b", action="store_true", help="使用无头浏览器模式 (Playwright)")
    parser.add_argument("--install", action="store_true", help="自动安装所有依赖和浏览器")
    parser.add_argument("--output-dir", "-o", default="output", help="HTML 输出目录 (默认: output)")
    parser.add_argument("--timeout", "-t", type=int, default=30, help="请求超时秒数 (默认: 30)")

    args = parser.parse_args()

    if args.install:
        install_dependencies()
        return

    if not args.url:
        parser.print_help()
        print("\n[!] 请提供目标 URL")
        sys.exit(1)

    ensure_dependencies(browser_mode=args.browser)

    defult_cookies = "Hm_lvt_d72896ddbf8d27c750e3b365ea2fc902=1780045405,1780120108; HMACCOUNT=99CC7C9A5CC60B0C; _clck=t66ie%5E2%5Eg6h%5E0%5E2309; PHPSESSID=ba61ae6f8503fddca840632945d1d200; jieqiUserInfo=jieqiUserId%3D1134285%2CjieqiUserName%3D826839099%2CjieqiUserGroup%3D3%2CjieqiUserVip%3D0%2CjieqiUserPassword%3D2ea565d734f685316cb5e840a9a46f75%2CjieqiUserName_un%3D826839099%2CjieqiUserHonor_un%3D%26%23x666E%3B%26%23x901A%3B%26%23x4F1A%3B%26%23x5458%3B%2CjieqiUserGroupName_un%3D%26%23x666E%3B%26%23x901A%3B%26%23x4F1A%3B%26%23x5458%3B%2CjieqiUserLogin%3D1780120112; jieqiVisitInfo=jieqiUserLogin%3D1780120112%2CjieqiUserId%3D1134285; Hm_lpvt_d72896ddbf8d27c750e3b365ea2fc902=1780122190; cf_clearance=ct20e63IreL9LTSS8yqKPPr2i1125BqSm5jSIVsfNrU-1780122190-1.2.1.1-bGa.EuRK6RwVCur1_niZk34pgE6G_3Ua1W1EKOBsW9DkNZOBw87qQIE_FbRdk5d.BZUs6eMlCp8DklhDxLWRaNMScQBA3HiDM8i7FpkLsUuT4.64MMdVrgi2eP5sQoW4XdgS8HawehhZZ3V.RhvyDRNC_0pxjJTHJMv.enpfd8A2BxN5ffEwpNcDU3qxvDeMXcTogRYO91oRonwF5043hoOYiM.69VVkb0r8O7ZX4hd3K3sYkQ.NkRnaGdkOpOiGZ5yZvSS2cLKaoHWVJxoy37wLwVLQCxn45zTkIaqPByXmsSwrX75EwzkbfsItC7i67HXgkqUgSLk92STkqG4mhg; _clsk=u9cc84%5E1780122191386%5E7%5E0%5El.clarity.ms%2Fcollect"

    # 解析 Cookie 字符串为字典 如果命令行提供了 --cookie 则使用它，否则使用默认的 defult_cookies
    cookies = parse_cookie_string(args.cookie or defult_cookies)
    if cookies:
        print(f"[*] 已解析 {len(cookies)} 个 cookie: {list(cookies.keys())}")

    try:
        if args.browser:
            ensure_playwright_browser()
            print(f"[*] 使用无头浏览器模式抓取: {args.url}")
            fetcher = PlaywrightFetcher(cookies=cookies, timeout=args.timeout)
            result = asyncio.run(fetcher.fetch(args.url))
        else:
            print(f"[*] 使用 HTTP 请求模式抓取: {args.url}")
            fetcher = RequestsFetcher(cookies=cookies, timeout=args.timeout)
            result = fetcher.fetch(args.url)

        saved_path = save_html(result.html, result.url, args.output_dir)

        print(f"[+] 抓取成功")
        print(f"    URL:      {result.url}")
        print(f"    状态码:   {result.status_code}")
        print(f"    大小:     {result.content_length:,} bytes")
        print(f"    保存至:   {saved_path}")

    except Exception as e:
        print(f"[X] 抓取失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
