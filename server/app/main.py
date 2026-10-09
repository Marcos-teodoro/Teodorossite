import hashlib
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import init_db
from .routers import admin, admin_extra, catalog, checkout, shipping, storefront
from .routers.auth_routes import addresses_router, orders_router, router as auth_router
from .services.seed import seed_if_empty

settings = get_settings()
PROJECT_ROOT = Path(__file__).resolve().parents[2]

app = FastAPI(title="Teodora API", version="2.0.0")

allowed_origin_candidates: list[str] = []
for configured_origin in (settings.frontend_url, settings.base_url):
    if not configured_origin:
        continue
    origin = configured_origin.rstrip("/")
    allowed_origin_candidates.append(origin)
    if "localhost" in origin:
        allowed_origin_candidates.append(origin.replace("localhost", "127.0.0.1"))
    elif "127.0.0.1" in origin:
        allowed_origin_candidates.append(origin.replace("127.0.0.1", "localhost"))
allowed_origins = list(dict.fromkeys(allowed_origin_candidates))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    settings.validate_production_secrets()
    if not settings.persistent_storage:
        print(
            "[AVISO] Sem Volume no Railway: produtos, pedidos e clientes são APAGADOS a cada deploy. "
            "Crie um Volume no serviço (veja RAILWAY.md)."
        )
    init_db()
    seed_if_empty()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)


STATIC_PREFIXES = ("/css/", "/js/", "/admin/css/", "/admin/js/")


@app.middleware("http")
async def static_cache_headers(request, call_next):
    """CSS/JS com ?v=<hash> (posto automaticamente nas páginas) e fotos com nome único: cache de 1 ano."""
    response = await call_next(request)
    path = request.url.path
    if response.status_code == 200 and "cache-control" not in response.headers:
        if path.startswith(STATIC_PREFIXES):
            versioned = "v" in request.query_params
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if versioned else "public, max-age=3600"
        elif path.startswith("/uploads/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@app.middleware("http")
async def clear_cache_on_write(request, call_next):
    response = await call_next(request)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        from .services.cache import clear

        clear()
    return response


@app.on_event("shutdown")
def on_shutdown():
    from .db import reset_pool

    reset_pool()


app.include_router(auth_router)
app.include_router(addresses_router)
app.include_router(orders_router)
app.include_router(catalog.router)
app.include_router(storefront.router)
app.include_router(shipping.router)
app.include_router(checkout.router)
app.include_router(admin.router)
app.include_router(admin_extra.router)

uploads_root = settings.uploads_dir.parent
uploads_root.mkdir(parents=True, exist_ok=True)
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_root)), name="uploads")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "teodora-fastapi",
        "sandbox": settings.mp_sandbox,
        "database": "postgres" if settings.database_url.startswith(("postgres://", "postgresql://")) else "sqlite",
        "persistentStorage": settings.persistent_storage,
        "hasMpToken": bool(settings.mp_access_token),
        "hasMpPublicKey": bool(settings.mp_public_key),
        "hasCepCerto": bool(settings.cepcerto_postage_token),
        "useSupabase": settings.use_supabase,
        "hasSupabaseStorage": settings.use_supabase,
        "publicKey": settings.mp_public_key,
    }


@app.get("/api/config")
def public_config():
    return {
        "mpPublicKey": settings.mp_public_key,
        "mpSandbox": settings.mp_sandbox,
        "supabaseUrl": settings.supabase_url or None,
        "supabaseAnonKey": settings.supabase_anon_key or None,
        "frontendUrl": settings.frontend_url,
    }


# Servir loja + admin a partir da raiz do projeto
static_mounts = [
    ("/css", PROJECT_ROOT / "css"),
    ("/js", PROJECT_ROOT / "js"),
    ("/admin/css", PROJECT_ROOT / "admin" / "css"),
    ("/admin/js", PROJECT_ROOT / "admin" / "js"),
]
for mount_path, directory in static_mounts:
    if directory.exists():
        app.mount(mount_path, StaticFiles(directory=str(directory)), name=mount_path.strip("/").replace("/", "_"))


_ASSET_RE = re.compile(r'((?:href|src)=")((?:\.\./|/)?(?:admin/)?(?:css|js)/[\w.\-/]+\.(?:css|js))(?:\?v=[^"]*)?"')
_asset_versions: dict[Path, tuple[float, str]] = {}


def _asset_version(file: Path) -> str | None:
    try:
        mtime = file.stat().st_mtime
    except OSError:
        return None
    cached = _asset_versions.get(file)
    if not cached or cached[0] != mtime:
        cached = (mtime, hashlib.sha1(file.read_bytes()).hexdigest()[:10])
        _asset_versions[file] = cached
    return cached[1]


def versioned_html(page: Path, headers: dict[str, str] | None = None) -> HTMLResponse:
    """Troca o ?v= dos CSS/JS locais pelo hash do arquivo: cada mudança gera URL nova, sem bump manual."""

    def replace(match: re.Match) -> str:
        version = _asset_version(PROJECT_ROOT / match.group(2).lstrip("./"))
        return f'{match.group(1)}{match.group(2)}?v={version}"' if version else match.group(0)

    html = _ASSET_RE.sub(replace, page.read_text(encoding="utf-8"))
    return HTMLResponse(html, headers=headers or {"Cache-Control": "no-cache"})


@app.get("/")
def index_page():
    return versioned_html(PROJECT_ROOT / "index.html")


@app.get("/conta.html")
def conta_page():
    return versioned_html(
        PROJECT_ROOT / "conta.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"},
    )


@app.get("/minha-conta.html")
def minha_conta_page():
    return versioned_html(PROJECT_ROOT / "minha-conta.html")


@app.get("/admin")
@app.get("/admin/")
@app.get("/admin/index.html")
def admin_page():
    return versioned_html(
        PROJECT_ROOT / "admin" / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"},
    )