import json
import sqlite3
from contextlib import contextmanager
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
  weight_kg REAL NOT NULL DEFAULT 0.5,
  height_cm REAL NOT NULL DEFAULT 12,
  width_cm REAL NOT NULL DEFAULT 8,
  length_cm REAL NOT NULL DEFAULT 8,
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


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
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
        # Lightweight migrations for databases created by older versions.
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
