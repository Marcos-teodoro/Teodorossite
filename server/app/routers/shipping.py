from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_connection, rows_to_list
from ..services import cepcerto
from ..services.package import DEFAULT_WEIGHT_KG, default_package_dims

router = APIRouter(prefix="/api/shipping", tags=["shipping"])


def friendly_freight_error(exc: Exception) -> str:
    """Mensagem para o cliente (os textos da CepCerto falam de token e limite, que ele não precisa ver)."""
    text = str(exc).lower()
    if "limite" in text or "token" in text or "saldo" in text:
        print(f"[frete] CepCerto recusou a cotação: {exc}")
        return "Não conseguimos calcular o frete agora. Tente novamente em alguns minutos ou fale com a gente pelo WhatsApp."
    return f"Não conseguimos calcular o frete: {exc}"


@router.get("/cep/{cep}")
async def shipping_cep(cep: str):
    try:
        return await cepcerto.lookup_cep(cep)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar CEP: {exc}") from exc


def build_package(
    ids: list[int],
    quantities: dict[int, int] | None = None,
    *,
    weight: float | None = None,
    height: float | None = None,
    width: float | None = None,
    length: float | None = None,
    declared_value: float = 50,
) -> dict[str, float]:
    """Peso/dimensões/valor declarado usados na cotação (mesma regra no quote e no checkout)."""
    pkg = default_package_dims()
    w, h, wd, ln, declared = weight, height, width, length, declared_value
    qty = quantities or {}

    if ids:
        with get_connection() as conn:
            rows = rows_to_list(
                conn.execute(
                    f"SELECT id, weight_kg, height_cm, width_cm, length_cm, price FROM products WHERE id IN ({','.join('?' * len(ids))})",
                    ids,
                ).fetchall()
            )
        if rows:
            w = sum(float(r["weight_kg"] or DEFAULT_WEIGHT_KG) * max(1, qty.get(r["id"], 1)) for r in rows)
            h = max(float(r["height_cm"] or pkg["height_cm"]) for r in rows)
            wd = max(float(r["width_cm"] or pkg["width_cm"]) for r in rows)
            ln = max(float(r["length_cm"] or pkg["length_cm"]) for r in rows)
            declared = max(declared, sum(float(r["price"] or 0) * max(1, qty.get(r["id"], 1)) for r in rows))

    w = w if w is not None else DEFAULT_WEIGHT_KG + pkg["tare_kg"]
    h = h if h is not None else pkg["height_cm"]
    wd = wd if wd is not None else pkg["width_cm"]
    ln = ln if ln is not None else pkg["length_cm"]

    # Regra única: soma altura+largura+comprimento <= 200 (CepCerto)
    while (h + wd + ln) > 200:
        h = max(1, h * 0.9)
        wd = max(1, wd * 0.9)
        ln = max(1, ln * 0.9)

    return {"weight_kg": w, "height_cm": h, "width_cm": wd, "length_cm": ln, "declared_value": declared}


@router.get("/quote")
async def shipping_quote(
    cep: str = Query(...),
    weight: float | None = None,
    height: float | None = None,
    width: float | None = None,
    length: float | None = None,
    declared_value: float = Query(50, alias="declared_value"),
    product_ids: str | None = Query(None, description="ids separados por vírgula"),
    quantities: str | None = Query(None, description="quantidades na mesma ordem de product_ids"),
):
    """Cotação CepCerto. Usa embalagem padrão (25×20×10) quando produto não tem dimensões."""
    ids = [int(x) for x in (product_ids or "").split(",") if x.strip().isdigit()]
    qty_list = [int(x) if x.strip().isdigit() else 1 for x in (quantities or "").split(",") if x.strip()]
    qty_map: dict[int, int] = {}
    for i, pid in enumerate(ids):
        qty_map[pid] = qty_map.get(pid, 0) + (qty_list[i] if i < len(qty_list) else 1)
    pkg = build_package(
        list(dict.fromkeys(ids)),
        qty_map,
        weight=weight,
        height=height,
        width=width,
        length=length,
        declared_value=declared_value,
    )

    try:
        result = await cepcerto.quote_freight(
            dest_cep=cep,
            weight_kg=pkg["weight_kg"],
            height_cm=pkg["height_cm"],
            width_cm=pkg["width_cm"],
            length_cm=pkg["length_cm"],
            declared_value=pkg["declared_value"],
        )
        result["package"] = {k: round(v, 3 if k == "weight_kg" else 2) for k, v in pkg.items()}
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_freight_error(exc)) from exc
