from __future__ import annotations

import json
import re
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import require_user
from ..config import get_settings
from ..db import get_connection, row_to_dict, rows_to_list
from ..schemas import PaymentBody, PrepareBody
from ..services import mercadopago_svc
from ..services.inventory import transition_order_stock

router = APIRouter(prefix="/api", tags=["checkout"])


def round_money(n: float) -> float:
    return round(float(n) * 100) / 100


def build_validated_order(body: PrepareBody) -> dict[str, Any]:
    if not body.items:
        raise HTTPException(status_code=400, detail="Carrinho vazio.")

    with get_connection() as conn:
        lines = []
        for item in body.items:
            row = conn.execute(
                "SELECT id, title, price, active, stock FROM products WHERE id = ?",
                (item.id,),
            ).fetchone()
            if not row or not row["active"]:
                raise HTTPException(status_code=400, detail=f"Produto inválido: {item.id}")
            variant = None
            if item.variant_id is not None:
                variant = conn.execute(
                    "SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND active = 1",
                    (item.variant_id, item.id),
                ).fetchone()
                if not variant:
                    raise HTTPException(status_code=400, detail=f"Variante invalida para {row['title']}")
            qty = max(1, min(20, int(item.quantity or 1)))
            available_stock = int(variant["stock"] if variant else row["stock"] or 0)
            if qty > available_stock:
                raise HTTPException(
                    status_code=409,
                    detail=f"Estoque insuficiente para {row['title']}. Disponível: {available_stock}",
                )
            lines.append(
                {
                    "product_id": row["id"],
                    "variant_id": variant["id"] if variant else None,
                    "variant_label": variant["label"] if variant else "",
                    "sku": variant["sku"] if variant else "",
                    "title": row["title"][:250],
                    "quantity": qty,
                    "unit_price": round_money(variant["price"] if variant else row["price"]),
                }
            )
        merchandise = round_money(sum(l["unit_price"] * l["quantity"] for l in lines))
        coupon_code = (body.coupon_code or "").upper().strip()
        coupon_discount = 0.0
        if coupon_code:
            coupon = conn.execute(
                """
                SELECT * FROM coupons
                WHERE code = ? AND active = 1
                  AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now'))
                  AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now'))
                  AND (usage_limit IS NULL OR uses_count < usage_limit)
                """,
                (coupon_code,),
            ).fetchone()
            if not coupon:
                raise HTTPException(status_code=400, detail="Cupom invalido ou expirado")
            if merchandise < float(coupon["min_order"] or 0):
                raise HTTPException(status_code=400, detail=f"Pedido minimo do cupom: R$ {coupon['min_order']:.2f}")
            if coupon["discount_type"] == "percent":
                coupon_discount = round_money(merchandise * float(coupon["discount_value"]) / 100)
            else:
                coupon_discount = min(merchandise, round_money(coupon["discount_value"]))
            merchandise = round_money(merchandise - coupon_discount)

    shipping_cost = max(0.0, round_money(body.shipping_cost or 0))
    settings = get_settings()
    shipping_option = body.shipping_option or {}
    if settings.cepcerto_postage_token:
        dest_cep = re.sub(r"\D", "", str(shipping_option.get("cep") or ""))
        if len(dest_cep) != 8:
            raise HTTPException(status_code=400, detail="Informe um CEP válido e calcule o frete.")
        if not shipping_option.get("code") and not shipping_option.get("name"):
            raise HTTPException(status_code=400, detail="Selecione uma opção de frete antes de pagar.")

    total = round_money(merchandise + shipping_cost)

    payment_hint = (body.payment_hint or "card").lower()
    pix_discount = 0.0

    if total <= 0:
        raise HTTPException(status_code=400, detail="Total inválido.")

    return {
        "lines": lines,
        "merchandise": merchandise,
        "shipping_cost": shipping_cost,
        "coupon_code": coupon_code,
        "coupon_discount": coupon_discount,
        "pix_discount": pix_discount,
        "payment_hint": payment_hint,
        "total": total,
    }


