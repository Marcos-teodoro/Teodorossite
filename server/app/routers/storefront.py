from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection

router = APIRouter(prefix="/api/storefront", tags=["storefront"])


@router.get("/config")
def storefront_config():
    with get_connection() as conn:
        rows = conn.execute("SELECT key, value FROM site_settings").fetchall()
    return {"settings": {row["key"]: row["value"] for row in rows}}


@router.get("/coupon")
def validate_coupon(code: str = Query(...), subtotal: float = Query(..., ge=0)):
    normalized = code.strip().upper()
    with get_connection() as conn:
        coupon = conn.execute(
            """
            SELECT * FROM coupons
            WHERE code = ? AND active = 1
              AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now'))
              AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now'))
              AND (usage_limit IS NULL OR uses_count < usage_limit)
            """,
            (normalized,),
        ).fetchone()
    if not coupon:
        raise HTTPException(status_code=404, detail="Cupom invalido ou expirado")
    if subtotal < float(coupon["min_order"] or 0):
        raise HTTPException(status_code=400, detail=f"Pedido minimo: R$ {coupon['min_order']:.2f}")
    discount = subtotal * float(coupon["discount_value"]) / 100 if coupon["discount_type"] == "percent" else float(coupon["discount_value"])
    return {
        "coupon": {
            "code": coupon["code"],
            "type": coupon["discount_type"],
            "value": float(coupon["discount_value"]),
            "minOrder": float(coupon["min_order"] or 0),
            "discount": round(min(subtotal, discount), 2),
        }
    }
