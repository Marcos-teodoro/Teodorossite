"""Mercado Pago Payment API helpers (sdk-python)."""
from __future__ import annotations

from typing import Any

import mercadopago

from ..config import get_settings


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
