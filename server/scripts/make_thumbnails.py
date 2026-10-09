"""Gera as miniaturas (_w600.webp) das fotos já enviadas ao Supabase Storage.

Uso (na pasta server):  python -m scripts.make_thumbnails            # simula
                        python -m scripts.make_thumbnails --apply    # gera e envia
Só adiciona arquivos novos; nenhuma foto existente é alterada.
"""
from __future__ import annotations

import asyncio
import sys

import httpx

from app.config import get_settings
from app.services.http import SSL_CTX
from app.services.storage import BUCKET, _base, _headers, public_url, upload_bytes
from app.services.thumbnails import make_thumbnail, thumb_name


async def list_objects(client: httpx.AsyncClient, settings, prefix: str = "") -> list[str]:
    names: list[str] = []
    offset = 0
    while True:
        res = await client.post(
            f"{_base(settings)}/storage/v1/object/list/{BUCKET}",
            headers=_headers(settings, "application/json"),
            json={"prefix": prefix, "limit": 1000, "offset": offset},
        )
        res.raise_for_status()
        items = res.json()
        for item in items:
            path = f"{prefix}{item['name']}"
            if item.get("id") is None:  # pasta
                names += await list_objects(client, settings, path + "/")
            else:
                names.append(path)
        if len(items) < 1000:
            return names
        offset += 1000


async def main(apply: bool) -> None:
    settings = get_settings()
    if not settings.use_supabase:
        sys.exit("Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).")
    async with httpx.AsyncClient(timeout=60, verify=SSL_CTX) as client:
        names = await list_objects(client, settings)
        existing = set(names)
        todo = [n for n in names if thumb_name(n) and thumb_name(n) not in existing]
        print(f"{len(names)} arquivos no bucket, {len(todo)} sem miniatura.")
        saved = 0
        for name in todo:
            if not apply:
                print("  faltando:", name)
                continue
            original = (await client.get(public_url(settings, name))).content
            thumb = make_thumbnail(original)
            if not thumb:
                print("  ignorada (não é imagem válida):", name)
                continue
            await upload_bytes(data=thumb, object_path=thumb_name(name), content_type="image/webp", settings=settings)
            saved += len(original) - len(thumb)
            print(f"  ok {name}: {len(original)//1024} KB -> {len(thumb)//1024} KB")
        if apply:
            print(f"Pronto. Economia por visita: ~{saved//1024} KB.")
        else:
            print("Simulação. Rode com --apply para gerar.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
