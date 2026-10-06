"""Cache em memória com validade curta para respostas públicas da loja.

O banco fica no Supabase (outra região do servidor): cada consulta custa uma viagem de rede. Respostas que mudam
pouco (catálogo, categorias, configurações) ficam alguns segundos na memória; qualquer escrita limpa tudo.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}
DEFAULT_TTL = 30.0


def cached(key: str, builder: Callable[[], Any], ttl: float = DEFAULT_TTL) -> Any:
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = builder()
    with _lock:
        if len(_store) > 200:
            _store.clear()
        _store[key] = (time.monotonic() + ttl, value)
    return value


def clear() -> None:
    with _lock:
        _store.clear()
