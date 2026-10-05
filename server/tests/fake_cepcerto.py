"""CepCerto falso para testes locais: segue o contrato da documentação oficial
(https://cepcerto.com/integracao) e não gasta saldo nem emite etiqueta real.

O sandbox oficial (dev.cepcerto.com) pode estar inacessível a partir da sua rede; este servidor
permite testar emissão, cancelamento e rastreio de ponta a ponta.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

STATE = {"saldo": 100.0, "labels": {}, "requests": []}

REQUIRED_POSTAGE = [
    "token_cliente_postagem", "request_id", "tipo_entrega", "logistica_reversa", "cep_remetente",
    "cep_destinatario", "peso", "altura", "largura", "comprimento", "valor_encomenda",
    "nome_remetente", "cpf_cnpj_remetente", "whatsapp_remetente", "email_remetente",
    "numero_endereco_remetente", "nome_destinatario", "cpf_cnpj_destinatario",
    "whatsapp_destinatario", "email_destinatario", "numero_endereco_destinatario", "tipo_doc_fiscal",
]
PRICES = {"pac": 18.90, "sedex": 29.70, "jadlog-package": 17.50, "jadlog-dotcom": 20.0, "loggi": 19.20}


def reset(saldo: float = 100.0) -> None:
    STATE.update({"saldo": saldo, "labels": {}, "requests": []})


def brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _bad(message: str, status: int = 422):
    return JSONResponse({"status": "erro", "sucesso": False, "mensagem": message}, status_code=status)


@app.post("/api-saldo/")
async def saldo(request: Request):
    return {"nome_cliente": "CLIENTE EXEMPLO", "saldo_atual": brl(STATE["saldo"]), "data_requisicao": "05/10/2026 12:00:00"}


@app.post("/api-cotacao-frete/")
async def cotacao(request: Request):
    d = await request.json()
    STATE["requests"].append(("cotacao", d))
    return {"status": "sucesso", "frete": {
        "valor_pac": "18,90", "prazo_pac": "até 6 dias", "valor_sedex": "29,70", "prazo_sedex": "até 2 dias",
        "valor_jadlog_package": "17,50", "prazo_jadlog_package": "até 4 dias",
        "valor_loggi": "19,20", "prazo_loggi": "até 3 dias",
    }}


@app.post("/api-postagem-frete/")
async def postagem(request: Request):
    d = await request.json()
    STATE["requests"].append(("postagem", d))
    missing = [k for k in REQUIRED_POSTAGE if not str(d.get(k) or "").strip() and k != "logistica_reversa"]
    if missing:
        return _bad("Campos obrigatórios ausentes: " + ", ".join(missing))
    if d["tipo_entrega"] not in PRICES:
        return _bad("tipo_entrega inválido")
    if d["tipo_doc_fiscal"] == "declaracao" and not d.get("produtos"):
        return _bad("Declaração exige ao menos um produto")
    try:
        peso, a, l, c = (float(d[k]) for k in ("peso", "altura", "largura", "comprimento"))
        valor = float(d["valor_encomenda"])
    except ValueError:
        return _bad("Medidas inválidas")
    if not (0 < peso <= 30) or any(not (0 < x <= 100) for x in (a, l, c)) or a + l + c > 200:
        return _bad("Dimensões fora do limite")
    if not (50 <= valor <= 35000):
        return _bad("valor_encomenda deve ficar entre R$ 50,00 e R$ 35.000,00")
    for k in ("cep_remetente", "cep_destinatario"):
        if len(str(d[k])) != 8 or not str(d[k]).isdigit():
            return _bad(f"{k} deve ter 8 dígitos")
    rid = d["request_id"]
    if rid in STATE["labels"]:  # idempotência por request_id
        frete = STATE["labels"][rid]
        return {"status": "sucesso", "sucesso": True, "mensagem": "Requisição já processada.", "frete": frete}
    price = PRICES[d["tipo_entrega"]]
    if STATE["saldo"] < price:
        return _bad("Saldo insuficiente para emitir a etiqueta.")
    STATE["saldo"] -= price
    code = f"AP{len(STATE['labels']) + 1:09d}BR"
    frete = {
        "freteTipo": "correios_" + d["tipo_entrega"], "servico": d["tipo_entrega"], "valor": price,
        "prazo": "até 6 dias", "codigoObjeto": code,
        "pdfUrlEtiqueta": f"https://cepcerto.test/etiqueta/{code}", "pdfUrlDCE": f"https://cepcerto.test/dce/{code}",
    }
    STATE["labels"][rid] = frete
    return {"status": "sucesso", "sucesso": True, "mensagem": "Frete Correios confirmado com sucesso.", "frete": frete}


@app.post("/api-cancela-postagem/")
async def cancela(request: Request):
    d = await request.json()
    code = d.get("codigo_objeto")
    for rid, frete in list(STATE["labels"].items()):
        if frete["codigoObjeto"] == code:
            before = STATE["saldo"]
            STATE["saldo"] += frete["valor"]
            del STATE["labels"][rid]
            return {"sucesso": True, "nome_cliente": "CLIENTE EXEMPLO", "saldo_anterior": brl(before),
                    "valor_creditado": brl(frete["valor"]), "saldo_atual": brl(STATE["saldo"]),
                    "mensagem": f"Objeto {code} cancelado com sucesso!"}
    return _bad("Objeto não encontrado para este cliente.", 404)


@app.post("/api-rastreio/")
async def rastreio(request: Request):
    d = await request.json()
    return {"sucesso": True, "objeto": d.get("codigo_objeto"), "transportadora": "correios",
            "dt_prevista": {"text": "até 6 dias"},
            "eventos": [{"data_br": "05/10/2026 12:00", "descricao": "Objeto postado", "detalhe": "", "unidade": "SP", "entregue": False}]}
