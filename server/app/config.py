from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 3001
    app_env: str = "development"
    base_url: str = "http://localhost:3001"
    frontend_url: str = "http://localhost:5500"
    database_url: str = f"sqlite:///{(ROOT / 'teodora.db').as_posix()}"

    # Auth local (também usado se Supabase Auth não estiver ativo)
    jwt_secret: str = "teodora-dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 72
    admin_email: str = "admin@gmail.com"
    admin_password: str = "Admin123!"
    admin_user_id: str = "fa162d9e-8c93-4a6a-994d-c41c7a0e31d5"

    # Supabase (opcional — quando preenchido, JWT remoto e Storage remoto)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # Mercado Pago
    mp_access_token: str = ""
    mp_public_key: str = ""
    mp_sandbox: bool = True

    # CepCerto
    cepcerto_base_url: str = "https://cepcerto.com"
    cepcerto_postage_token: str = ""
    cepcerto_consumption_key: str = ""
    cepcerto_origin_cep: str = "01310100"

    uploads_dir: Path = ROOT / "uploads" / "product-photos"

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    def validate_production_secrets(self) -> None:
        if self.app_env.lower() != "production":
            return
        if self.jwt_secret == "teodora-dev-secret-change-me":
            raise RuntimeError("Defina JWT_SECRET seguro antes de iniciar em producao")
        if self.admin_password == "Admin123!":
            raise RuntimeError("Defina ADMIN_PASSWORD seguro antes de iniciar em producao")


@lru_cache
def get_settings() -> Settings:
    return Settings()
