"""网站登录认证模块

使用 Playwright 无头浏览器自动登录 wenku8.net，绕过 Cloudflare 防护。
登录成功后将 cookies 缓存到本地文件，避免重复登录。

用法:
  from auth import login, load_cached_cookies

  # 尝试从缓存加载，失败则自动登录
  cookies = login("username", "password")

  # 仅从缓存加载
  cookies = load_cached_cookies()
"""

import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, Optional

# 导入项目内模块
from cookie_utils import parse_cookie_string


# ==================== 常量定义 ====================

# wenku8 网站基础 URL
BASE_URL = "https://www.wenku8.net"

# 默认 Cookie 缓存文件路径（在 crawler 目录下）
DEFAULT_COOKIE_CACHE = Path(__file__).parent / ".auth_cookies.json"

# 浏览器 User-Agent
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


# ==================== 登录状态判断 ====================

def _is_login_success(html: str) -> bool:
    """判断页面内容是否表明已登录成功

    判断依据（按优先级）:
    1. 页面包含「退出登录」或 /logout.php → 已登录
    2. 页面显示用户欢迎信息（欢迎您，XXX） → 已登录
    3. 页面包含登录表单（name="frmlogin"） → 未登录
    4. 以上都不满足 → 保守判断为未登录

    注意: 「我的书架」在导航栏中始终存在，不能作为登录判断依据。

    Args:
        html: 页面 HTML 文本

    Returns:
        True 表示已登录
    """
    if not html:
        return False

    # 已登录标志：有退出登录链接
    if "退出登录" in html or "/logout.php" in html:
        return True

    # 已登录标志：显示用户名欢迎语（例: "轻小说文库欢迎您，826839099"）
    if "欢迎您" in html:
        # 确认不是登录表单中的"欢迎您"文案（如闭站公告）
        if 'name="frmlogin"' not in html and 'name="username"' not in html:
            return True

    # 未登录标志：页面包含登录表单
    if 'name="frmlogin"' in html:
        return False

    # 保守：无明确登录标志则视为未登录
    return False


# ==================== Playwright 浏览器登录 ====================

