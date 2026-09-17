from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection, parse_json_field, row_to_dict, rows_to_list
from ..schemas import product_to_storefront

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


def _images_for(conn, product_id: int) -> list[dict]:
    return rows_to_list(
        conn.execute(
            "SELECT id, url, sort_order, is_cover FROM product_images WHERE product_id = ? ORDER BY sort_order, id",
            (product_id,),
        ).fetchall()
    )


@router.get("/categories")
def list_categories(all: bool = Query(False)):
    with get_connection() as conn:
        if all:
            rows = conn.execute(
                "SELECT * FROM categories ORDER BY sort_order, id"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, id"
            ).fetchall()
    return {"categories": rows_to_list(rows)}


@router.get("/products")
def list_products(category: str | None = None, q: str | None = None, active_only: bool = True):
    sql = "SELECT * FROM products WHERE 1=1"
    params: list = []
    if active_only:
        sql += " AND active = 1"
    if category and category != "todos":
        sql += " AND category_slug = ?"
        params.append(category)
    if q:
        sql += " AND (title LIKE ? OR brand_tag LIKE ? OR notes LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like])
    sql += " ORDER BY id"
    with get_connection() as conn:
        rows = rows_to_list(conn.execute(sql, params).fetchall())
        products = []
        for row in rows:
            row["similar_ids"] = parse_json_field(row.get("similar_ids"), [])
            products.append(product_to_storefront(row, _images_for(conn, row["id"])))
    return {"products": products}


@router.get("/products/{product_id}")
def get_product(product_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        data = row_to_dict(row)
        data["similar_ids"] = parse_json_field(data.get("similar_ids"), [])
        return {"product": product_to_storefront(data, _images_for(conn, product_id))}
