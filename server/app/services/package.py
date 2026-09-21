"""Embalagem única de envio Teodora: 25 × 20 × 10 cm, tara 150 g."""

from __future__ import annotations

import json

from ..db import get_connection

# Comprimento × largura × altura (medida informada pelo fornecedor)
DEFAULT_LENGTH_CM = 25.0
DEFAULT_WIDTH_CM = 20.0
DEFAULT_HEIGHT_CM = 10.0
DEFAULT_TARE_KG = 0.15  # 150 g
DEFAULT_WEIGHT_KG = 0.5  # fallback se produto sem peso

DEFAULT_BOX = {
    "id": "cx-unica",
    "nome": "Caixa padrão Teodora",
    "codigo": "CX-01",
    "desc": "Embalagem única de envio — 25 × 20 × 10 cm",
    "altura": DEFAULT_HEIGHT_CM,
    "largura": DEFAULT_WIDTH_CM,
    "comprimento": DEFAULT_LENGTH_CM,
    "tara": DEFAULT_TARE_KG,
    "isDefault": True,
}


def load_shipping_boxes() -> list[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT value FROM site_settings WHERE key = ?",
            ("shipping_boxes_json",),
        ).fetchone()
    if not row or not (row["value"] or "").strip():
        return [dict(DEFAULT_BOX)]
    try:
        data = json.loads(row["value"])
        if isinstance(data, list) and data:
            return data
    except json.JSONDecodeError:
        pass
    return [dict(DEFAULT_BOX)]


def default_package_dims() -> dict[str, float]:
    boxes = load_shipping_boxes()
    default = next((b for b in boxes if b.get("isDefault")), None) or boxes[0]
    return {
        "height_cm": float(default.get("altura") or DEFAULT_HEIGHT_CM),
        "width_cm": float(default.get("largura") or DEFAULT_WIDTH_CM),
        "length_cm": float(default.get("comprimento") or DEFAULT_LENGTH_CM),
        "tare_kg": float(default.get("tara") or DEFAULT_TARE_KG),
    }
