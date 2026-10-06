from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection, parse_json_field, row_to_dict, rows_to_list
from ..schemas import product_to_storefront
from ..services.cache import cached

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


def _images_for(conn, product_id: int) -> list[dict]:
    return rows_to_list(
        conn.execute(
            "SELECT id, url, sort_order, is_cover FROM product_images WHERE product_id = ? ORDER BY sort_order, id",
            (product_id,),
        ).fetchall()
    )


def _variants_for(conn, product_id: int) -> list[dict]:
    return rows_to_list(
        conn.execute(
            "SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order, id",
            (product_id,),
        ).fetchall()
    )


def _group(rows: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["product_id"], []).append(row)
    return grouped


def storefront_products(conn, where_sql: str = "", params: list | None = None, order: str = "id") -> list[dict]:
    """Produtos da vitrine com fotos e variantes em 3 consultas (antes eram 2 por produto)."""
    rows = rows_to_list(conn.execute(f"SELECT * FROM products WHERE 1=1{where_sql} ORDER BY {order}", params or []).fetchall())
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    images = _group(rows_to_list(conn.execute(
        f"SELECT id, product_id, url, sort_order, is_cover FROM product_images WHERE product_id IN ({marks}) ORDER BY sort_order, id", ids
    ).fetchall()))
    variants = _group(rows_to_list(conn.execute(
        f"SELECT * FROM product_variants WHERE product_id IN ({marks}) AND active = 1 ORDER BY sort_order, id", ids
    ).fetchall()))
    out = []
    for row in rows:
        row["similar_ids"] = parse_json_field(row.get("similar_ids"), [])
        out.append(product_to_storefront(
            row,
            [{k: v for k, v in i.items() if k != "product_id"} for i in images.get(row["id"], [])],
            variants.get(row["id"], []),
        ))
    return out


def _storefront_categories(conn, all_: bool = False) -> list[dict]:
    if all_:
        rows = conn.execute("SELECT * FROM categories ORDER BY sort_order, id").fetchall()
        return rows_to_list(rows)
    rows = conn.execute("SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, id").fetchall()
    return rows_to_list(rows)[:8]


@router.get("/bootstrap")
def bootstrap():
    """Tudo que a vitrine precisa para abrir (produtos, categorias e configurações) em uma única chamada."""

    def build():
        with get_connection() as conn:
            products = storefront_products(conn, " AND active = 1")
            categories = _storefront_categories(conn)
            settings = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM site_settings").fetchall()}
        return {"products": products, "categories": categories, "settings": settings}

    return cached("bootstrap", build)


@router.get("/categories")
def list_categories(all: bool = Query(False)):
    def build():
        with get_connection() as conn:
            return {"categories": _storefront_categories(conn, all)}

    return cached(f"categories:{all}", build)


@router.get("/products")
def list_products(category: str | None = None, q: str | None = None, active_only: bool = True):
    where = ""
    params: list = []
    if active_only:
        where += " AND active = 1"
    if category and category != "todos":
        where += " AND category_slug = ?"
        params.append(category)
    if q:
        where += " AND (title LIKE ? OR brand_tag LIKE ? OR notes LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like])

    def build():
        with get_connection() as conn:
            return {"products": storefront_products(conn, where, params)}

    return cached(f"products:{category}:{q}:{active_only}", build)


@router.get("/products/{product_id}")
def get_product(product_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        data = row_to_dict(row)
        data["similar_ids"] = parse_json_field(data.get("similar_ids"), [])
        return {"product": product_to_storefront(data, _images_for(conn, product_id), _variants_for(conn, product_id))}
