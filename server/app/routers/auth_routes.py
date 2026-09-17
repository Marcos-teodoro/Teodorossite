from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    register_user,
    require_user,
)
from ..db import get_connection, row_to_dict, rows_to_list
from ..schemas import AddressBody, LoginBody, RegisterBody


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user.get("email"),
        "name": user.get("name") or "",
        "phone": user.get("phone") or "",
        "role": user.get("role") or "customer",
    }


@router.post("/register")
def register(body: RegisterBody):
    user = register_user(body.email, body.password, body.name, body.phone)
    token = create_access_token(user["id"], {"role": user["role"], "email": user["email"]})
    return {"token": token, "user": _public_user(user)}


@router.post("/login")
def login(body: LoginBody):
    user = authenticate_user(body.email, body.password)
    token = create_access_token(user["id"], {"role": user["role"], "email": user["email"]})
    return {"token": token, "user": _public_user(user)}


@router.get("/me")
def me(user: dict = Depends(require_user)):
    return {"user": _public_user(user)}


@router.patch("/me")
def update_me(payload: dict, user: dict = Depends(require_user)):
    name = str(payload.get("name") or user.get("name") or "").strip()
    phone = str(payload.get("phone") or user.get("phone") or "").strip()
    with get_connection() as conn:
        conn.execute(
            "UPDATE profiles SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?",
            (name, phone, user["id"]),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM profiles WHERE id = ?", (user["id"],)).fetchone()
    return {"user": _public_user(row_to_dict(row))}


addresses_router = APIRouter(prefix="/api/addresses", tags=["addresses"])


@addresses_router.get("")
def list_addresses(user: dict = Depends(require_user)):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC",
            (user["id"],),
        ).fetchall()
    return {"addresses": rows_to_list(rows)}


@addresses_router.post("")
def create_address(body: AddressBody, user: dict = Depends(require_user)):
    with get_connection() as conn:
        if body.is_default:
            conn.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (user["id"],))
        cur = conn.execute(
            """
            INSERT INTO addresses (user_id, label, cep, logradouro, numero, complemento, bairro, cidade, uf, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                body.label,
                body.cep,
                body.logradouro,
                body.numero,
                body.complemento,
                body.bairro,
                body.cidade,
                body.uf,
                1 if body.is_default else 0,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM addresses WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"address": row_to_dict(row)}


@addresses_router.put("/{address_id}")
def update_address(address_id: int, body: AddressBody, user: dict = Depends(require_user)):
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT * FROM addresses WHERE id = ? AND user_id = ?", (address_id, user["id"])
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Endereço não encontrado")
        if body.is_default:
            conn.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (user["id"],))
        conn.execute(
            """
            UPDATE addresses SET label=?, cep=?, logradouro=?, numero=?, complemento=?, bairro=?, cidade=?, uf=?, is_default=?
            WHERE id=? AND user_id=?
            """,
            (
                body.label,
                body.cep,
                body.logradouro,
                body.numero,
                body.complemento,
                body.bairro,
                body.cidade,
                body.uf,
                1 if body.is_default else 0,
                address_id,
                user["id"],
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM addresses WHERE id = ?", (address_id,)).fetchone()
    return {"address": row_to_dict(row)}


@addresses_router.delete("/{address_id}")
def delete_address(address_id: int, user: dict = Depends(require_user)):
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM addresses WHERE id = ? AND user_id = ?", (address_id, user["id"])
        )
        conn.commit()
    return {"ok": True}


orders_router = APIRouter(prefix="/api/orders", tags=["orders"])


@orders_router.get("")
def my_orders(user: dict = Depends(require_user)):
    with get_connection() as conn:
        orders = rows_to_list(
            conn.execute(
                "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
                (user["id"],),
            ).fetchall()
        )
        for o in orders:
            o["items"] = rows_to_list(
                conn.execute(
                    "SELECT * FROM order_items WHERE order_id = ?", (o["id"],)
                ).fetchall()
            )
            if isinstance(o.get("shipping_snapshot"), str):
                try:
                    o["shipping_snapshot"] = json.loads(o["shipping_snapshot"])
                except json.JSONDecodeError:
                    o["shipping_snapshot"] = {}
    return {"orders": orders}


@orders_router.get("/{order_id}")
def get_order(order_id: str, user: Optional[dict] = Depends(get_current_user)):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
        order = row_to_dict(row)
        if user and order.get("user_id") and order["user_id"] != user["id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Sem permissão")
        order["items"] = rows_to_list(
            conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
        )
    return {"order": order}
