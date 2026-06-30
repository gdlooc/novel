"""统一日志系统 — 文件 + 控制台双输出

替换散落各处的 print() 为结构化日志。

用法:
  from core.logger import get_logger
  logger = get_logger("scraper")
  logger.info("开始下载 aid=%s", aid)
  logger.warning("Cookie 即将过期")
  logger.error("下载失败: %s", error_msg)
"""

import logging
import sys
from datetime import datetime
from pathlib import Path
from logging.handlers import RotatingFileHandler

# ═══════════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════════

# 日志目录
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# 日志格式（含毫秒）
LOG_FORMAT = logging.Formatter(
    fmt="%(asctime)s.%(msecs)03d [%(levelname)-5s] [%(name)s] %(message)s",
    datefmt="%m-%d %H:%M:%S",
)

# 内存日志缓冲区（供 API 读取，保留最近 500 条）
_MEMORY_LOG: list[str] = []
_MAX_MEMORY_LINES = 500


class MemoryHandler(logging.Handler):
    """内存日志处理器——将日志写入内存缓冲区供 API 查看"""

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            _MEMORY_LOG.append(msg)
            # 保持缓冲区大小
            while len(_MEMORY_LOG) > _MAX_MEMORY_LINES:
                _MEMORY_LOG.pop(0)
        except Exception:
            pass


# 根 Logger 配置（只执行一次）
_ROOT_LOGGER = logging.getLogger("crawler")
_ROOT_LOGGER.setLevel(logging.DEBUG)

# 控制台 handler（INFO 及以上）
_console = logging.StreamHandler(sys.stdout)
_console.setLevel(logging.INFO)
_console.setFormatter(LOG_FORMAT)
_ROOT_LOGGER.addHandler(_console)

# 文件 handler（DEBUG 及以上，轮转，最大 5MB × 3 个）
_file = RotatingFileHandler(
    LOG_DIR / "crawler.log",
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
_file.setLevel(logging.DEBUG)
_file.setFormatter(LOG_FORMAT)
_ROOT_LOGGER.addHandler(_file)

# 内存 handler（全部级别，供 API 查询）
_memory = MemoryHandler()
_memory.setLevel(logging.DEBUG)
_memory.setFormatter(LOG_FORMAT)
_ROOT_LOGGER.addHandler(_memory)


# ═══════════════════════════════════════════════════════════════
# 公共 API
# ═══════════════════════════════════════════════════════════════

def get_logger(name: str) -> logging.Logger:
    """获取指定模块的 Logger

    Args:
        name: 模块名（如 "scraper", "batch", "db"）

    Returns:
        logging.Logger 实例
    """
    return _ROOT_LOGGER.getChild(name)


def get_recent_logs(lines: int = 200, level: str = "") -> list[str]:
    """获取最近的日志行

    Args:
        lines: 返回行数
        level: 过滤级别（空=全部，如 "ERROR"）

    Returns:
        日志行列表（最近的在前）
    """
    logs = list(_MEMORY_LOG)
    if level:
        logs = [l for l in logs if f"[{level}]" in l]
    return logs[-lines:][::-1]


def get_log_files() -> list[dict]:
    """获取日志文件列表及其大小"""
    files = []
    for f in sorted(LOG_DIR.glob("crawler.log*"), reverse=True):
        files.append({
            "name": f.name,
            "size": f.stat().st_size,
            "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        })
    return files


# ═══════════════════════════════════════════════════════════════
# CLI 测试入口
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logger = get_logger("test")
    logger.debug("调试消息")
    logger.info("信息消息")
    logger.warning("警告消息")
    logger.error("错误消息")

    print("\n--- 最近日志 ---")
    for line in get_recent_logs(10):
        print(line)
