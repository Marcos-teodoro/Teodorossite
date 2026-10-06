"""Exporta os produtos e fotos do banco atual para server/seed_catalog.json.

Uso (dentro de server/):  python scripts/export_catalog.py
Para restaurar em um banco vazio: defina SEED_CATALOG=1 uma vez e reinicie o serviço.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db import get_connection  # noqa: E402


def main() -> None:
    products = []
    with get_connection() as conn:
        for row in conn.execute("SELECT * FROM products ORDER BY id").fetchall():
            item = {k: row[k] for k in row.keys() if k not in ("created_at", "updated_at")}
            item["images"] = [
                {"url": i["url"], "sort_order": i["sort_order"], "is_cover": i["is_cover"]}
                for i in conn.execute(
                    "SELECT url, sort_order, is_cover FROM product_images WHERE product_id = ? ORDER BY sort_order, id",
                    (row["id"],),
                ).fetchall()
            ]
            products.append(item)
    out = ROOT / "seed_catalog.json"
    out.write_text(json.dumps({"products": products}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(products)} produto(s) exportado(s) para {out}")


if __name__ == "__main__":
    main()
