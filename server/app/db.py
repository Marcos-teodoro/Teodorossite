import json
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator, Optional

from .config import get_settings

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  cpf TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer',
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brand_tag TEXT DEFAULT '',
  volume TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category_slug TEXT NOT NULL DEFAULT 'perfumes',
  family TEXT DEFAULT 'floral',
  intensity TEXT DEFAULT 'edp',
  occasion TEXT DEFAULT 'dia',
  sensation TEXT DEFAULT 'romantico',
  price REAL NOT NULL,
  old_price REAL,
  badge TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  description TEXT DEFAULT '',
  ritual TEXT DEFAULT '',
  ingredients TEXT DEFAULT '',
  pyramid_top TEXT DEFAULT '',
  pyramid_heart TEXT DEFAULT '',
  pyramid_base TEXT DEFAULT '',
  similar_ids TEXT NOT NULL DEFAULT '[]',
  stock INTEGER NOT NULL DEFAULT 50,
  active INTEGER NOT NULL DEFAULT 1,
  weight_kg REAL NOT NULL DEFAULT 0.65,
  height_cm REAL NOT NULL DEFAULT 10,
  width_cm REAL NOT NULL DEFAULT 20,
  length_cm REAL NOT NULL DEFAULT 25,
  cover_image TEXT,
  rating REAL DEFAULT 4.8,
  reviews INTEGER DEFAULT 48,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  old_price REAL,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Casa',
  cep TEXT NOT NULL,
  logradouro TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  complemento TEXT DEFAULT '',
  bairro TEXT DEFAULT '',
  cidade TEXT DEFAULT '',
  uf TEXT DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  merchandise REAL NOT NULL DEFAULT 0,
  shipping_cost REAL NOT NULL DEFAULT 0,
  coupon_code TEXT DEFAULT '',
  coupon_discount REAL NOT NULL DEFAULT 0,
  pix_discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  payment_hint TEXT DEFAULT 'pix',
  mp_payment_id TEXT,
  mp_status TEXT,
  payer_name TEXT,
  payer_email TEXT,
  payer_doc TEXT,
  payer_phone TEXT,
  payer_address TEXT,
  shipping_snapshot TEXT NOT NULL DEFAULT '{}',
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  tracking_code TEXT DEFAULT '',
  tracking_url TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  variant_id INTEGER,
  sku TEXT DEFAULT '',
  variant_label TEXT DEFAULT '',
  title TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL,
  min_order REAL NOT NULL DEFAULT 0,
  usage_limit INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin',
  actor_id TEXT,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  order_id TEXT,
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _sqlite_path() -> Path:
    settings = get_settings()
    url = settings.database_url
    if url.startswith("sqlite:///"):
        return Path(url.replace("sqlite:///", "", 1))
    return Path(get_settings().uploads_dir.parent.parent / "teodora.db")


def is_postgres() -> bool:
    return get_settings().database_url.startswith(("postgres://", "postgresql://"))


# ---------------------------------------------------------------------------
# Postgres (Supabase). O código do app foi escrito em SQL "estilo SQLite"; esta camada traduz o pouco
# que difere (placeholders, datetime(), INSERT OR IGNORE...) e imita a API do sqlite3 usada no app.
# ---------------------------------------------------------------------------

