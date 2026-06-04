"""Cookie 字符串解析与格式转换"""

from typing import Dict, List


def parse_cookie_string(cookie_str: str) -> Dict[str, str]:
    """解析 cookie 字符串为字典

    支持格式: "key1=value1; key2=value2"
    """
    if not cookie_str or not cookie_str.strip():
        return {}

    cookies = {}
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" in item:
            key, _, value = item.partition("=")
            cookies[key.strip()] = value.strip()
    return cookies


def to_playwright_cookies(cookies: Dict[str, str], domain: str = "") -> List[Dict]:
    """转换为 Playwright 格式的 cookie 列表"""
    result = []
    for key, value in cookies.items():
        cookie = {
            "name": key,
            "value": value,
            "path": "/",
        }
        if domain:
            cookie["domain"] = domain
        result.append(cookie)
    return result