async def login_via_playwright(
    username: str,
    password: str,
    timeout: int = 60,
) -> Optional[Dict[str, str]]:
    """使用无头浏览器模拟真实用户登录

    核心策略:
    1. 访问登录页（带 jumpurl），服务器可能触发 Turnstile 验证
    2. 填写用户名和密码，提交表单
    3. 登录成功后，服务器会 302 重定向回 jumpurl 目标
    4. 通过 URL 变化 + 页面内容双重判断登录是否成功
    5. 登录成功后访问书架页巩固登录态，再提取所有 cookies

    Args:
        username: 用户名或邮箱
        password: 密码
        timeout: 浏览器操作超时秒数

    Returns:
        登录成功返回 cookies 字典，失败返回 None
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("  [X] 未安装 playwright，无法使用浏览器登录")
        print("  [!] 请运行: pip install playwright && playwright install chromium")
        return None

    print("  [*] 启动无头浏览器...")
    try:
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
                user_agent=_BROWSER_UA,
                locale="zh-CN",
            )

            page = await context.new_page()

            # 启用 playwright-stealth 伪装，绕过 Cloudflare 检测
            try:
                from playwright_stealth import Stealth
                stealth = Stealth(
                    navigator_webdriver=True,
                    navigator_languages=True,
                    chrome_app=True,
                    chrome_csi=True,
                    chrome_load_times=True,
                    hairline=True,
                    iframe_content_window=True,
                    media_codecs=True,
                )
                await stealth.apply_stealth_async(page)
                print("  [*] 已启用 stealth 伪装")
            except Exception as e:
                print(f"  [!] stealth 启用失败: {e}")

            # ============================================================
            # 步骤1: 访问登录页面，等待可能的 Cloudflare 挑战完成
            # ============================================================
            login_page_url = f"{BASE_URL}/login.php?jumpurl={BASE_URL}/modules/article/articlelist.php"
            print(f"  [*] 访问登录页...")
            await page.goto(login_page_url, wait_until="domcontentloaded", timeout=timeout * 1000)

            # 等待页面稳定——Cloudflare Turnstile 可能需要几秒自动完成
            await page.wait_for_timeout(3000)

            # 检测 Cloudflare Turnstile 挑战
            page_content = await page.content()

            if "正在进行安全验证" in page_content or "cf-turnstile" in page_content:
                print("  [!] 遇到 Cloudflare Turnstile 验证，等待自动完成...")
                try:
                    await page.wait_for_url(
                        lambda url: "login.php" in url and "cf_chl" not in url,
                        timeout=30000,
                    )
                    await page.wait_for_timeout(2000)
                    page_content = await page.content()
                    print("  [*] Cloudflare 验证已通过")
                except Exception:
                    print("  [X] Cloudflare 验证超时，可能被拦截")
                    debug_path = Path(__file__).parent / "output" / "cloudflare_block.html"
                    debug_path.parent.mkdir(parents=True, exist_ok=True)
                    debug_path.write_text(await page.content(), encoding="utf-8")
                    print(f"  [!] 页面已保存到: {debug_path}")
                    await browser.close()
                    return None

            # 检查是否无需登录（已登录状态）
            page_content = await page.content()
            if _is_login_success(page_content):
                print("  [*] 已处于登录状态，直接提取 cookies")
                pw_cookies = await context.cookies()
                cookies = {c["name"]: c["value"] for c in pw_cookies}
                if "jieqiUserInfo" in cookies:
                    print(f"  [+] 获取到 {len(cookies)} 个 cookies（含 jieqiUserInfo）")
                    await browser.close()
                    return cookies
                else:
                    print("  [!] 已登录但缺少 jieqiUserInfo，继续尝试重新登录")

            # ============================================================
            # 步骤2: 填写登录表单
            # ============================================================
            print("  [*] 填写登录表单...")

            try:
                username_input = await page.wait_for_selector(
                    'input[name="username"]',
                    timeout=10000,
                )
            except Exception:
                print("  [X] 无法找到用户名输入框")
                debug_path = Path(__file__).parent / "output" / "login_debug.html"
                debug_path.parent.mkdir(parents=True, exist_ok=True)
                debug_path.write_text(page_content, encoding="utf-8")
                print(f"  [!] 页面内容已保存到: {debug_path}")
                await browser.close()
                return None

            await username_input.fill(username)
            print("  [*] 用户名已填入")

            password_input = await page.wait_for_selector(
                'input[name="password"]',
                timeout=5000,
            )
            await password_input.fill(password)
            print("  [*] 密码已填入")

            # 选择最长有效期
            try:
                await page.select_option(
                    'select[name="usecookie"]',
                    value="315360000",
                )
            except Exception:
                pass

            # ============================================================
            # 步骤3: 提交表单并等待响应
            # ============================================================
            form_action = await page.get_attribute(
                'form[name="frmlogin"]', 'action'
            )
            print(f"  [*] 表单 action: {(form_action or '')[:80]}")

            print("  [*] 提交登录...")
            submit_btn = await page.wait_for_selector(
                'input[name="submit"]',
                timeout=5000,
            )

            pre_login_url = page.url

            # 点击提交并等待页面跳转
            # 登录成功 → 302 重定向到 jumpurl
            # 登录失败 → 停留在 login.php?do=submit 显示错误信息
            try:
                async with page.expect_navigation(
                    wait_until="domcontentloaded",
                    timeout=30000,
                ):
                    await submit_btn.click()
            except Exception:
                print("  [!] 提交后未检测到页面跳转")
                await page.wait_for_timeout(3000)

            post_login_url = page.url
            page_content = await page.content()
            print(f"  [*] 提交后页面: {post_login_url[:80]}")

            # ============================================================
            # 步骤4: 判断登录结果
            # ============================================================
            url_changed = post_login_url != pre_login_url and "login.php" not in post_login_url
            login_success_by_content = _is_login_success(page_content)

            # 检查服务器返回的特定错误信息
            has_error = (
                "密码错误" in page_content or
                "用户名" in page_content and ("不存在" in page_content or "错误" in page_content) or
                "登录失败" in page_content
            )

            if has_error:
                print(f"  [X] 服务器返回错误信息")
                error_hints = re.findall(r'(?:错误|失败|不存在)[^<]{0,30}', page_content)
                for hint in error_hints[:3]:
                    print(f"  [!] 错误详情: {hint.strip()}")
                debug_path = Path(__file__).parent / "output" / "login_failed.html"
                debug_path.parent.mkdir(parents=True, exist_ok=True)
                debug_path.write_text(page_content, encoding="utf-8")
                print(f"  [!] 失败页面已保存到: {debug_path}")
                await browser.close()
                return None

            if url_changed or login_success_by_content:
                if url_changed:
                    print(f"  [+] URL 跳转成功 → 登录生效")
                else:
                    print(f"  [+] 页面内容显示已登录")

                # 导航到书架页巩固登录态
                bookcase_url = f"{BASE_URL}/modules/article/bookcase.php"
                print(f"  [*] 访问书架页巩固登录态...")
                await page.goto(bookcase_url, wait_until="domcontentloaded", timeout=timeout * 1000)
                await page.wait_for_timeout(1500)

                # 提取所有 cookies
                pw_cookies = await context.cookies()
                cookies = {c["name"]: c["value"] for c in pw_cookies}

                if "jieqiUserInfo" in cookies:
                    print(f"  [+] Playwright 登录成功！获取到 {len(cookies)} 个 cookies（含 jieqiUserInfo）")
                    await browser.close()
                    return cookies
                else:
                    print(f"  [!] 获取到 {len(cookies)} 个 cookies，但缺少 jieqiUserInfo")
                    print(f"  [!] Cookie 列表: {list(cookies.keys())}")
                    await browser.close()
                    return None
            else:
                print(f"  [X] 登录失败，停留在登录相关页面")
                debug_path = Path(__file__).parent / "output" / "login_failed.html"
                debug_path.parent.mkdir(parents=True, exist_ok=True)
                debug_path.write_text(page_content, encoding="utf-8")
                print(f"  [!] 失败页面已保存到: {debug_path}")
                await browser.close()
                return None

    except Exception as e:
        print(f"  [X] Playwright 登录异常: {e}")
        import traceback
        traceback.print_exc()
        return None


def login_via_playwright_sync(
    username: str,
    password: str,
    timeout: int = 60,
) -> Optional[Dict[str, str]]:
    """同步包装器，方便在非异步环境中调用 Playwright 登录"""
    return asyncio.run(login_via_playwright(username, password, timeout))


# ==================== Cookie 缓存管理 ====================

def save_cached_cookies(
    cookies: Dict[str, str],
    cache_path: Optional[Path] = None,
):
    """将 cookies 保存到本地缓存文件

    Args:
        cookies: cookies 字典
        cache_path: 缓存文件路径，默认 .auth_cookies.json
    """
    if cache_path is None:
        cache_path = DEFAULT_COOKIE_CACHE

    data = {
        "cookies": cookies,
        "saved_at": time.time(),
        "cookie_count": len(cookies),
    }

    cache_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  [*] Cookies 已缓存到: {cache_path}")


def load_cached_cookies(
    cache_path: Optional[Path] = None,
    max_age_hours: float = 24 * 7,  # 默认缓存有效期 7 天
) -> Optional[Dict[str, str]]:
    """从本地缓存文件加载 cookies

    会检查缓存的时效性，过期的缓存不会返回。

    Args:
        cache_path: 缓存文件路径，默认 .auth_cookies.json
        max_age_hours: 缓存最大有效小时数，超过则视为过期

    Returns:
        有效 cookies 字典，或 None
    """
    if cache_path is None:
        cache_path = DEFAULT_COOKIE_CACHE

    if not cache_path.exists():
        return None

    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        saved_at = data.get("saved_at", 0)
        age_hours = (time.time() - saved_at) / 3600

        if age_hours > max_age_hours:
            print(f"  [*] Cookie 缓存已过期 ({age_hours:.1f}小时 > {max_age_hours}小时)")
            return None

        cookies = data.get("cookies", {})
        if not cookies or "jieqiUserInfo" not in cookies:
            print("  [*] Cookie 缓存缺少关键字段 (jieqiUserInfo)")
            return None

        print(f"  [*] 从缓存加载 {len(cookies)} 个 cookies (已缓存 {age_hours:.1f}小时)")
        return cookies

    except (json.JSONDecodeError, KeyError) as e:
        print(f"  [!] Cookie 缓存文件损坏: {e}")
        return None


def clear_cached_cookies(cache_path: Optional[Path] = None):
    """删除 cookie 缓存文件"""
    if cache_path is None:
        cache_path = DEFAULT_COOKIE_CACHE

    if cache_path.exists():
        cache_path.unlink()
        print(f"  [*] 已清除 cookie 缓存: {cache_path}")


# ==================== 主入口：自动登录 ====================

def login(
    username: str = "",
    password: str = "",
    force_refresh: bool = False,
    cache_path: Optional[Path] = None,
    timeout: int = 30,
) -> Optional[Dict[str, str]]:
    """自动登录主入口：缓存优先 → Playwright 浏览器登录

    策略:
    1. 如果 force_refresh=False，先尝试从缓存加载（7天内有效）
    2. 缓存命中 → 直接返回
    3. 缓存未命中 → 使用 Playwright 浏览器登录（绕过 Cloudflare）
    4. 登录成功后自动保存到缓存

    Args:
        username: 用户名
        password: 密码
        force_refresh: 是否强制重新登录（忽略缓存）
        cache_path: 缓存文件路径
        timeout: 登录请求超时秒数

    Returns:
        登录成功返回 cookies 字典，失败返回 None

    Raises:
        ValueError: username 或 password 为空时抛出
    """
    if cache_path is None:
        cache_path = DEFAULT_COOKIE_CACHE

    # 如果未提供账密但有缓存，尝试从缓存加载
    if not username and not password:
        cached = load_cached_cookies(cache_path)
        if cached:
            return cached
        raise ValueError("未提供用户名和密码，且无有效缓存 cookies")

    if not username or not password:
        raise ValueError("用户名和密码不能为空")

    # 步骤1: 检查缓存（非强制刷新模式）
    if not force_refresh:
        cached = load_cached_cookies(cache_path)
        if cached:
            return cached
    else:
        print("  [*] 强制刷新模式，跳过缓存")

    # 步骤2: 使用 Playwright 浏览器登录
    print(f"\n{'='*50}")
    print(f"  正在登录 (Playwright 无头浏览器)")
    print(f"{'='*50}")
    cookies = login_via_playwright_sync(username, password, timeout=max(timeout, 60))

    if cookies:
        save_cached_cookies(cookies, cache_path)
        return cookies

    print("\n  [X] 登录失败")
    print("  [!] 提示:")
    print("      1. 检查用户名和密码是否正确")
    print("      2. 检查网络连接是否正常")
    return None


# ==================== 便捷函数：获取有效 cookies ====================

def resolve_cookies(
    username: str = "",
    password: str = "",
    cookie_string: str = "",
    cache_path: Optional[Path] = None,
) -> Optional[Dict[str, str]]:
    """一站式获取可用 cookies

    优先级:
    1. 命令行提供的 --cookie 字符串 → 直接解析
    2. 命令行提供的 --username + --password → 自动登录
    3. 缓存文件 → 加载

    Args:
        username: 用户名
        password: 密码
        cookie_string: 手动提供的 cookie 字符串
        cache_path: 缓存文件路径

    Returns:
        cookies 字典，或 None
    """
    # 优先使用手动提供的 cookie 字符串
    if cookie_string:
        cookies = parse_cookie_string(cookie_string)
        if cookies:
            print(f"[*] 使用命令行提供的 cookies ({len(cookies)} 个)")
            return cookies

    # 尝试自动登录
    if username and password:
        return login(username, password, cache_path=cache_path)

    # 尝试缓存
    cached = load_cached_cookies(cache_path)
    if cached:
        return cached

    return None


# ==================== CLI 测试入口 ====================

if __name__ == "__main__":
    """直接运行此模块测试登录功能

    用法:
      python auth.py --username 826839099 --password ty1235556
      python auth.py --username 826839099 --password ty1235556 --force
      python auth.py --load-cache                     # 仅查看缓存
      python auth.py --clear-cache                    # 清除缓存
    """
    import argparse

    parser = argparse.ArgumentParser(description="wenku8 登录认证测试")
    parser.add_argument("--username", "-u", default="", help="用户名")
    parser.add_argument("--password", "-p", default="", help="密码")
    parser.add_argument("--force", "-f", action="store_true", help="强制重新登录")
    parser.add_argument("--load-cache", action="store_true", help="仅查看缓存 cookies")
    parser.add_argument("--clear-cache", action="store_true", help="清除缓存 cookies")

    args = parser.parse_args()

    if args.clear_cache:
        clear_cached_cookies()
        sys.exit(0)

    if args.load_cache:
        cookies = load_cached_cookies()
        if cookies:
            print(f"\n缓存中有 {len(cookies)} 个 cookies:")
            for k, v in cookies.items():
                display_v = v[:20] + "..." if len(v) > 20 else v
                print(f"  {k}: {display_v}")
        else:
            print("无有效缓存 cookies")
        sys.exit(0)

    # 执行登录
    try:
        cookies = login(
            username=args.username,
            password=args.password,
            force_refresh=args.force,
        )
        if cookies:
            print(f"\n[+] 登录成功！获取到 {len(cookies)} 个 cookies")
            for key in ["jieqiUserInfo", "jieqiVisitInfo", "PHPSESSID", "cf_clearance"]:
                if key in cookies:
                    v = cookies[key]
                    display_v = v[:30] + "..." if len(v) > 30 else v
                    print(f"  [{key}]: {display_v}")
        else:
            print("\n[X] 登录失败")
            sys.exit(1)
    except ValueError as e:
        print(f"[!] {e}")
        parser.print_help()
        sys.exit(1)
