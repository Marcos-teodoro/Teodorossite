"""Seed categories + products from legacy catalog / static product dump."""
from __future__ import annotations

import json
from pathlib import Path

from ..auth import hash_password
from ..config import get_settings
from ..db import get_connection

CATEGORIES = [
    ("perfumes", "Perfumes", 1),
    ("skincare", "Skincare", 2),
    ("maquiagem", "Maquiagem", 3),
    ("cabelos", "Cabelos", 4),
    ("corpo", "Corpo & Banho", 5),
    ("kits", "Kits", 6),
]

# Fallback minimal products if seed file missing (ids align with catalog.json)
DEFAULT_IMAGE = "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=900&q=85"


def _load_seed_products() -> list[dict]:
    root = Path(__file__).resolve().parents[2]  # server/
    seed_path = root / "seed_products.json"
    if seed_path.exists():
        return json.loads(seed_path.read_text(encoding="utf-8"))

    catalog_path = root / "catalog.json"
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        products = []
        for row in catalog:
            products.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "brand_tag": row["title"].split(" ")[0].upper(),
                    "volume": "100ml",
                    "category_slug": "kits" if "Coffret" in row["title"] or "Kit" in row["title"] else "perfumes",
                    "price": row["price"],
                    "old_price": None,
                    "badge": "",
                    "notes": "",
                    "cover_image": DEFAULT_IMAGE,
                    "similar_ids": [],
                }
            )
        return products
    return []


def seed_if_empty() -> None:
    settings = get_settings()
    with get_connection() as conn:
        cat_count = conn.execute("SELECT COUNT(*) AS c FROM categories").fetchone()["c"]
        if cat_count == 0:
            for slug, name, order in CATEGORIES:
                conn.execute(
                    "INSERT INTO categories (slug, name, sort_order) VALUES (?, ?, ?)",
                    (slug, name, order),
                )

        prod_count = conn.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        if prod_count == 0:
            products = _load_seed_products()
            slug_to_id = {
                r["slug"]: r["id"]
                for r in conn.execute("SELECT id, slug FROM categories").fetchall()
            }
            for p in products:
                slug = p.get("category_slug") or "perfumes"
                cur = conn.execute(
                    """
                    INSERT INTO products (
                      id, title, brand_tag, volume, category_id, category_slug,
                      family, intensity, occasion, sensation, price, old_price, badge,
                      notes, description, cover_image, similar_ids, stock, active,
                      weight_kg, height_cm, width_cm, length_cm
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0.5, 12, 8, 8)
                    """,
                    (
                        p.get("id"),
                        p["title"],
                        p.get("brand_tag") or "",
                        p.get("volume") or "100ml",
                        slug_to_id.get(slug),
                        slug,
                        p.get("family") or "floral",
                        p.get("intensity") or "edp",
                        p.get("occasion") or "dia",
                        p.get("sensation") or "romantico",
                        float(p["price"]),
                        p.get("old_price"),
                        p.get("badge") or "",
                        p.get("notes") or "",
                        p.get("description") or f'{p["title"]}. Perfume original.',
                        p.get("cover_image") or DEFAULT_IMAGE,
                        json.dumps(p.get("similar_ids") or []),
                        int(p.get("stock") or 50),
                    ),
                )
                image = p.get("cover_image") or DEFAULT_IMAGE
                pid = p.get("id") or cur.lastrowid
                conn.execute(
                    """
                    INSERT INTO product_images (product_id, url, sort_order, is_cover)
                    VALUES (?, ?, 0, 1)
                    """,
                    (pid, image),
                )

        # Garante admin oficial (e-mail + UID Supabase)
        admin_id = settings.admin_user_id
        admin_email = settings.admin_email.lower()
        pwd = hash_password(settings.admin_password)
        by_id = conn.execute("SELECT id FROM profiles WHERE id = ?", (admin_id,)).fetchone()
        by_email = conn.execute(
            "SELECT id FROM profiles WHERE email = ?", (admin_email,)
        ).fetchone()
        if by_id:
            conn.execute(
                """
                UPDATE profiles
                SET email = ?, name = COALESCE(NULLIF(name, ''), 'Admin Teodora'),
                    role = 'admin', password_hash = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (admin_email, pwd, admin_id),
            )
        elif by_email and by_email["id"] != admin_id:
            conn.execute("DELETE FROM profiles WHERE id = ?", (by_email["id"],))
            conn.execute(
                """
                INSERT INTO profiles (id, email, name, role, password_hash)
                VALUES (?, ?, 'Admin Teodora', 'admin', ?)
                """,
                (admin_id, admin_email, pwd),
            )
        else:
            conn.execute(
                """
                INSERT INTO profiles (id, email, name, role, password_hash)
                VALUES (?, ?, 'Admin Teodora', 'admin', ?)
                """,
                (admin_id, admin_email, pwd),
            )
        conn.execute(
            "DELETE FROM profiles WHERE email = ? AND id != ?",
            ("admin@teodora.local", admin_id),
        )
        conn.commit()
