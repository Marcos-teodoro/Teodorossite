from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import init_db
from .routers import admin, catalog, checkout, shipping
from .routers.auth_routes import addresses_router, orders_router, router as auth_router
from .services.seed import seed_if_empty

settings = get_settings()
PROJECT_ROOT = Path(__file__).resolve().parents[2]

app = FastAPI(title="Teodora API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    seed_if_empty()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)


app.include_router(auth_router)
app.include_router(addresses_router)
app.include_router(orders_router)
app.include_router(catalog.router)
app.include_router(shipping.router)
app.include_router(checkout.router)
app.include_router(admin.router)

uploads_root = settings.uploads_dir.parent
app.mount("/uploads", StaticFiles(directory=str(uploads_root)), name="uploads")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "teodora-fastapi",
        "sandbox": settings.mp_sandbox,
        "hasMpToken": bool(settings.mp_access_token),
        "hasMpPublicKey": bool(settings.mp_public_key),
        "hasCepCerto": bool(settings.cepcerto_postage_token),
        "useSupabase": settings.use_supabase,
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


@app.get("/")
def index_page():
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/conta.html")
def conta_page():
    return FileResponse(PROJECT_ROOT / "conta.html")


@app.get("/minha-conta.html")
def minha_conta_page():
    return FileResponse(PROJECT_ROOT / "minha-conta.html")


@app.get("/admin")
@app.get("/admin/")
@app.get("/admin/index.html")
def admin_page():
    return FileResponse(PROJECT_ROOT / "admin" / "index.html")
