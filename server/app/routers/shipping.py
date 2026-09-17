from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection, rows_to_list
from ..services import cepcerto

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
    """Cotação CepCerto. Dimensões: soma de pesos; caixa = máximos das dimensões dos itens."""
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
            w = sum(float(r["weight_kg"] or 0.5) for r in rows)
            h = max(float(r["height_cm"] or 12) for r in rows)
            wd = max(float(r["width_cm"] or 8) for r in rows)
            ln = max(float(r["length_cm"] or 8) for r in rows)
            declared = max(declared, sum(float(r["price"] or 0) for r in rows))

    w = w if w is not None else 0.5
    h = h if h is not None else 12
    wd = wd if wd is not None else 8
    ln = ln if ln is not None else 8

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
