from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings
from .db import get_connection, row_to_dict

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, extra: Optional[dict] = None) -> str:
    settings = get_settings()
    payload: dict[str, Any] = {
        "sub": subject,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours),
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    secrets = [settings.jwt_secret]
    if settings.supabase_jwt_secret:
        secrets.append(settings.supabase_jwt_secret)
    last_err: Exception | None = None
    for secret in secrets:
        try:
            return jwt.decode(token, secret, algorithms=[settings.jwt_algorithm, "HS256"])
        except JWTError as exc:
            last_err = exc
    raise HTTPException(status_code=401, detail="Token inválido ou expirado") from last_err


def get_user_by_id(user_id: str) -> Optional[dict]:
    with get_connection() as conn:
        cur = conn.execute("SELECT * FROM profiles WHERE id = ?", (user_id,))
        row = cur.fetchone()
        return row_to_dict(row) if row else None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Optional[dict]:
    if not credentials:
        return None
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        return None
    return get_user_by_id(str(user_id))


def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Faça login")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso admin necessário")
    return user


def register_user(email: str, password: str, name: str, phone: str = "", role: str = "customer") -> dict:
    email = email.strip().lower()
    if not email or not password:
        raise HTTPException(status_code=400, detail="E-mail e senha obrigatórios")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Senha com no mínimo 8 caracteres")

    user_id = str(uuid4())
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM profiles WHERE email = ?", (email,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="E-mail já cadastrado")
        conn.execute(
            """
            INSERT INTO profiles (id, email, name, phone, role, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, email, name.strip() or email.split("@")[0], phone, role, hash_password(password)),
        )
        conn.commit()
    user = get_user_by_id(user_id)
    assert user is not None
    return user


def authenticate_user(email: str, password: str) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM profiles WHERE email = ?", (email.strip().lower(),)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    user = row_to_dict(row)
    if not user.get("password_hash") or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    return user
