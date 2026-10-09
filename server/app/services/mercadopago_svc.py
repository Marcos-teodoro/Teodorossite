"""Mercado Pago Payment API helpers (sdk-python)."""
from __future__ import annotations

import hashlib
from typing import Any

import httpx
import mercadopago

from ..config import get_settings
from .http import SSL_CTX


def get_sdk() -> mercadopago.SDK:
    settings = get_settings()
    if not settings.mp_access_token:
        raise RuntimeError("MP_ACCESS_TOKEN não configurado")
    return mercadopago.SDK(settings.mp_access_token)


def create_payment(payment_data: dict[str, Any]) -> dict[str, Any]:
    sdk = get_sdk()
    result = sdk.payment().create(payment_data)
    response = result.get("response") or {}
    status = result.get("status")
    if status not in (200, 201):
        print(f"[mercadopago] /v1/payments {status}: {str(response)[:2000]}")
        message = (
            (response.get("message") if isinstance(response, dict) else None)
            or (response.get("error") if isinstance(response, dict) else None)
            or f"Mercado Pago status {status}"
        )
        raise RuntimeError(str(message))
    return response


def get_payment(payment_id: str | int) -> dict[str, Any]:
    sdk = get_sdk()
    result = sdk.payment().get(payment_id)
    return result.get("response") or {}


def map_mp_status(mp_status: str | None) -> str:
    s = (mp_status or "").lower()
    if s == "approved":
        return "approved"
    if s in ("pending", "in_process", "in_mediation", "authorized"):
        return "pending"
    if s in ("rejected", "cancelled", "refunded", "charged_back"):
        return "rejected"
    return "pending"


# ---------------------------------------------------------------------------
# API Orders (/v1/orders)
# ---------------------------------------------------------------------------

ORDERS_URL = "https://api.mercadopago.com/v1/orders"


def _orders_headers(idempotency_key: str | None = None) -> dict[str, str]:
    settings = get_settings()
    if not settings.mp_access_token:
        raise RuntimeError("MP_ACCESS_TOKEN não configurado")
    headers = {"Authorization": f"Bearer {settings.mp_access_token}"}
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key
    return headers


def normalize_order(order: dict[str, Any]) -> dict[str, Any]:
    """Converte uma Order do MP no formato de pagamento usado pelo resto do sistema."""
    payments = (order.get("transactions") or {}).get("payments") or [{}]
    pay = payments[0] or {}
    st = str(order.get("status") or "").lower()
    detail = pay.get("status_detail") or order.get("status_detail")

    if st == "processed":
        status = "approved"
    elif st in ("action_required", "created", "processing", "in_process", "pending"):
        status = "pending"
    elif st in ("refunded", "partially_refunded"):
        status = "refunded"
    elif st in ("canceled", "cancelled", "expired"):
        status = "cancelled"
    else:  # failed e qualquer estado desconhecido de erro
        status = "rejected"

    method = pay.get("payment_method") or {}
    transaction_data = {
        k: method.get(k) for k in ("qr_code", "qr_code_base64", "ticket_url", "barcode_content") if method.get(k)
    }
    return {
        "id": order.get("id"),
        "payment_id": pay.get("id"),
        "status": status,
        "status_detail": detail,
        "external_reference": order.get("external_reference"),
        "point_of_interaction": {"transaction_data": transaction_data} if transaction_data else None,
        "transaction_details": {"payment_method_id": method.get("id")},
        "raw_status": st,
    }


def create_order(
    *,
    order_ref: str,
    total: float,
    form: dict[str, Any],
    payer_email: str,
    description: str,
) -> dict[str, Any]:
    """Cria uma Order a partir do formData do Payment Brick e devolve o resultado normalizado."""
    method_id = str(form.get("payment_method_id") or "").lower()
    token = form.get("token")
    if method_id == "pix":
        method: dict[str, Any] = {"id": "pix", "type": "bank_transfer"}
    elif not token and method_id:
        method = {"id": method_id, "type": "ticket"}
    else:
        method = {
            "id": method_id,
            "type": form.get("payment_type_id") or "credit_card",
            "token": token,
            "installments": int(form.get("installments") or 1),
        }
        if form.get("issuer_id"):
            method["issuer_id"] = str(form["issuer_id"])

    # Com credenciais de teste, a API Orders só aceita este e-mail de comprador (outros dão 422).
    if get_settings().mp_sandbox:
        payer_email = "test@testuser.com"
    payer: dict[str, Any] = {"email": payer_email}
    form_payer = form.get("payer") if isinstance(form.get("payer"), dict) else {}
    if form_payer.get("identification"):
        payer["identification"] = form_payer["identification"]

    amount = f"{float(total):.2f}"
    body = {
        "type": "online",
        "processing_mode": "automatic",
        "total_amount": amount,
        "external_reference": order_ref,
        "description": description,
        "payer": payer,
        "transactions": {"payments": [{"amount": amount, "payment_method": method}]},
    }
    # Chave determinística: duplo clique no mesmo pedido/cartão não cobra duas vezes.
    key = hashlib.sha1(f"{order_ref}:{token or method_id}".encode()).hexdigest()
    resp = httpx.post(ORDERS_URL, headers=_orders_headers(key), json=body, timeout=60, verify=SSL_CTX)
    data = resp.json() if resp.content else {}
    if resp.status_code in (200, 201):
        return normalize_order(data)
    # 402 = pagamento recusado: a Order vem em "data" e deve ser tratada como recusa, não como erro de API.
    if resp.status_code == 402 and isinstance(data.get("data"), dict):
        return normalize_order(data["data"])
    print(f"[mercadopago] /v1/orders {resp.status_code}: {resp.text[:2000]}")
    errors = data.get("errors") if isinstance(data, dict) else None
    first = errors[0] if errors and isinstance(errors[0], dict) else {}
    message = first.get("message") or data.get("message") or f"Mercado Pago status {resp.status_code}"
    details = first.get("details")
    if details:
        message = f"{message} ({'; '.join(map(str, details))})"
    elif first.get("code"):
        message = f"{message} ({first['code']})"
    raise RuntimeError(str(message))


def get_order(order_id: str) -> dict[str, Any]:
    resp = httpx.get(f"{ORDERS_URL}/{order_id}", headers=_orders_headers(), timeout=30, verify=SSL_CTX)
    resp.raise_for_status()
    return normalize_order(resp.json())
