"""Cookie 字符串解析工具"""

from typing import Dict


def parse_cookie_string(cookie_str: str) -> Dict[str, str]:
    """解析 cookie 字符串为字典

    支持格式: "key1=value1; key2=value2"

    Args:
        cookie_str: Cookie 字符串

    Returns:
        Cookie 字典
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
