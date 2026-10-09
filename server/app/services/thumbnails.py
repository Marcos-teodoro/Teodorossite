"""Miniaturas WebP das fotos (nome_w600.webp ao lado da original), usadas nos cards da loja."""
from __future__ import annotations

import io
import logging
import re
from pathlib import Path

from ..config import Settings

logger = logging.getLogger(__name__)

THUMB_WIDTH = 600
_EXT_RE = re.compile(r"\.(?:jpe?g|png|webp)$", re.IGNORECASE)


def thumb_name(name: str) -> str | None:
    """products/30/abc.jpg -> products/30/abc_w600.webp (None para formatos sem miniatura, ex.: GIF)."""
    if not _EXT_RE.search(name) or name.lower().endswith("_w600.webp"):
        return None
    return _EXT_RE.sub("_w600.webp", name)


def make_thumbnail(data: bytes, width: int = THUMB_WIDTH) -> bytes | None:
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "transparency" in img.info else "RGB")
            if img.width > width:
                img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
            out = io.BytesIO()
            img.save(out, "WEBP", quality=80, method=6)
            return out.getvalue()
    except Exception as exc:  # noqa: BLE001 - miniatura é opcional; a loja usa a original
        logger.warning("Falha ao gerar miniatura: %s", exc)
        return None


async def store_thumbnail(data: bytes, *, object_name: str | None = None, local_path: Path | None = None,
                          settings: Settings | None = None) -> None:
    """Gera e salva a miniatura junto da original (Supabase ou disco). Nunca interrompe o upload."""
    from .storage import upload_bytes

    target = thumb_name(object_name or (local_path.name if local_path else ""))
    if not target:
        return
    thumb = make_thumbnail(data)
    if not thumb:
        return
    try:
        if object_name:
            await upload_bytes(data=thumb, object_path=target, content_type="image/webp", settings=settings)
        elif local_path:
            local_path.with_name(target).write_bytes(thumb)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Falha ao salvar miniatura %s: %s", target, exc)
