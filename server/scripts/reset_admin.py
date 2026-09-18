"""Garante admin@gmail.com com senha do .env."""
from app.auth import hash_password
from app.config import get_settings
from app.db import get_connection, init_db
from app.services.seed import seed_if_empty

init_db()
seed_if_empty()
settings = get_settings()
email = settings.admin_email.lower()
pwd_hash = hash_password(settings.admin_password)

with get_connection() as conn:
    row = conn.execute("SELECT id FROM profiles WHERE email = ?", (email,)).fetchone()
    if row:
        conn.execute(
            """
            UPDATE profiles
            SET role = 'admin', password_hash = ?,
                name = COALESCE(NULLIF(name, ''), 'Admin Teodora'),
                updated_at = datetime('now')
            WHERE email = ?
            """,
            (pwd_hash, email),
        )
    else:
        conn.execute(
            """
            INSERT INTO profiles (id, email, name, role, password_hash)
            VALUES (?, ?, 'Admin Teodora', 'admin', ?)
            """,
            (settings.admin_user_id, email, pwd_hash),
        )
    # remove stale local admin seed
    conn.execute(
        "DELETE FROM profiles WHERE email = ? AND email != ?",
        ("admin@teodora.local", email),
    )
    conn.commit()

print(f"admin_ready:{email}")
