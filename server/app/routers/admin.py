from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..auth import require_admin
from ..config import get_settings
from ..db import get_connection, parse_json_field, row_to_dict, rows_to_list
from ..schemas import CategoryBody, ProductBody, product_to_storefront

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
def dashboard(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        products = conn.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        active = conn.execute("SELECT COUNT(*) AS c FROM products WHERE active = 1").fetchone()["c"]
        pending = conn.execute(
            "SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'"
        ).fetchone()["c"]
        approved = conn.execute(
            "SELECT COUNT(*) AS c FROM orders WHERE status = 'approved'"
        ).fetchone()["c"]
        recent = rows_to_list(
            conn.execute(
                "SELECT id, status, total, payer_name, payer_email, created_at FROM orders ORDER BY created_at DESC LIMIT 8"
            ).fetchall()
        )
    return {
        "stats": {
            "products": products,
            "activeProducts": active,
            "pendingOrders": pending,
            "approvedOrders": approved,
        },
        "recentOrders": recent,
    }


@router.get("/categories")
def admin_categories(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        return {"categories": rows_to_list(conn.execute("SELECT * FROM categories ORDER BY sort_order, id").fetchall())}


@router.post("/categories")
def create_category(body: CategoryBody, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO categories (slug, name, sort_order, active, image_url) VALUES (?, ?, ?, ?, ?)",
                (body.slug, body.name, body.sort_order, 1 if body.active else 0, body.image_url),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"category": row_to_dict(row)}


@router.put("/categories/{category_id}")
def update_category(category_id: int, body: CategoryBody, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute(
            "UPDATE categories SET slug=?, name=?, sort_order=?, active=?, image_url=? WHERE id=?",
            (body.slug, body.name, body.sort_order, 1 if body.active else 0, body.image_url, category_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Categoria não encontrada")
    return {"category": row_to_dict(row)}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        conn.commit()
    return {"ok": True}


def _product_images(conn, product_id: int):
    return rows_to_list(
        conn.execute(
            "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id",
            (product_id,),
        ).fetchall()
    )


@router.get("/products")
def admin_products(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM products ORDER BY id DESC").fetchall())
        out = []
        for row in rows:
            row["similar_ids"] = parse_json_field(row.get("similar_ids"), [])
            out.append(product_to_storefront(row, _product_images(conn, row["id"])))
    return {"products": out}


@router.post("/products")
def create_product(body: ProductBody, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        cat = conn.execute(
            "SELECT id FROM categories WHERE slug = ?", (body.category_slug,)
        ).fetchone()
        cur = conn.execute(
            """
            INSERT INTO products (
              title, brand_tag, volume, category_id, category_slug, family, intensity,
              occasion, sensation, price, old_price, badge, notes, description, ritual,
              ingredients, pyramid_top, pyramid_heart, pyramid_base, similar_ids, stock,
              active, weight_kg, height_cm, width_cm, length_cm, cover_image
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                body.title,
                body.brand_tag,
                body.volume,
                cat["id"] if cat else None,
                body.category_slug,
                body.family,
                body.intensity,
                body.occasion,
                body.sensation,
                body.price,
                body.old_price,
                body.badge,
                body.notes,
                body.description,
                body.ritual,
                body.ingredients,
                body.pyramid_top,
                body.pyramid_heart,
                body.pyramid_base,
                json.dumps(body.similar_ids),
                body.stock,
                1 if body.active else 0,
                body.weight_kg,
                body.height_cm,
                body.width_cm,
                body.length_cm,
                body.cover_image,
            ),
        )
        pid = cur.lastrowid
        if body.cover_image:
            conn.execute(
                "INSERT INTO product_images (product_id, url, sort_order, is_cover) VALUES (?, ?, 0, 1)",
                (pid, body.cover_image),
            )
        conn.commit()
        row = row_to_dict(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone())
        row["similar_ids"] = parse_json_field(row.get("similar_ids"), [])
        return {"product": product_to_storefront(row, _product_images(conn, pid))}


@router.put("/products/{product_id}")
def update_product(product_id: int, body: ProductBody, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        cat = conn.execute(
            "SELECT id FROM categories WHERE slug = ?", (body.category_slug,)
        ).fetchone()
        conn.execute(
            """
            UPDATE products SET
              title=?, brand_tag=?, volume=?, category_id=?, category_slug=?, family=?, intensity=?,
              occasion=?, sensation=?, price=?, old_price=?, badge=?, notes=?, description=?, ritual=?,
              ingredients=?, pyramid_top=?, pyramid_heart=?, pyramid_base=?, similar_ids=?, stock=?,
              active=?, weight_kg=?, height_cm=?, width_cm=?, length_cm=?, cover_image=?,
              updated_at=datetime('now')
            WHERE id=?
            """,
            (
                body.title,
                body.brand_tag,
                body.volume,
                cat["id"] if cat else None,
                body.category_slug,
                body.family,
                body.intensity,
                body.occasion,
                body.sensation,
                body.price,
                body.old_price,
                body.badge,
                body.notes,
                body.description,
                body.ritual,
                body.ingredients,
                body.pyramid_top,
                body.pyramid_heart,
                body.pyramid_base,
                json.dumps(body.similar_ids),
                body.stock,
                1 if body.active else 0,
                body.weight_kg,
                body.height_cm,
                body.width_cm,
                body.length_cm,
                body.cover_image,
                product_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        data = row_to_dict(row)
        data["similar_ids"] = parse_json_field(data.get("similar_ids"), [])
        return {"product": product_to_storefront(data, _product_images(conn, product_id))}


@router.delete("/products/{product_id}")
def delete_product(product_id: int, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute("DELETE FROM product_images WHERE product_id = ?", (product_id,))
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        conn.commit()
    return {"ok": True}


@router.post("/products/{product_id}/images")
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    _admin: dict = Depends(require_admin),
):
    settings = get_settings()
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Produto não encontrado")

    ext = Path(file.filename or "img.jpg").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="Formato de imagem inválido")

    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    name = f"{product_id}_{uuid.uuid4().hex}{ext}"
    dest = settings.uploads_dir / name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    url = f"/uploads/product-photos/{name}"
    with get_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM product_images WHERE product_id = ?", (product_id,)
        ).fetchone()["c"]
        is_cover = 1 if count == 0 else 0
        cur = conn.execute(
            "INSERT INTO product_images (product_id, url, sort_order, is_cover) VALUES (?, ?, ?, ?)",
            (product_id, url, count, is_cover),
        )
        if is_cover:
            conn.execute("UPDATE products SET cover_image = ? WHERE id = ?", (url, product_id))
        conn.commit()
        img = row_to_dict(conn.execute("SELECT * FROM product_images WHERE id = ?", (cur.lastrowid,)).fetchone())
    return {"image": img}


@router.patch("/products/{product_id}/images/{image_id}")
def set_cover(product_id: int, image_id: int, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        img = conn.execute(
            "SELECT * FROM product_images WHERE id = ? AND product_id = ?",
            (image_id, product_id),
        ).fetchone()
        if not img:
            raise HTTPException(status_code=404, detail="Imagem não encontrada")
        conn.execute("UPDATE product_images SET is_cover = 0 WHERE product_id = ?", (product_id,))
        conn.execute("UPDATE product_images SET is_cover = 1 WHERE id = ?", (image_id,))
        conn.execute("UPDATE products SET cover_image = ? WHERE id = ?", (img["url"], product_id))
        conn.commit()
    return {"ok": True}


@router.delete("/products/{product_id}/images/{image_id}")
def delete_image(product_id: int, image_id: int, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        img = conn.execute(
            "SELECT * FROM product_images WHERE id = ? AND product_id = ?",
            (image_id, product_id),
        ).fetchone()
        if not img:
            raise HTTPException(status_code=404, detail="Imagem não encontrada")
        conn.execute("DELETE FROM product_images WHERE id = ?", (image_id,))
        if img["is_cover"]:
            next_img = conn.execute(
                "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id LIMIT 1",
                (product_id,),
            ).fetchone()
            if next_img:
                conn.execute("UPDATE product_images SET is_cover = 1 WHERE id = ?", (next_img["id"],))
                conn.execute(
                    "UPDATE products SET cover_image = ? WHERE id = ?",
                    (next_img["url"], product_id),
                )
            else:
                conn.execute("UPDATE products SET cover_image = NULL WHERE id = ?", (product_id,))
        conn.commit()
    return {"ok": True}


@router.get("/orders")
def admin_orders(status: str | None = None, _admin: dict = Depends(require_admin)):
    sql = "SELECT * FROM orders"
    params: list = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with get_connection() as conn:
        orders = rows_to_list(conn.execute(sql, params).fetchall())
        for o in orders:
            o["items"] = rows_to_list(
                conn.execute("SELECT * FROM order_items WHERE order_id = ?", (o["id"],)).fetchall()
            )
            o["shipping_snapshot"] = parse_json_field(o.get("shipping_snapshot"), {})
    return {"orders": orders}


@router.patch("/orders/{order_id}")
def update_order_status(order_id: str, payload: dict, _admin: dict = Depends(require_admin)):
    status = str(payload.get("status") or "").strip()
    if status not in {"pending", "approved", "rejected", "shipped", "delivered", "cancelled"}:
        raise HTTPException(status_code=400, detail="Status inválido")
    with get_connection() as conn:
        conn.execute(
            "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, order_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return {"order": row_to_dict(row)}
