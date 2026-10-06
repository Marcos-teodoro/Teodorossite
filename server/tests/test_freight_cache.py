"""Cotação de frete: paralelismo, cache e reaproveitamento quando a CepCerto recusa (contra o CepCerto falso).

Rode:  python tests/test_freight_cache.py   (dentro de server/)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(TMP, 't.db').as_posix()}"
os.environ["CEPCERTO_BASE_URL"] = "http://127.0.0.1:39902"
os.environ["CEPCERTO_POSTAGE_TOKEN"] = "CEPCERTO_TESTE_PUBLICO"
os.environ["CEPCERTO_CONSUMPTION_KEY"] = ""
os.environ["CEPCERTO_ORIGIN_CEP"] = "01527050"
os.environ["UPLOADS_DIR"] = str(Path(TMP, "up"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

import fake_cepcerto  # noqa: E402
from app.db import get_connection, init_db  # noqa: E402
from app.services import cepcerto  # noqa: E402

ARGS = dict(dest_cep="11440001", weight_kg=0.53, height_cm=10, width_cm=20, length_cm=25, declared_value=371.9)


def quotes_sent() -> int:
    return len([1 for kind, _ in fake_cepcerto.STATE["requests"] if kind == "cotacao"])


def run() -> None:
    init_db()
    server = uvicorn.Server(uvicorn.Config(fake_cepcerto.app, host="127.0.0.1", port=39902, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.1)
    # CEP de destino sem rede: o lookup devolve um endereço fixo
    async def fake_lookup(cep):
        return {"cep": cep, "logradouro": "Rua X", "bairro": "B", "localidade": "Cidade", "uf": "SP", "source": "teste"}
    cepcerto._lookup_cep_uncached = fake_lookup  # type: ignore[assignment]

    # 1) cache: a mesma cotação não vai duas vezes à CepCerto
    fake_cepcerto.reset()
    r1 = asyncio.run(cepcerto.quote_freight(**ARGS))
    r2 = asyncio.run(cepcerto.quote_freight(**ARGS))
    assert quotes_sent() == 1 and r1["options"] == r2["options"], quotes_sent()
    print("OK  cotação repetida sai do cache (1 chamada à CepCerto)")

    # 2) pacote diferente = cotação nova
    asyncio.run(cepcerto.quote_freight(**{**ARGS, "weight_kg": 1.06}))
    assert quotes_sent() == 2
    print("OK  peso diferente gera nova cotação")

    # 3) origens diferentes são cotadas em paralelo (2 origens x 0,6 s ≈ 0,6 s, não 1,2 s)
    cepcerto._QUOTE_CACHE.clear(); cepcerto._QUOTE_STALE.clear()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO site_settings (key, value) VALUES ('shipping_origins_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps({"pac": {"cep": "01527050", "label": "A"}, "sedex": {"cep": "20040020", "label": "B"}}),),
        )
        conn.commit()
    fake_cepcerto.reset(); fake_cepcerto.STATE["delay"] = 0.6
    t = time.time()
    res = asyncio.run(cepcerto.quote_freight(**ARGS))
    elapsed = time.time() - t
    assert quotes_sent() == 2 and elapsed < 1.1, (quotes_sent(), elapsed)
    print(f"OK  2 origens em paralelo: {elapsed:.2f}s (sequencial seria ~1,2s)")

    # 4) limite diário: reaproveita a última cotação igual (cache comum expirado)
    cepcerto._QUOTE_CACHE.clear()
    fake_cepcerto.STATE["delay"] = 0.0
    fake_cepcerto.STATE["fail_quotes"] = "Limite diário de cotações atingido conforme seu consumo de etiquetas."
    stale = asyncio.run(cepcerto.quote_freight(**ARGS))
    assert stale.get("stale") is True and stale["options"] == res["options"]
    print("OK  CepCerto recusou (limite diário) -> usa a última cotação igual")

    # 5) sem cotação anterior: erro, e a mensagem para o cliente é amigável
    cepcerto._QUOTE_CACHE.clear(); cepcerto._QUOTE_STALE.clear()
    try:
        asyncio.run(cepcerto.quote_freight(**ARGS))
        raise AssertionError("deveria falhar")
    except RuntimeError as exc:
        from app.routers.shipping import friendly_freight_error
        msg = friendly_freight_error(exc)
        assert "Limite" not in msg and "WhatsApp" in msg, msg
    print("OK  sem reserva: erro com mensagem amigável ao cliente")
    print("\nTODOS OS TESTES PASSARAM")


if __name__ == "__main__":
    run()
