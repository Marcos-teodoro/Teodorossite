"""Emissão automática de etiqueta CepCerto (contra o CepCerto falso, sem gastar saldo).

Rode:  python tests/test_auto_label.py   (dentro de server/)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

# Configuração isolada ANTES de importar o app (banco temporário + CepCerto falso)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{Path(TMP, 'teste.db').as_posix()}"
os.environ["CEPCERTO_BASE_URL"] = "http://127.0.0.1:39901"
os.environ["CEPCERTO_POSTAGE_TOKEN"] = "CEPCERTO_TESTE_PUBLICO"
os.environ["CEPCERTO_ORIGIN_CEP"] = "01527050"
os.environ["CEPCERTO_SHIPPER_NAME"] = "Teodora Perfumes"
os.environ["CEPCERTO_SHIPPER_DOC"] = "11222333000181"
os.environ["CEPCERTO_SHIPPER_PHONE"] = "11999998888"
os.environ["CEPCERTO_SHIPPER_EMAIL"] = "loja@example.com"
os.environ["CEPCERTO_SHIPPER_ADDRESS_NUMBER"] = "100"
os.environ["UPLOADS_DIR"] = str(Path(TMP, "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

import fake_cepcerto  # noqa: E402
from app.db import get_connection, init_db  # noqa: E402
from app.routers import admin_extra, checkout  # noqa: E402
from app.services import cepcerto  # noqa: E402


def start_fake() -> uvicorn.Server:
    server = uvicorn.Server(uvicorn.Config(fake_cepcerto.app, host="127.0.0.1", port=39901, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(50):
        if server.started:
            return server
        time.sleep(0.1)
    raise RuntimeError("CepCerto falso não subiu")


def make_order(status="approved", doc="52998224725", phone="11999998888") -> str:
    order_id = str(uuid.uuid4())
    snap = {"cep": "11440001", "code": "pac", "address_number": "1000", "address_complement": ""}
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO orders (id, status, merchandise, shipping_cost, total, payer_name, payer_email,
               payer_doc, payer_phone, payer_address, shipping_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (order_id, status, 371.9, 18.9, 390.8, "Maria Souza", "maria@example.com", doc, phone,
             "Av Paulista, nº 1000", json.dumps(snap)),
        )
        conn.execute(
            "INSERT INTO order_items (order_id, title, unit_price, quantity) VALUES (?,?,?,?)",
            (order_id, "Tommy Girl", 371.9, 1),
        )
        conn.commit()
    return order_id


def get_order(order_id: str) -> dict:
    with get_connection() as conn:
        row = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
    row["snap"] = json.loads(row["shipping_snapshot"])
    return row


def set_auto(value: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO site_settings (key, value) VALUES ('auto_label_enabled', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (value,),
        )
        conn.commit()


def run() -> None:
    init_db()
    start_fake()
    fake_cepcerto.reset(100.0)

    # 1) desligado: não emite nada
    oid = make_order()
    out = asyncio.run(admin_extra.auto_emit_label(oid))
    assert out == {"skipped": "desligado"}, out
    assert not get_order(oid)["tracking_code"]
    print("OK  desligado -> não emite")

    # 2) ligado: emite, grava rastreio/PDF/custo e marca como enviado
    set_auto("1")
    out = asyncio.run(admin_extra.auto_emit_label(oid))
    assert out["ok"] is True, out
    o = get_order(oid)
    assert o["tracking_code"].startswith("AP") and o["tracking_code"].endswith("BR"), o["tracking_code"]
    assert o["status"] == "shipped"
    assert o["snap"]["label"]["valor_etiqueta"] == 18.9 and not o["snap"]["label"]["cancelled"]
    sent = [d for kind, d in fake_cepcerto.STATE["requests"] if kind == "postagem"][-1]
    assert sent["request_id"] == f"teodora-{oid}"
    assert sent["cpf_cnpj_destinatario"] == "52998224725" and sent["whatsapp_destinatario"] == "11999998888"
    assert sent["tipo_entrega"] == "pac" and sent["cep_destinatario"] == "11440001"
    assert all(str(sent[k]).isdigit() for k in ("altura", "largura", "comprimento")), sent
    assert sent["produtos"][0]["descricao"] == "Tommy Girl"
    assert abs(fake_cepcerto.STATE["saldo"] - 81.1) < 0.001
    print("OK  ligado -> etiqueta emitida:", o["tracking_code"], "| saldo falso 81,10")

    # 3) idempotente: segunda chamada reaproveita, sem debitar de novo
    out = asyncio.run(admin_extra.auto_emit_label(oid))
    assert out == {"ok": True, "reused": True}, out
    assert abs(fake_cepcerto.STATE["saldo"] - 81.1) < 0.001
    assert len(fake_cepcerto.STATE["labels"]) == 1
    print("OK  segunda chamada -> reaproveita, não debita de novo")

    # 4) falha de dados (sem CPF): vira aviso no pedido, não quebra nada
    bad = make_order(doc="")
    out = asyncio.run(admin_extra.auto_emit_label(bad))
    assert out["ok"] is False and "CPF" in out["error"], out
    b = get_order(bad)
    assert b["status"] == "approved" and not b["tracking_code"]
    assert "CPF" in b["snap"]["label_error"]["message"]
    with get_connection() as conn:
        hist = conn.execute("SELECT * FROM order_status_history WHERE order_id=? AND source='etiqueta-automatica'", (bad,)).fetchall()
    assert len(hist) == 1
    print("OK  dados inválidos -> aviso no pedido:", b["snap"]["label_error"]["message"][:60])

    # 5) saldo insuficiente: aviso no pedido
    fake_cepcerto.reset(5.0)
    poor = make_order()
    out = asyncio.run(admin_extra.auto_emit_label(poor))
    assert out["ok"] is False and "Saldo" in out["error"], out
    assert "Saldo" in get_order(poor)["snap"]["label_error"]["message"]
    print("OK  saldo insuficiente -> aviso no pedido:", out["error"])

    # 6) emissão manual depois da falha limpa o aviso (admin resolveu e recarregou o saldo)
    fake_cepcerto.reset(100.0)
    asyncio.run(admin_extra.emit_order_label(poor, {}, admin_extra.SYSTEM_ACTOR))
    p = get_order(poor)
    assert p["tracking_code"] and "label_error" not in p["snap"]
    print("OK  emissão manual após falha -> aviso removido")

    # 7) gatilho do pagamento: só na primeira aprovação, e só com estoque ok
    calls: list[str] = []
    checkout._trigger_auto_label = lambda order_id: calls.append(order_id)  # type: ignore[assignment]
    pending = make_order(status="pending")
    with get_connection() as conn:
        checkout.apply_payment_result(conn, pending, {"id": "ORD1", "status": "approved"}, "teste")
        checkout.apply_payment_result(conn, pending, {"id": "ORD1", "status": "approved"}, "teste")
    assert calls == [pending], calls
    other = make_order(status="pending")
    with get_connection() as conn:
        checkout.apply_payment_result(conn, other, {"id": "ORD2", "status": "pending"}, "teste")
    assert calls == [pending], calls
    print("OK  gatilho dispara uma vez na aprovação; pendente não dispara")

    # 8) cancelar e rastrear contra o contrato da documentação
    fake_cepcerto.reset(100.0)
    asyncio.run(admin_extra.emit_order_label(bad, {"cpf_cnpj_destinatario": "52998224725"}, admin_extra.SYSTEM_ACTOR))
    code = get_order(bad)["tracking_code"]
    track = asyncio.run(cepcerto.track_object(code))
    assert track["eventos"][0]["descricao"] == "Objeto postado", track
    canc = asyncio.run(cepcerto.cancel_shipment(code))
    assert canc["ok"] and canc["valor_estorno"] == 18.9, canc
    print("OK  rastreio e cancelamento (estorno de R$ 18,90)")

    print("\nTODOS OS TESTES PASSARAM")


if __name__ == "__main__":
    run()
