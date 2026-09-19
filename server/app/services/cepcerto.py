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


def _require_postage_token() -> str:
    settings = get_settings()
    token = (settings.cepcerto_postage_token or "").strip()
    if not token:
        raise RuntimeError("Configure CEPCERTO_POSTAGE_TOKEN para usar postagem/etiquetas CepCerto.")
    return token


async def _async_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.cepcerto_base_url.rstrip('/')}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            raise RuntimeError(
                data.get("mensagem") or data.get("message") or data.get("erro") or f"CepCerto HTTP {resp.status_code}"
            )
        return data if isinstance(data, dict) else {"raw": data}


async def get_balance() -> dict[str, Any]:
    token = _require_postage_token()
    data = await _async_post("/api-saldo/", {"token_cliente_postagem": token})
    return {
        "nome_cliente": data.get("nome_cliente") or "",
        "saldo_atual": data.get("saldo_atual") or "",
        "data_requisicao": data.get("data_requisicao") or "",
        "raw": data,
    }


def map_service_code(code: str | None) -> str:
    """Converte código interno da cotação para tipo_entrega da postagem."""
    raw = (code or "pac").strip().lower().replace("_", "-").replace(" ", "-")
    aliases = {
        "pac": "pac",
        "sedex": "sedex",
        "jadlog-package": "jadlog-package",
        "jadlogpackage": "jadlog-package",
        "jadlog-com": "jadlog-dotcom",
        "jadlog-dotcom": "jadlog-dotcom",
        "jadlog.com": "jadlog-dotcom",
        "loggi": "loggi",
        "mini-envio": "pac",
    }
    if raw in aliases:
        return aliases[raw]
    if "sedex" in raw:
        return "sedex"
    if "jadlog" in raw and ("dot" in raw or "com" in raw):
        return "jadlog-dotcom"
    if "jadlog" in raw:
        return "jadlog-package"
    if "loggi" in raw:
        return "loggi"
    return "pac"


async def create_label(payload: dict[str, Any]) -> dict[str, Any]:
    """Emite etiqueta via /api-postagem-frete/ (declaração de conteúdo)."""
    token = _require_postage_token()
    settings = get_settings()
    body = {
        "token_cliente_postagem": token,
        "request_id": payload["request_id"],
        "tipo_entrega": map_service_code(payload.get("tipo_entrega")),
        "logistica_reversa": payload.get("logistica_reversa") or "N",
        "cep_remetente": _only_digits(payload.get("cep_remetente") or settings.cepcerto_origin_cep),
        "cep_destinatario": _only_digits(payload.get("cep_destinatario") or ""),
        "peso": str(payload.get("peso") or "0.500"),
        "altura": str(payload.get("altura") or "12"),
        "largura": str(payload.get("largura") or "8"),
        "comprimento": str(payload.get("comprimento") or "8"),
        "valor_encomenda": str(payload.get("valor_encomenda") or "50.00"),
        "nome_remetente": payload.get("nome_remetente") or settings.cepcerto_shipper_name,
        "cpf_cnpj_remetente": _only_digits(payload.get("cpf_cnpj_remetente") or settings.cepcerto_shipper_doc),
        "whatsapp_remetente": _only_digits(payload.get("whatsapp_remetente") or settings.cepcerto_shipper_phone),
        "email_remetente": payload.get("email_remetente") or settings.cepcerto_shipper_email,
        "numero_endereco_remetente": str(payload.get("numero_endereco_remetente") or settings.cepcerto_shipper_address_number or "0"),
        "complemento_remetente": payload.get("complemento_remetente") or settings.cepcerto_shipper_complement or "",
        "nome_destinatario": payload.get("nome_destinatario") or "",
        "cpf_cnpj_destinatario": _only_digits(payload.get("cpf_cnpj_destinatario") or ""),
        "whatsapp_destinatario": _only_digits(payload.get("whatsapp_destinatario") or ""),
        "email_destinatario": payload.get("email_destinatario") or "",
        "numero_endereco_destinatario": str(payload.get("numero_endereco_destinatario") or "0"),
        "complemento_destinatario": payload.get("complemento_destinatario") or "",
        "tipo_doc_fiscal": "declaracao",
        "produtos": payload.get("produtos") or [{"descricao": "Produtos Teodora", "valor": "50.00", "quantidade": 1}],
    }
    if len(body["cep_destinatario"]) != 8:
        raise ValueError("CEP destinatário inválido")
    if not body["nome_destinatario"]:
        raise ValueError("Nome do destinatário é obrigatório")
    if not body["cpf_cnpj_remetente"]:
        raise ValueError("Informe o CPF/CNPJ do remetente (CEPCERTO_SHIPPER_DOC ou no painel).")

    data = await _async_post("/api-postagem-frete/", body)
    frete = data.get("frete") or {}
    ok = bool(data.get("sucesso")) or str(data.get("status", "")).lower() in ("sucesso", "success", "ok")
    if not ok and not frete.get("codigoObjeto") and not frete.get("pdfUrlEtiqueta"):
        raise RuntimeError(data.get("mensagem") or "Falha ao emitir etiqueta CepCerto")

    return {
        "ok": True,
        "mensagem": data.get("mensagem") or "Etiqueta gerada.",
        "codigo_objeto": frete.get("codigoObjeto") or frete.get("codigo_objeto") or "",
        "pdf_url_etiqueta": frete.get("pdfUrlEtiqueta") or frete.get("pdf_url_etiqueta") or "",
        "pdf_url_dce": frete.get("pdfUrlDCE") or frete.get("pdf_url_dce") or "",
        "servico": frete.get("servico") or frete.get("freteTipo") or body["tipo_entrega"],
        "valor": frete.get("valor"),
        "prazo": frete.get("prazo") or "",
        "raw": data,
    }


async def track_object(codigo: str, transportadora: str = "") -> dict[str, Any]:
    token = _require_postage_token()
    codigo = (codigo or "").strip().upper()
    if not codigo:
        raise ValueError("Informe o código de rastreio")
    data = await _async_post(
        "/api-rastreio/",
        {
            "token_cliente_postagem": token,
            "codigo_objeto": codigo,
            "transportadora": transportadora or "",
        },
    )
    return {
        "ok": bool(data.get("sucesso", True)),
        "mensagem": data.get("mensagem") or "",
        "objeto": data.get("objeto") or codigo,
        "transportadora": data.get("transportadora") or "",
        "dt_prevista": data.get("dt_prevista") or {},
        "eventos": data.get("eventos") or [],
        "raw": data,
    }
