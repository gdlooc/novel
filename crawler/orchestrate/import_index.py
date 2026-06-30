"""将 _site_index.json 索引数据导入到 site_novels 表

直接读取 JSON 文件并批量写入数据库，无需重新发现。
"""

import json
import sys
from pathlib import Path

# 添加 crawler 根目录到 sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def import_site_index(index_path: str = "novels/_site_index.json"):
    """将站点索引 JSON 文件导入到数据库

    Args:
        index_path: _site_index.json 文件路径
    """
    db = NovelDB()
    index_file = Path(index_path)

    print("=" * 60)
    print("  导入站点索引到数据库")
    print("=" * 60)
    print()

    # 检查文件是否存在
    if not index_file.exists():
        print(f"[X] 索引文件不存在: {index_path}")
        print("[!] 请先运行 discover.py 发现全站小说")
        db.close()
        return

    # 读取 JSON
    print(f"[*] 读取索引文件: {index_path}")
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[X] 读取 JSON 失败: {e}")
        db.close()
        return

    novels_data = data.get("novels", [])
    if not novels_data:
        print("[X] 索引文件中没有小说数据")
        db.close()
        return

    print(f"[*] 发现 {len(novels_data)} 本小说")
    print()

    # 批量导入
    print("[*] 正在写入数据库...")
    try:
        # 转换为数据库格式
        novels_to_upsert = [
            {
                "data_source_aid": n["aid"],
                "title": n["title"],
                "url": n.get("url", ""),
            }
            for n in novels_data
        ]

        # 批量写入
        db.batch_upsert_site_novels(novels_to_upsert)

        print(f"[OK] 成功导入 {len(novels_to_upsert)} 本小说到 site_novels 表")

    except Exception as e:
        print(f"[X] 导入失败: {e}")
        db.close()
        return

    print()

    # 显示统计
    stats = db.get_site_novels_count()
    print("[*] 数据库统计:")
    print(f"  全站索引总数: {stats['total']}")
    print(f"  已下载: {stats['downloaded']}")
    print(f"  待下载: {stats['pending']}")

    print()
    print("=" * 60)
    print("  导入完成！")
    print("=" * 60)

    db.close()


if __name__ == "__main__":
    # 自动检测索引文件路径
    script_dir = Path(__file__).parent.parent
    index_path = script_dir / "novels" / "_site_index.json"

    if not index_path.exists():
        print(f"[X] 索引文件不存在: {index_path}")
        print("[!] 请先运行 discover.py 发现全站小说")
        sys.exit(1)

    import_site_index(str(index_path))
