"""CepCerto freight + CEP helpers."""
from __future__ import annotations

import re
from typing import Any

import httpx

from ..config import get_settings


def _only_digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _parse_brl(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def normalize_quote_response(raw: dict[str, Any]) -> list[dict[str, Any]]:
    frete = raw.get("frete") or raw
    mapping = [
        ("pac", "PAC", "valor_pac", "prazo_pac"),
        ("sedex", "SEDEX", "valor_sedex", "prazo_sedex"),
        ("jadlog_package", "Jadlog Package", "valor_jadlog_package", "prazo_jadlog_package"),
        ("jadlog_com", "Jadlog .COM", "valor_jadlog_com", "prazo_jadlog_com"),
        ("loggi", "Loggi", "valor_loggi", "prazo_loggi"),
        ("mini_envio", "Mini Envio", "valor_mini_envio", "prazo_mini_envio"),
    ]
    options: list[dict[str, Any]] = []
    for code, name, price_key, days_key in mapping:
        price = _parse_brl(frete.get(price_key))
        if price is None or price <= 0:
            continue
        options.append(
            {
                "code": code,
                "name": name,
                "price": round(price, 2),
                "days": frete.get(days_key) or "",
                "carrier": name.split()[0],
            }
        )
    options.sort(key=lambda o: o["price"])
    return options


async def lookup_cep(cep: str) -> dict[str, Any]:
    cep = _only_digits(cep)
    if len(cep) != 8:
        raise ValueError("CEP inválido")

    settings = get_settings()
    # Prefer CepCerto consumption key when available
    if settings.cepcerto_consumption_key:
        url = (
            f"{settings.cepcerto_base_url.rstrip('/')}/ws/json/"
            f"{cep}/{settings.cepcerto_consumption_key}"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if not data.get("erro"):
                    return {
                        "cep": cep,
                        "logradouro": data.get("logradouro") or data.get("Logradouro") or "",
                        "bairro": data.get("bairro") or data.get("Bairro") or "",
                        "localidade": data.get("localidade")
                        or data.get("cidade")
                        or data.get("Cidade")
                        or "",
                        "uf": data.get("uf") or data.get("UF") or "",
                        "source": "cepcerto",
                    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"https://viacep.com.br/ws/{cep}/json/")
        resp.raise_for_status()
        data = resp.json()
        if data.get("erro"):
            raise ValueError("CEP não encontrado")
        return {
            "cep": cep,
            "logradouro": data.get("logradouro") or "",
            "bairro": data.get("bairro") or "",
            "localidade": data.get("localidade") or "",
            "uf": data.get("uf") or "",
            "source": "viacep",
        }


async def quote_freight(
    *,
    dest_cep: str,
    weight_kg: float,
    height_cm: float,
    width_cm: float,
    length_cm: float,
    declared_value: float,
) -> dict[str, Any]:
    settings = get_settings()
    dest = _only_digits(dest_cep)
    origin = _only_digits(settings.cepcerto_origin_cep)
    if len(dest) != 8:
        raise ValueError("CEP destino inválido")

    weight_kg = max(0.1, min(30.0, float(weight_kg)))
    height_cm = max(1.0, min(100.0, float(height_cm)))
    width_cm = max(1.0, min(100.0, float(width_cm)))
    length_cm = max(1.0, min(100.0, float(length_cm)))
    # CepCerto exige valor declarado entre 50 e 35000
    declared_value = max(50.0, min(35000.0, float(declared_value)))

    address = await lookup_cep(dest)

    if not settings.cepcerto_postage_token:
        # Modo demo sem token — estimativa local (não inventa como oficial)
        base = 12.5 + weight_kg * 4.5
        options = [
            {
                "code": "pac",
                "name": "PAC (estimativa)",
                "price": round(base, 2),
                "days": "até 8 dias",
                "carrier": "Correios",
            },
            {
                "code": "sedex",
                "name": "SEDEX (estimativa)",
                "price": round(base * 1.65, 2),
                "days": "até 3 dias",
                "carrier": "Correios",
            },
        ]
        return {
            "address": address,
            "options": options,
            "demo": True,
            "message": "Configure CEPCERTO_POSTAGE_TOKEN para cotação real.",
        }

    payload = {
        "token_cliente_postagem": settings.cepcerto_postage_token,
        "cep_remetente": origin,
        "cep_destinatario": dest,
        "peso": f"{weight_kg:.3f}",
        "altura": f"{height_cm:.0f}",
        "largura": f"{width_cm:.0f}",
        "comprimento": f"{length_cm:.0f}",
        "valor_encomenda": f"{declared_value:.2f}",
    }
    url = f"{settings.cepcerto_base_url.rstrip('/')}/api-cotacao-frete/"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            raise RuntimeError(data.get("mensagem") or data.get("message") or f"CepCerto HTTP {resp.status_code}")
        if str(data.get("status", "")).lower() not in ("sucesso", "success", "ok", ""):
            # alguns retornos usam status diferente; se tiver frete, segue
            if "frete" not in data:
                raise RuntimeError(data.get("mensagem") or "Falha na cotação CepCerto")

    options = normalize_quote_response(data)
    if not options:
        raise RuntimeError("CepCerto não retornou opções de frete para este CEP.")

    return {"address": address, "options": options, "demo": False, "raw_status": data.get("status")}
