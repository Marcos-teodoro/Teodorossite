import os
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
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
    # No Railway, ao anexar um Volume o serviço recebe RAILWAY_VOLUME_MOUNT_PATH: o banco passa a viver
    # nele (sobrevive a deploys). Sem volume, o disco do contêiner é apagado a cada deploy.
    database_url: str = (
        f"sqlite:///{(Path(os.environ['RAILWAY_VOLUME_MOUNT_PATH']) / 'teodora.db').as_posix()}"
        if os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
        else f"sqlite:///{(ROOT / 'teodora.db').as_posix()}"
    )

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
    # "orders" = API Orders (/v1/orders); "payments" = API de Pagamentos (/v1/payments).
    # Depende de como a aplicação foi criada no painel do Mercado Pago.
    mp_api: str = "orders"

    # CepCerto
    cepcerto_base_url: str = "https://cepcerto.com"
    cepcerto_postage_token: str = ""
    cepcerto_consumption_key: str = ""
    cepcerto_origin_cep: str = "01310100"
    cepcerto_shipper_name: str = "Teodora Perfumes"
    cepcerto_shipper_doc: str = ""
    cepcerto_shipper_phone: str = ""
    cepcerto_shipper_email: str = ""
    cepcerto_shipper_address_number: str = "0"
    cepcerto_shipper_complement: str = ""

    uploads_dir: Path = ROOT / "uploads" / "product-photos"
    max_categories: int = 8

    @field_validator("database_url", mode="before")
    @classmethod
    def _clean_database_url(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("postgres://"):
                value = "postgresql://" + value[len("postgres://"):]
        return value

    @field_validator("mp_access_token", "mp_public_key", "cepcerto_postage_token", "cepcerto_consumption_key", mode="before")
    @classmethod
    def _clean_mp_key(cls, value):
        """Aceita a chave mesmo colada com quebra de linha ou com outra variável junto (ex.: "...\nMP_SANDBOX=true")."""
        if not isinstance(value, str):
            return value
        lines = [ln.strip() for ln in value.replace("\r", "").split("\n") if ln.strip()]
        first = lines[0] if lines else ""
        return first.split()[0].strip("\"'") if first else ""

    @property
    def persistent_storage(self) -> bool:
        """True quando o banco está num volume do Railway (ou fora do Railway, em desenvolvimento)."""
        if self.database_url.startswith(("postgres://", "postgresql://")):
            return True  # banco gerenciado (Supabase)
        on_railway = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
        return (not on_railway) or bool(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"))

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


def clear_settings_cache() -> None:
    get_settings.cache_clear()