_NOW_EXPR = "to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')"
_SERIAL_TABLES = set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \(\s+id INTEGER PRIMARY KEY AUTOINCREMENT", SCHEMA_SQL))


def _convert_placeholders(sql: str) -> str:
    """'?' -> '%s' e '%' literal -> '%%', ignorando o que está entre aspas simples."""
    out: list[str] = []
    in_quote = False
    for ch in sql:
        if ch == "'":
            in_quote = not in_quote
            out.append(ch)
        elif ch == "%":
            out.append("%%")
        elif ch == "?" and not in_quote:
            out.append("%s")
        else:
            out.append(ch)
    return "".join(out)


@lru_cache(maxsize=512)
def to_pg(sql: str) -> str:
    text = sql.strip().rstrip(";")
    ignore = bool(re.match(r"(?is)\s*INSERT\s+OR\s+IGNORE\s+INTO", text))
    if ignore:
        text = re.sub(r"(?is)INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", text, count=1)
    text = re.sub(r"datetime\('now',\s*\?\)", f"to_char(timezone('utc', now()) + CAST(? AS interval), 'YYYY-MM-DD HH24:MI:SS')", text)
    text = text.replace("datetime('now')", _NOW_EXPR)
    text = re.sub(r"datetime\(([\w.]+)\)", r"replace(\1, 'T', ' ')", text)
    text = re.sub(r"\bMAX\(\s*0\s*,", "GREATEST(0,", text)
    text = re.sub(r"\bLIKE\b", "ILIKE", text)
    text = _convert_placeholders(text)
    if ignore:
        text += " ON CONFLICT DO NOTHING"
    return text


def schema_to_pg(schema: str) -> list[str]:
    text = re.sub(r"(?im)^PRAGMA .*$", "", schema)
    text = text.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    text = re.sub(r"\bREAL\b", "DOUBLE PRECISION", text)
    text = text.replace("DEFAULT (datetime('now'))", f"DEFAULT ({_NOW_EXPR})")
    return [stmt.strip() for stmt in text.split(";") if stmt.strip()]


class PgRow(dict):
    """Linha que aceita acesso por nome (como sqlite3.Row) e por posição."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _row_factory(cursor):
    names = [c.name for c in cursor.description] if cursor.description else []

    def make(values):
        return PgRow(zip(names, values))

    return make


class PgCursor:
    def __init__(self, cursor, lastrowid=None):
        self._cur = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def fetchmany(self, size=None):
        return self._cur.fetchmany(size) if size else self._cur.fetchmany()

    def __iter__(self):
        return iter(self._cur.fetchall())


def _adapt_params(params):
    if params is None:
        return ()
    return tuple(int(p) if isinstance(p, bool) else p for p in params)


class PgConn:
    """Imita o trecho da API do sqlite3.Connection que o app usa."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        stripped = sql.strip()
        m = re.match(r"(?is)PRAGMA\s+table_info\((\w+)\)", stripped)
        if m:
            cur = self._conn.execute(
                "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s",
                (m.group(1),),
            )
            return PgCursor(cur)
        if re.match(r"(?is)PRAGMA\b", stripped):
            return PgCursor(self._conn.execute("SELECT 1 WHERE false"))
        pg_sql = to_pg(sql)
        want_id = False
        ins = re.match(r"(?is)\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)", sql)
        if ins and ins.group(1) in _SERIAL_TABLES and "RETURNING" not in sql.upper():
            pg_sql += " RETURNING id"
            want_id = True
        cur = self._conn.execute(pg_sql, _adapt_params(params))
        lastrowid = None
        if want_id and cur.description:
            row = cur.fetchone()
            lastrowid = row["id"] if row else None
        return PgCursor(cur, lastrowid)

    def executemany(self, sql, seq):
        pg_sql = to_pg(sql)
        with self._conn.cursor() as cur:
            cur.executemany(pg_sql, [_adapt_params(p) for p in seq])

    def executescript(self, script):
        for stmt in schema_to_pg(script):
            self._conn.execute(stmt)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()


_pool = None
_pool_lock = threading.Lock()


def _conninfo() -> str:
    url = get_settings().database_url.replace("postgres://", "postgresql://", 1)
    host = re.sub(r"^.*@", "", url.split("?")[0]).split("/")[0].split(":")[0]
    if "sslmode=" not in url and host not in ("localhost", "127.0.0.1", "::1"):
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def _get_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                from psycopg_pool import ConnectionPool

                _pool = ConnectionPool(
                    _conninfo(),
                    min_size=1,
                    max_size=int(os.environ.get("PG_POOL_MAX", "8")),
                    # prepare_threshold=None: compatível com o pooler do Supabase (modo transação)
                    kwargs={"row_factory": _row_factory, "prepare_threshold": None},
                    timeout=30,
                    check=ConnectionPool.check_connection,  # descarta conexões que o Supabase fechou por inatividade
                    max_idle=300,
                    open=True,
                )
    return _pool


def reset_pool() -> None:
    """Fecha o pool (usado em testes quando a URL do banco muda)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


import atexit  # noqa: E402

atexit.register(reset_pool)


def sync_sequences(conn) -> None:
    """Depois de inserir ids explícitos (seed), alinha as sequências do Postgres. No SQLite não faz nada."""
    if not is_postgres():
        return
    for table in sorted(_SERIAL_TABLES):
        conn.execute(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
        )


@contextmanager
def get_connection() -> Iterator[Any]:
    if is_postgres():
        with _get_pool().connection() as raw:
            conn = PgConn(raw)
            try:
                yield conn
            except Exception:
                raw.rollback()
                raise
            finally:
                # fim sem commit = descarta (igual ao sqlite3); leituras terminam a transação aqui
                if raw.info.transaction_status != 0:
                    raw.rollback()
        return
    path = _sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(r) for r in rows]  # type: ignore[misc]


def init_db() -> None:
    settings = get_settings()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript(SCHEMA_SQL)
        if is_postgres():
            # Supabase expõe tabelas do schema public via API REST. RLS ligado e sem políticas = ninguém
            # entra por lá (clientes, CPF, pedidos). O servidor usa a conexão direta do Postgres.
            for table in sorted(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", SCHEMA_SQL)):
                conn.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            conn.commit()
        # Lightweight migrations for databases created by older versions.
        profile_columns = {row["name"] for row in conn.execute("PRAGMA table_info(profiles)").fetchall()}
        if "cpf" not in profile_columns:
            conn.execute("ALTER TABLE profiles ADD COLUMN cpf TEXT DEFAULT ''")
        order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "stock_deducted" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0")
        for name, definition in {
            "tracking_code": "TEXT DEFAULT ''",
            "tracking_url": "TEXT DEFAULT ''",
            "admin_notes": "TEXT DEFAULT ''",
        }.items():
            if name not in order_columns:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {name} {definition}")
        item_columns = {row["name"] for row in conn.execute("PRAGMA table_info(order_items)").fetchall()}
        for name, definition in {
            "variant_id": "INTEGER",
            "sku": "TEXT DEFAULT ''",
            "variant_label": "TEXT DEFAULT ''",
        }.items():
            if name not in item_columns:
                conn.execute(f"ALTER TABLE order_items ADD COLUMN {name} {definition}")
        conn.execute(
            "INSERT OR IGNORE INTO coupons (code, discount_type, discount_value, min_order, active) VALUES ('TEODORA10', 'percent', 10, 0, 1)"
        )
        defaults = {
            "hero_eyebrow": "TEODORA",
            "hero_title": "Perfumes originais.\nEntrega em todo o Brasil.",
            "hero_image": "https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?auto=format&fit=crop&w=1400&q=85",
            "hero_button": "Ver produtos",
            "whatsapp_url": "https://wa.me/",
            "instagram_url": "#",
            "facebook_url": "#",
            "youtube_url": "#",
            "pinterest_url": "#",
            "installments": "6",
            "footer_description": "Perfumes originais com entrega para todo o Brasil.",
            "shipping_boxes_json": json.dumps([{
                "id": "cx-unica",
                "nome": "Caixa padrão Teodora",
                "codigo": "CX-01",
                "desc": "Embalagem única de envio — 25 × 20 × 10 cm",
                "altura": 10,
                "largura": 20,
                "comprimento": 25,
                "tara": 0.15,
                "isDefault": True,
            }], ensure_ascii=False),
        }
        conn.executemany(
            "INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)", defaults.items()
        )
        conn.commit()


def parse_json_field(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default