@router.post("/checkout/prepare")
def checkout_prepare(
    body: PrepareBody,
    user: dict = Depends(require_user),
):
    validated = build_validated_order(body)
    order_id = str(uuid4())
    payer = body.payer or {}
    shipping_snapshot = dict(body.shipping_option or {})
    # Normaliza campos de endereço no snapshot
    if payer.get("addressNumber") or payer.get("address_number"):
        shipping_snapshot["address_number"] = payer.get("addressNumber") or payer.get("address_number")
    if payer.get("addressComplement") or payer.get("address_complement"):
        shipping_snapshot["address_complement"] = payer.get("addressComplement") or payer.get("address_complement")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO orders (
              id, user_id, status, merchandise, shipping_cost, coupon_code, coupon_discount,
              pix_discount, total, payment_hint, payer_name, payer_email, payer_doc,
              payer_phone, payer_address, shipping_snapshot
            ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                user["id"] if user else None,
                validated["merchandise"],
                validated["shipping_cost"],
                validated["coupon_code"],
                validated["coupon_discount"],
                validated["pix_discount"],
                validated["total"],
                validated["payment_hint"],
                payer.get("name"),
                payer.get("email"),
                payer.get("doc"),
                payer.get("phone"),
                payer.get("address"),
                json.dumps(shipping_snapshot, ensure_ascii=False),
            ),
        )
        for line in validated["lines"]:
            conn.execute(
                """
                INSERT INTO order_items
                  (order_id, product_id, variant_id, sku, variant_label, title, unit_price, quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    line["product_id"],
                    line["variant_id"],
                    line["sku"],
                    line["variant_label"],
                    line["title"],
                    line["unit_price"],
                    line["quantity"],
                ),
            )
        conn.commit()

    settings = get_settings()
    return {
        "orderId": order_id,
        "amount": validated["total"],
        "currency": "BRL",
        "publicKey": settings.mp_public_key,
        "paymentHint": validated["payment_hint"],
        "breakdown": {
            "merchandise": validated["merchandise"],
            "shipping": validated["shipping_cost"],
            "couponDiscount": validated["coupon_discount"],
            "pixDiscount": validated["pix_discount"],
        },
    }


@router.post("/payments")
def create_payment(
    body: PaymentBody,
    user: dict = Depends(require_user),
):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (body.order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
        order = row_to_dict(row)
        if order.get("user_id") != user["id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Sem permissão")

    form = body.form_data or {}
    # Brick envia transaction_amount; forçamos o valor revalidado no servidor
    payment_payload: dict[str, Any] = {
        **form,
        "transaction_amount": float(order["total"]),
        "external_reference": order["id"],
        "description": f"Pedido Teodora {order['id'][:8]}",
        "notification_url": f"{get_settings().base_url.rstrip('/')}/api/webhooks/mercadopago",
    }
    if order.get("payer_email") and not payment_payload.get("payer"):
        payment_payload["payer"] = {"email": order["payer_email"]}
    elif order.get("payer_email") and isinstance(payment_payload.get("payer"), dict):
        payment_payload["payer"].setdefault("email", order["payer_email"])

    try:
        result = mercadopago_svc.create_payment(payment_payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    mp_id = str(result.get("id") or "")
    mp_status = result.get("status")
    mapped = mercadopago_svc.map_mp_status(mp_status)

    with get_connection() as conn:
        previous = conn.execute("SELECT status FROM orders WHERE id = ?", (body.order_id,)).fetchone()["status"]
        transition_order_stock(conn, body.order_id, mapped)
        conn.execute(
            """
            UPDATE orders SET mp_payment_id = ?, mp_status = ?, status = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (mp_id, mp_status, mapped, body.order_id),
        )
        if previous != mapped:
            conn.execute(
                "INSERT INTO order_status_history (order_id, old_status, new_status, source) VALUES (?, ?, ?, 'mercadopago')",
                (body.order_id, previous, mapped),
            )
        conn.commit()

    return {
        "orderId": body.order_id,
        "paymentId": mp_id,
        "status": mapped,
        "mpStatus": mp_status,
        "statusDetail": result.get("status_detail"),
        "pointOfInteraction": result.get("point_of_interaction"),
        "transactionDetails": result.get("transaction_details"),
    }


@router.post("/webhooks/mercadopago")
async def mercadopago_webhook(request: Request):
    payload = {}
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    payment_id = None
    if isinstance(payload, dict):
        data = payload.get("data") or {}
        payment_id = data.get("id") or payload.get("id")
    # Também aceita query ?data.id=
    if not payment_id:
        payment_id = request.query_params.get("data.id") or request.query_params.get("id")

    if payment_id:
        try:
            payment = mercadopago_svc.get_payment(payment_id)
            ext = payment.get("external_reference")
            status = mercadopago_svc.map_mp_status(payment.get("status"))
            if ext:
                with get_connection() as conn:
                    previous_row = conn.execute("SELECT status FROM orders WHERE id = ?", (ext,)).fetchone()
                    transition_order_stock(conn, ext, status)
                    conn.execute(
                        """
                        UPDATE orders SET mp_payment_id = ?, mp_status = ?, status = ?, updated_at = datetime('now')
                        WHERE id = ?
                        """,
                        (str(payment.get("id")), payment.get("status"), status, ext),
                    )
                    if previous_row and previous_row["status"] != status:
                        conn.execute(
                            "INSERT INTO order_status_history (order_id, old_status, new_status, source) VALUES (?, ?, ?, 'webhook')",
                            (ext, previous_row["status"], status),
                        )
                    conn.commit()
        except Exception as exc:
            print(f"[webhook] erro: {exc}")

    return {"ok": True}


# Compatibilidade temporária com front antigo (Checkout Pro redirect)
@router.post("/create-preference")
def legacy_create_preference(
    body: PrepareBody,
    user: dict = Depends(require_user),
):
    """Mantém rota antiga: prepara pedido e sugere migrar para Payment Brick."""
    prepared = checkout_prepare(body, user)
    settings = get_settings()
    return {
        **prepared,
        "deprecated": True,
        "message": "Use POST /api/checkout/prepare + Payment Brick. Preference redirect descontinuado.",
        "publicKey": settings.mp_public_key,
        # Sem init_point — front novo usa Brick
        "init_point": None,
        "external_reference": prepared["orderId"],
        "total": prepared["amount"],
    }
