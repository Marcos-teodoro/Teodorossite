from __future__ import annotations

import asyncio
import json
import re
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import is_valid_email, require_user
from ..config import get_settings
from ..db import get_connection, row_to_dict, rows_to_list
from ..schemas import PaymentBody, PrepareBody
from ..services import cepcerto, mercadopago_svc
from ..services.inventory import transition_order_stock
from .shipping import build_package

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

    shipping_option = dict(body.shipping_option or {})
    dest_cep = re.sub(r"\D", "", str(shipping_option.get("cep") or ""))
    if len(dest_cep) != 8:
        raise HTTPException(status_code=400, detail="Informe um CEP válido e calcule o frete.")
    chosen_code = str(shipping_option.get("code") or "").strip()
    chosen_name = str(shipping_option.get("name") or "").strip()
    if not chosen_code and not chosen_name:
        raise HTTPException(status_code=400, detail="Selecione uma opção de frete antes de pagar.")

    # O valor do frete NUNCA vem do navegador: recotamos no servidor (CepCerto) e usamos esse preço.
    qty_map: dict[int, int] = {}
    for line in lines:
        qty_map[line["product_id"]] = qty_map.get(line["product_id"], 0) + line["quantity"]
    subtotal_lines = round_money(sum(l["unit_price"] * l["quantity"] for l in lines))
    pkg = build_package(list(qty_map), qty_map, declared_value=subtotal_lines)
    try:
        quote = asyncio.run(
            cepcerto.quote_freight(
                dest_cep=dest_cep,
                weight_kg=pkg["weight_kg"],
                height_cm=pkg["height_cm"],
                width_cm=pkg["width_cm"],
                length_cm=pkg["length_cm"],
                declared_value=pkg["declared_value"],
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Não foi possível confirmar o frete: {exc}") from exc
    match = next(
        (
            o
            for o in quote.get("options", [])
            if (chosen_code and o.get("code") == chosen_code)
            or (not chosen_code and o.get("name") == chosen_name)
        ),
        None,
    )
    if not match:
        raise HTTPException(status_code=400, detail="Opção de frete indisponível. Recalcule o frete.")
    shipping_cost = max(0.0, round_money(match["price"]))
    shipping_option.update(
        {
            "code": match.get("code"),
            "name": match.get("name"),
            "price": shipping_cost,
            "days": match.get("days"),
            "carrier": match.get("carrier"),
            "originCep": match.get("originCep"),
            "originLabel": match.get("originLabel"),
            "cep": dest_cep,
        }
    )

    total = round_money(merchandise + shipping_cost)

    payment_hint = (body.payment_hint or "card").lower()
    pix_discount = 0.0

    if total <= 0:
        raise HTTPException(status_code=400, detail="Total inválido.")

    return {
        "lines": lines,
        "merchandise": merchandise,
        "shipping_cost": shipping_cost,
        "shipping_option": shipping_option,
        "coupon_code": coupon_code,
        "coupon_discount": coupon_discount,
        "pix_discount": pix_discount,
        "payment_hint": payment_hint,
        "total": total,
    }


def _validate_payer(payer: dict[str, Any]) -> None:
    if not str(payer.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="Informe o nome do comprador.")
    if not is_valid_email(str(payer.get("email") or "")):
        raise HTTPException(status_code=400, detail="Informe um e-mail válido.")
    doc = re.sub(r"\D", "", str(payer.get("doc") or ""))
    if len(doc) not in (11, 14):
        raise HTTPException(status_code=400, detail="Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.")
    phone = re.sub(r"\D", "", str(payer.get("phone") or ""))
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="Informe um telefone com DDD.")
    if not str(payer.get("addressNumber") or payer.get("address_number") or "").strip():
        raise HTTPException(status_code=400, detail="Informe o número do endereço de entrega.")


@router.post("/checkout/prepare")
def checkout_prepare(
    body: PrepareBody,
    user: dict = Depends(require_user),
):
    validated = build_validated_order(body)
    order_id = str(uuid4())
    payer = body.payer or {}
    _validate_payer(payer)
    shipping_snapshot = dict(validated["shipping_option"])
    if body.shipping_option:
        for key in ("address", "address_number", "address_complement"):
            if body.shipping_option.get(key) not in (None, ""):
                shipping_snapshot[key] = body.shipping_option[key]
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


PAID_STATES = {"approved", "shipped", "delivered"}
FINAL_STATES = PAID_STATES | {"cancelled"}


def apply_payment_result(conn, order_id: str, payment: dict[str, Any], source: str) -> str:
    """Grava o resultado do Mercado Pago no pedido (usado pela rota de pagamento e pelo webhook)."""
    mp_status = payment.get("status")
    mapped = mercadopago_svc.map_mp_status(mp_status)
    row = conn.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    previous = row["status"]

    # Não regride pedido já enviado/entregue/cancelado por notificação repetida do MP.
    if previous in {"shipped", "delivered"} and mapped in {"approved", "pending"}:
        mapped = previous
    elif previous == "cancelled" and mapped == "pending":
        mapped = previous

    note = source
    try:
        transition_order_stock(conn, order_id, mapped)
    except HTTPException as exc:
        if exc.status_code != 409 or mapped not in PAID_STATES:
            raise
        # Pago, mas o estoque acabou no meio do caminho: registra o pagamento e sinaliza para o admin.
        note = f"{source}:sem-estoque"

    conn.execute(
        """
        UPDATE orders SET mp_payment_id = ?, mp_status = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (str(payment.get("id") or ""), mp_status, mapped, order_id),
    )
    if previous != mapped or note != source:
        conn.execute(
            "INSERT INTO order_status_history (order_id, old_status, new_status, source) VALUES (?, ?, ?, ?)",
            (order_id, previous, mapped, note),
        )
    conn.commit()
    return mapped


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
        if order.get("status") in FINAL_STATES:
            raise HTTPException(status_code=409, detail="Este pedido já foi pago ou encerrado.")

    form = body.form_data or {}
    # Brick envia transaction_amount; forçamos o valor revalidado no servidor
    payment_payload: dict[str, Any] = {
        **form,
        "transaction_amount": float(order["total"]),
        "external_reference": order["id"],
        "description": f"Pedido Teodora {order['id'][:8]}",
    }
    base_url = get_settings().base_url.rstrip("/")
    if base_url.startswith("https://"):
        # O MP recusa URL de notificação local/http; em dev o status vem na resposta do pagamento.
        payment_payload["notification_url"] = f"{base_url}/api/webhooks/mercadopago"
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
    with get_connection() as conn:
        mapped = apply_payment_result(conn, body.order_id, result, "mercadopago")

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
    topic = request.query_params.get("type") or request.query_params.get("topic")
    if isinstance(payload, dict):
        topic = topic or payload.get("type") or payload.get("topic")
        data = payload.get("data") or {}
        payment_id = data.get("id") or payload.get("id")
    # Também aceita query ?data.id=
    if not payment_id:
        payment_id = request.query_params.get("data.id") or request.query_params.get("id")

    # Só processa notificações de pagamento (ignora merchant_order etc.)
    if payment_id and (not topic or str(topic).startswith("payment")):
        try:
            # Sempre consulta o pagamento direto na API do MP: o corpo do webhook não é confiável.
            payment = mercadopago_svc.get_payment(payment_id)
            ext = payment.get("external_reference")
            if ext:
                with get_connection() as conn:
                    apply_payment_result(conn, ext, payment, "webhook")
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
