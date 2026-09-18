"""Upload/remoção de fotos de produto no Supabase Storage (bucket product-photos)."""
from __future__ import annotations

import logging
from urllib.parse import quote, unquote

import httpx

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)

BUCKET = "product-photos"


class StorageError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _headers(settings: Settings, content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _base(settings: Settings) -> str:
    return settings.supabase_url.rstrip("/")


def public_url(settings: Settings, object_path: str) -> str:
    encoded = "/".join(quote(part, safe="") for part in object_path.split("/"))
    return f"{_base(settings)}/storage/v1/object/public/{BUCKET}/{encoded}"


def object_path_from_url(url: str, settings: Settings | None = None) -> str | None:
    """Extrai o path interno do bucket a partir da URL pública do Storage."""
    if not url:
        return None
    marker = f"/storage/v1/object/public/{BUCKET}/"
    if marker in url:
        return unquote(url.split(marker, 1)[1].split("?", 1)[0])
    marker_sign = f"/storage/v1/object/sign/{BUCKET}/"
    if marker_sign in url:
        return unquote(url.split(marker_sign, 1)[1].split("?", 1)[0])
    settings = settings or get_settings()
    if settings.supabase_url and url.startswith(_base(settings)) and BUCKET in url:
        # fallback genérico
        parts = url.split(f"/{BUCKET}/", 1)
        if len(parts) == 2:
            return unquote(parts[1].split("?", 1)[0])
    return None


def is_supabase_storage_url(url: str, settings: Settings | None = None) -> bool:
    return object_path_from_url(url, settings) is not None


async def ensure_bucket(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.use_supabase:
        return
    url = f"{_base(settings)}/storage/v1/bucket/{BUCKET}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, headers=_headers(settings))
        if res.status_code == 200:
            return
        create = await client.post(
            f"{_base(settings)}/storage/v1/bucket",
            headers=_headers(settings, "application/json"),
            json={"id": BUCKET, "name": BUCKET, "public": True, "file_size_limit": 8388608},
        )
        if create.status_code not in (200, 201) and "already exists" not in create.text.lower():
            logger.warning("Não foi possível garantir bucket %s: %s %s", BUCKET, create.status_code, create.text[:300])


async def upload_bytes(
    *,
    data: bytes,
    object_path: str,
    content_type: str,
    settings: Settings | None = None,
) -> str:
    """Envia bytes ao Storage e devolve a URL pública."""
    settings = settings or get_settings()
    if not settings.use_supabase:
        raise StorageError(
            "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.",
            status_code=503,
        )
    await ensure_bucket(settings)
    upload_url = f"{_base(settings)}/storage/v1/object/{BUCKET}/{object_path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            upload_url,
            headers={
                **_headers(settings, content_type),
                "x-upsert": "true",
            },
            content=data,
        )
        if res.status_code not in (200, 201):
            raise StorageError(
                f"Falha no upload Supabase ({res.status_code}): {res.text[:240]}",
                status_code=502,
            )
    return public_url(settings, object_path)


async def delete_object(url_or_path: str, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.use_supabase:
        return
    path = object_path_from_url(url_or_path, settings) or url_or_path.lstrip("/")
    if not path:
        return
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{_base(settings)}/storage/v1/object/remove/{BUCKET}",
            headers=_headers(settings, "application/json"),
            json={"prefixes": [path]},
        )
        if res.status_code not in (200, 204) and res.status_code != 404:
            logger.warning("Falha ao remover %s do Storage: %s %s", path, res.status_code, res.text[:200])
