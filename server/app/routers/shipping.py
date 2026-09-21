from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection, rows_to_list
from ..services import cepcerto
from ..services.package import DEFAULT_WEIGHT_KG, default_package_dims

router = APIRouter(prefix="/api/shipping", tags=["shipping"])


@router.get("/cep/{cep}")
async def shipping_cep(cep: str):
    try:
        return await cepcerto.lookup_cep(cep)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar CEP: {exc}") from exc


@router.get("/quote")
async def shipping_quote(
    cep: str = Query(...),
    weight: float | None = None,
    height: float | None = None,
    width: float | None = None,
    length: float | None = None,
    declared_value: float = Query(50, alias="declared_value"),
    product_ids: str | None = Query(None, description="ids separados por vírgula"),
):
    """Cotação CepCerto. Usa embalagem padrão (25×20×10) quando produto não tem dimensões."""
    pkg = default_package_dims()
    w = weight
    h = height
    wd = width
    ln = length
    declared = declared_value

    if product_ids:
        ids = [int(x) for x in product_ids.split(",") if x.strip().isdigit()]
        with get_connection() as conn:
            rows = rows_to_list(
                conn.execute(
                    f"SELECT weight_kg, height_cm, width_cm, length_cm, price FROM products WHERE id IN ({','.join('?' * len(ids))})",
                    ids,
                ).fetchall()
            ) if ids else []
        if rows:
            w = sum(float(r["weight_kg"] or DEFAULT_WEIGHT_KG) for r in rows)
            h = max(float(r["height_cm"] or pkg["height_cm"]) for r in rows)
            wd = max(float(r["width_cm"] or pkg["width_cm"]) for r in rows)
            ln = max(float(r["length_cm"] or pkg["length_cm"]) for r in rows)
            declared = max(declared, sum(float(r["price"] or 0) for r in rows))

    w = w if w is not None else DEFAULT_WEIGHT_KG + pkg["tare_kg"]
    h = h if h is not None else pkg["height_cm"]
    wd = wd if wd is not None else pkg["width_cm"]
    ln = ln if ln is not None else pkg["length_cm"]

    # Regra única: soma altura+largura+comprimento <= 200 (CepCerto)
    while (h + wd + ln) > 200:
        h = max(1, h * 0.9)
        wd = max(1, wd * 0.9)
        ln = max(1, ln * 0.9)

    try:
        result = await cepcerto.quote_freight(
            dest_cep=cep,
            weight_kg=w,
            height_cm=h,
            width_cm=wd,
            length_cm=ln,
            declared_value=declared,
        )
        result["package"] = {
            "weight_kg": round(w, 3),
            "height_cm": round(h, 2),
            "width_cm": round(wd, 2),
            "length_cm": round(ln, 2),
            "declared_value": round(declared, 2),
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
