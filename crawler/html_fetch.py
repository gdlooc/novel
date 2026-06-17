"""HTML 抓取器

下载任意页面 HTML，支持自动登录认证。
所有抓取均使用 Playwright 无头浏览器（绕过 Cloudflare）。

用法:
  python html_fetch.py https://www.wenku8.net/book/1973.htm
  python html_fetch.py https://www.wenku8.net/book/1973.htm --username 826839099 --password ty1235556
  python html_fetch.py https://www.wenku8.net/book/1973.htm --cookie "key=value;..."
  python html_fetch.py --install
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from fetch.auth import login_via_playwright, resolve_cookies
from fetch.fetcher import PlaywrightFetcher


def ensure_dependencies():
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


# ==================== 账密登录 + 页面抓取（单浏览器会话） ====================

def _fetch_with_login_session(
    url: str,
    username: str,
    password: str,
    output_dir: str,
    timeout: int = 60,
) -> Optional[str]:
    """使用 Playwright 在同一个浏览器会话中完成登录+页面抓取

    登录和抓取在同一浏览器上下文中进行，可绕过 Cloudflare 的浏览器指纹检测。

    Args:
        url: 目标页面 URL
        username: 用户名
        password: 密码
        output_dir: 输出目录
        timeout: 浏览器操作超时秒数

    Returns:
        保存的文件路径，失败返回 None
    """

    async def _do_fetch() -> Optional[str]:
        from playwright.async_api import async_playwright
        from playwright_stealth import Stealth

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )

            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="zh-CN",
            )

            page = await context.new_page()

            # 启用 stealth 伪装
            try:
                stealth = Stealth()
                await stealth.apply_stealth_async(page)
                print("[*] 已启用 stealth 伪装")
            except Exception as e:
                print(f"[!] stealth 启用失败: {e}")

            # ========== 步骤1: 登录 ==========
            print(f"\n{'='*50}")
            print(f"  正在登录 (Playwright 无头浏览器)")
            print(f"{'='*50}")

            login_page_url = "https://www.wenku8.net/login.php?jumpurl=https://www.wenku8.net/modules/article/articlelist.php"
            print("[*] 访问登录页...")
            await page.goto(login_page_url, wait_until="domcontentloaded", timeout=timeout * 1000)
            await page.wait_for_timeout(3000)

            # 检测 Cloudflare Turnstile
            page_content = await page.content()
            if "正在进行安全验证" in page_content or "cf-turnstile" in page_content:
                print("[!] 遇到 Cloudflare 验证，等待自动完成...")
                try:
                    await page.wait_for_url(
                        lambda u: "login.php" in u and "cf_chl" not in u,
                        timeout=30000,
                    )
                    await page.wait_for_timeout(2000)
                    print("[*] Cloudflare 验证已通过")
                except Exception:
                    print("[X] Cloudflare 验证超时")
                    await browser.close()
                    return None

            # 填写登录表单
            print("[*] 填写登录表单...")
            try:
                username_input = await page.wait_for_selector(
                    'input[name="username"]', timeout=10000,
                )
            except Exception:
                print("[X] 无法找到用户名输入框")
                await browser.close()
                return None

            await username_input.fill(username)
            password_input = await page.wait_for_selector('input[name="password"]', timeout=5000)
            await password_input.fill(password)

            try:
                await page.select_option('select[name="usecookie"]', value="315360000")
            except Exception:
                pass

            # 提交登录
            print("[*] 提交登录...")
            submit_btn = await page.wait_for_selector('input[name="submit"]', timeout=5000)

            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
                    await submit_btn.click()
            except Exception:
                print("[!] 提交后未检测到跳转")
                await page.wait_for_timeout(3000)

            page_content = await page.content()
            from fetch.auth import _is_login_success
            if not _is_login_success(page_content):
                if "密码错误" in page_content or "错误" in page_content:
                    print("[X] 登录失败：密码错误")
                else:
                    print("[X] 登录验证失败")
                await browser.close()
                return None

            print("[+] 登录成功！")

            # 保存 cookies 供后续使用
            pw_cookies = await context.cookies()
            cookies = {c["name"]: c["value"] for c in pw_cookies}
            if "jieqiUserInfo" in cookies:
                from fetch.auth import save_cached_cookies
                save_cached_cookies(cookies)
                print(f"[*] 已缓存 {len(cookies)} 个 cookies")

            # ========== 步骤2: 抓取目标页面 ==========
            print(f"\n[*] 抓取目标页面: {url}")
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            await page.wait_for_timeout(2000)

            # 可能再次遇到 Cloudflare
            page_content = await page.content()
            if "正在进行安全验证" in page_content or "cf-turnstile" in page_content:
                print("[!] 目标页面触发 Cloudflare 验证，等待自动完成...")
                try:
                    await page.wait_for_url(lambda u: "cf_chl" not in u, timeout=30000)
                    await page.wait_for_timeout(2000)
                    page_content = await page.content()
                    print("[*] 验证已通过")
                except Exception:
                    print("[X] 验证超时")
                    await browser.close()
                    return None

            status_code = resp.status if resp else 0
            content_length = len(page_content.encode("utf-8"))

            saved_path = save_html(page_content, url, output_dir)

            print(f"[+] 抓取成功")
            print(f"    URL:      {url}")
            print(f"    状态码:   {status_code}")
            print(f"    大小:     {content_length:,} bytes")
            print(f"    保存至:   {saved_path}")

            await browser.close()
            return saved_path

    return asyncio.run(_do_fetch())


# ==================== 主入口 ====================

def main():
    parser = argparse.ArgumentParser(
        description="HTML 抓取器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python html_fetch.py https://www.wenku8.net/book/1973.htm
  python html_fetch.py https://www.wenku8.net/book/1973.htm --username 826839099 --password ty1235556
  python html_fetch.py https://www.wenku8.net/book/1973.htm --cookie "key=value;..."
  python html_fetch.py --install
        """,
    )
    parser.add_argument("url", nargs="?", help="目标 URL")
    # 认证参数
    auth_group = parser.add_argument_group("认证方式")
    auth_group.add_argument("--username", "-u", default="", help="用户名")
    auth_group.add_argument("--password", "-p", default="", help="密码")
    auth_group.add_argument("--cookie", "-c", default="", help="Cookie 字符串（可选，优先使用）")
    # 抓取选项
    parser.add_argument("--install", action="store_true", help="自动安装所有依赖和浏览器")
    parser.add_argument("--output-dir", "-o", default="output", help="HTML 输出目录 (默认: output)")
    parser.add_argument("--timeout", "-t", type=int, default=60, help="请求超时秒数 (默认: 60)")

    args = parser.parse_args()

    if args.install:
        install_dependencies()
        return

    if not args.url:
        parser.print_help()
        print("\n[!] 请提供目标 URL")
        sys.exit(1)

    ensure_dependencies()
    ensure_playwright_browser()

    # ================================================================
    # 路径A: 账密登录 → Playwright 单会话登录+抓取
    # ================================================================
    if args.username:
        print(f"[*] 使用账密登录并抓取（Playwright 单会话模式）")
        saved = _fetch_with_login_session(
            url=args.url,
            username=args.username,
            password=args.password,
            output_dir=args.output_dir,
            timeout=args.timeout,
        )
        if not saved:
            print("[X] 抓取失败")
            sys.exit(1)
        return

    # ================================================================
    # 路径B: Cookie / 缓存 → Playwright 抓取
    # ================================================================
    cookies = resolve_cookies(
        username="",
        password="",
        cookie_string=args.cookie,
    )
    if cookies:
        print(f"[*] 已获取 {len(cookies)} 个 cookie")
    else:
        print("[!] 警告: 未获取到登录凭证，将以游客身份访问")
        cookies = {}

    try:
        print(f"[*] 使用 Playwright 抓取: {args.url}")
        fetcher = PlaywrightFetcher(cookies=cookies, timeout=args.timeout)
        result = asyncio.run(fetcher.fetch(args.url))

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
