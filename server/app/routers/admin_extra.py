from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_admin
from ..db import get_connection, parse_json_field, row_to_dict, rows_to_list
from ..schemas import CouponBody

router = APIRouter(prefix="/api/admin", tags=["admin"])

ALLOWED_SETTINGS = {
    "hero_eyebrow", "hero_title", "hero_image", "hero_button", "whatsapp_url",
    "instagram_url", "facebook_url", "youtube_url", "pinterest_url",
    "installments", "footer_description",
}


def audit(conn, admin: dict, action: str, entity_type: str, entity_id: str | int | None, details: dict | None = None):
    conn.execute(
        "INSERT INTO admin_audit_log (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
        (admin.get("id"), action, entity_type, str(entity_id) if entity_id is not None else None, json.dumps(details or {}, ensure_ascii=False)),
    )


@router.get("/settings")
def get_settings(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute("SELECT key, value, updated_at FROM site_settings ORDER BY key").fetchall()
    return {"settings": {row["key"]: row["value"] for row in rows}}


@router.put("/settings")
def update_settings(payload: dict, admin: dict = Depends(require_admin)):
    clean = {key: str(value or "") for key, value in payload.items() if key in ALLOWED_SETTINGS}
    with get_connection() as conn:
        for key, value in clean.items():
            conn.execute(
                "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
                (key, value),
            )
        audit(conn, admin, "update", "site_settings", None, {"keys": list(clean)})
        conn.commit()
    return {"settings": clean}


@router.get("/coupons")
def list_coupons(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        return {"coupons": rows_to_list(conn.execute("SELECT * FROM coupons ORDER BY id DESC").fetchall())}


@router.post("/coupons")
def create_coupon(body: CouponBody, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO coupons
                (code, discount_type, discount_value, min_order, usage_limit, starts_at, ends_at, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (body.code, body.discount_type, body.discount_value, body.min_order, body.usage_limit, body.starts_at, body.ends_at, 1 if body.active else 0),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Codigo de cupom ja existe ou dados invalidos") from exc
        audit(conn, admin, "create", "coupon", cur.lastrowid, {"code": body.code})
        conn.commit()
        row = conn.execute("SELECT * FROM coupons WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"coupon": row_to_dict(row)}


@router.put("/coupons/{coupon_id}")
def update_coupon(coupon_id: int, body: CouponBody, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute(
            """UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_order=?, usage_limit=?,
            starts_at=?, ends_at=?, active=?, updated_at=datetime('now') WHERE id=?""",
            (body.code, body.discount_type, body.discount_value, body.min_order, body.usage_limit, body.starts_at, body.ends_at, 1 if body.active else 0, coupon_id),
        )
        row = conn.execute("SELECT * FROM coupons WHERE id = ?", (coupon_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Cupom nao encontrado")
        audit(conn, admin, "update", "coupon", coupon_id, {"code": body.code})
        conn.commit()
    return {"coupon": row_to_dict(row)}


@router.delete("/coupons/{coupon_id}")
def deactivate_coupon(coupon_id: int, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute("UPDATE coupons SET active=0, updated_at=datetime('now') WHERE id=?", (coupon_id,))
        audit(conn, admin, "deactivate", "coupon", coupon_id)
        conn.commit()
    return {"ok": True}


@router.get("/customers")
def customers(q: str | None = None, _admin: dict = Depends(require_admin)):
    sql = """SELECT p.id, p.email, p.name, p.phone, p.created_at,
      COUNT(o.id) AS orders_count,
      COALESCE(SUM(CASE WHEN o.status IN ('approved','shipped','delivered') THEN o.total ELSE 0 END), 0) AS total_spent
      FROM profiles p LEFT JOIN orders o ON o.user_id = p.id WHERE p.role = 'customer'"""
    params: list = []
    if q:
        sql += " AND (p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)"
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    sql += " GROUP BY p.id ORDER BY p.created_at DESC"
    with get_connection() as conn:
        return {"customers": rows_to_list(conn.execute(sql, params).fetchall())}


@router.get("/orders/{order_id}/detail")
def order_detail(order_id: str, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido nao encontrado")
        order = row_to_dict(row)
        order["items"] = rows_to_list(conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall())
        order["shipping_snapshot"] = parse_json_field(order.get("shipping_snapshot"), {})
        order["history"] = rows_to_list(conn.execute("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC", (order_id,)).fetchall())
    return {"order": order}


@router.patch("/orders/{order_id}/fulfillment")
def update_fulfillment(order_id: str, payload: dict, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido nao encontrado")
        conn.execute(
            "UPDATE orders SET tracking_code=?, tracking_url=?, admin_notes=?, updated_at=datetime('now') WHERE id=?",
            (str(payload.get("tracking_code") or ""), str(payload.get("tracking_url") or ""), str(payload.get("admin_notes") or ""), order_id),
        )
        audit(conn, admin, "update_fulfillment", "order", order_id)
        conn.commit()
    return {"ok": True}


@router.get("/inventory-movements")
def inventory_movements(limit: int = 100, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT m.*, p.title, v.label AS variant_label FROM inventory_movements m
            LEFT JOIN products p ON p.id=m.product_id LEFT JOIN product_variants v ON v.id=m.variant_id
            ORDER BY m.id DESC LIMIT ?""", (max(1, min(limit, 500)),),
        ).fetchall()
    return {"movements": rows_to_list(rows)}


@router.get("/audit")
def audit_log(limit: int = 100, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)).fetchall()
    return {"entries": rows_to_list(rows)}
