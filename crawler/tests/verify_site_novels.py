"""验证 site_novels 表数据完整性

检查：
1. 记录总数是否与 _site_index.json 一致
2. 前10条记录是否正确
3. 索引是否正常
"""

import json
import psycopg2
from pathlib import Path


def verify_import():
    """验证导入完整性"""
    print("=" * 60)
    print("  验证 site_novels 数据完整性")
    print("=" * 60)
    print()

    # 读取 JSON 文件
    index_path = Path(__file__).parent.parent / "novels" / "_site_index.json"
    with open(index_path, "r", encoding="utf-8") as f:
        json_data = json.load(f)
    json_novels = json_data.get("novels", [])
    print(f"[*] JSON 文件中的小说数: {len(json_novels)}")

    # 连接数据库
    conn = psycopg2.connect(
        host="localhost", port=5432, dbname="novels",
        user="postgres", password="ty1235556"
    )
    cur = conn.cursor()

    # 查询总数
    cur.execute("SELECT COUNT(*) FROM site_novels")
    db_count = cur.fetchone()[0]
    print(f"[*] 数据库中的小说数: {db_count}")

    if db_count != len(json_novels):
        print(f"[WARNING] 数量不一致！JSON={len(json_novels)}, DB={db_count}")
    else:
        print("[OK] 数量一致")

    print()

    # 验证前10条记录
    print("[*] 验证前 10 条记录:")
    cur.execute("SELECT data_source_aid, title FROM site_novels ORDER BY id LIMIT 10")
    db_rows = cur.fetchall()

    for i, (aid, title) in enumerate(db_rows, 1):
        # 在 JSON 中查找对应的记录
        json_match = next((n for n in json_novels if n["aid"] == aid), None)
        if json_match:
            json_title = json_match["title"]
            if json_title == title:
                print(f"  {i}. [OK] aid={aid}: {title[:40]}")
            else:
                print(f"  {i}. [MISMATCH] aid={aid}")
                print(f"     DB:  {title[:50]}")
                print(f"     JSON: {json_title[:50]}")
        else:
            print(f"  {i}. [MISSING] aid={aid} 不在 JSON 中")

    print()

    # 检查索引
    print("[*] 检查数据库索引:")
    cur.execute("""
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'site_novels'
        ORDER BY indexname
    """)
    indexes = cur.fetchall()
    for idx_name, idx_def in indexes:
        print(f"  - {idx_name}")

    print()

    # 统计已下载 vs 未下载
    cur.execute("SELECT COUNT(*) FROM site_novels WHERE is_downloaded = TRUE")
    downloaded = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM site_novels WHERE is_downloaded = FALSE")
    pending = cur.fetchone()[0]

    print("[*] 下载状态:")
    print(f"  已下载: {downloaded}")
    print(f"  待下载: {pending}")

    print()
    print("=" * 60)
    print("  验证完成")
    print("=" * 60)

    cur.close()
    conn.close()


if __name__ == "__main__":
    verify_import()
