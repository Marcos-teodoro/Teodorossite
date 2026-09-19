from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import require_admin
from ..config import get_settings
from ..db import get_connection, parse_json_field, row_to_dict, rows_to_list
from ..schemas import CouponBody
from ..services import cepcerto
from ..services.cepcerto import SERVICE_CODES, load_shipping_origins, resolve_origin_for_code

router = APIRouter(prefix="/api/admin", tags=["admin"])

ALLOWED_SETTINGS = {
    "hero_eyebrow", "hero_title", "hero_image", "hero_button", "whatsapp_url",
    "instagram_url", "facebook_url", "youtube_url", "pinterest_url",
    "installments", "footer_description",
    "shipper_name", "shipper_doc", "shipper_phone", "shipper_email",
    "shipper_address_number", "shipper_complement",
    "shipping_origins_json",
}


def audit(conn, admin: dict, action: str, entity_type: str, entity_id: str | int | None, details: dict | None = None):
    conn.execute(
        "INSERT INTO admin_audit_log (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
        (admin.get("id"), action, entity_type, str(entity_id) if entity_id is not None else None, json.dumps(details or {}, ensure_ascii=False)),
    )


@router.get("/settings")
def get_settings(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute("SELECT key, value, updated_at FROM site_settings ORDER BY key").fetchall()
    return {"settings": {row["key"]: row["value"] for row in rows}}


@router.put("/settings")
def update_settings(payload: dict, admin: dict = Depends(require_admin)):
    clean = {key: str(value or "") for key, value in payload.items() if key in ALLOWED_SETTINGS}
    with get_connection() as conn:
        for key, value in clean.items():
            conn.execute(
                "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
                (key, value),
            )
        audit(conn, admin, "update", "site_settings", None, {"keys": list(clean)})
        conn.commit()
    return {"settings": clean}


@router.get("/coupons")
def list_coupons(_admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        return {"coupons": rows_to_list(conn.execute("SELECT * FROM coupons ORDER BY id DESC").fetchall())}


@router.post("/coupons")
def create_coupon(body: CouponBody, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO coupons
                (code, discount_type, discount_value, min_order, usage_limit, starts_at, ends_at, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (body.code, body.discount_type, body.discount_value, body.min_order, body.usage_limit, body.starts_at, body.ends_at, 1 if body.active else 0),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Codigo de cupom ja existe ou dados invalidos") from exc
        audit(conn, admin, "create", "coupon", cur.lastrowid, {"code": body.code})
        conn.commit()
        row = conn.execute("SELECT * FROM coupons WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"coupon": row_to_dict(row)}


@router.put("/coupons/{coupon_id}")
def update_coupon(coupon_id: int, body: CouponBody, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute(
            """UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_order=?, usage_limit=?,
            starts_at=?, ends_at=?, active=?, updated_at=datetime('now') WHERE id=?""",
            (body.code, body.discount_type, body.discount_value, body.min_order, body.usage_limit, body.starts_at, body.ends_at, 1 if body.active else 0, coupon_id),
        )
        row = conn.execute("SELECT * FROM coupons WHERE id = ?", (coupon_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Cupom nao encontrado")
        audit(conn, admin, "update", "coupon", coupon_id, {"code": body.code})
        conn.commit()
    return {"coupon": row_to_dict(row)}


@router.delete("/coupons/{coupon_id}")
def deactivate_coupon(coupon_id: int, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        conn.execute("UPDATE coupons SET active=0, updated_at=datetime('now') WHERE id=?", (coupon_id,))
        audit(conn, admin, "deactivate", "coupon", coupon_id)
        conn.commit()
    return {"ok": True}


@router.get("/customers")
def customers(q: str | None = None, _admin: dict = Depends(require_admin)):
    sql = """SELECT p.id, p.email, p.name, p.phone, p.created_at,
      COUNT(o.id) AS orders_count,
      COALESCE(SUM(CASE WHEN o.status IN ('approved','shipped','delivered') THEN o.total ELSE 0 END), 0) AS total_spent
      FROM profiles p LEFT JOIN orders o ON o.user_id = p.id WHERE p.role = 'customer'"""
    params: list = []
    if q:
        sql += " AND (p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)"
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    sql += " GROUP BY p.id ORDER BY p.created_at DESC"
    with get_connection() as conn:
        return {"customers": rows_to_list(conn.execute(sql, params).fetchall())}


@router.get("/orders/{order_id}/detail")
def order_detail(order_id: str, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido nao encontrado")
        order = row_to_dict(row)
        order["items"] = rows_to_list(conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall())
        order["shipping_snapshot"] = parse_json_field(order.get("shipping_snapshot"), {})
        order["history"] = rows_to_list(conn.execute("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC", (order_id,)).fetchall())
    return {"order": order}


@router.patch("/orders/{order_id}/fulfillment")
def update_fulfillment(order_id: str, payload: dict, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido nao encontrado")
        conn.execute(
            "UPDATE orders SET tracking_code=?, tracking_url=?, admin_notes=?, updated_at=datetime('now') WHERE id=?",
            (str(payload.get("tracking_code") or ""), str(payload.get("tracking_url") or ""), str(payload.get("admin_notes") or ""), order_id),
        )
        audit(conn, admin, "update_fulfillment", "order", order_id)
        conn.commit()
    return {"ok": True}


@router.get("/inventory-movements")
def inventory_movements(limit: int = 100, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT m.*, p.title, v.label AS variant_label FROM inventory_movements m
            LEFT JOIN products p ON p.id=m.product_id LEFT JOIN product_variants v ON v.id=m.variant_id
            ORDER BY m.id DESC LIMIT ?""", (max(1, min(limit, 500)),),
        ).fetchall()
    return {"movements": rows_to_list(rows)}


@router.get("/audit")
def audit_log(limit: int = 100, _admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)).fetchall()
    return {"entries": rows_to_list(rows)}


def _site_map(conn) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM site_settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def _shipper_from_settings() -> dict[str, str]:
    conf = get_settings()
    with get_connection() as conn:
        site = _site_map(conn)
    origins = load_shipping_origins()
    default_origin = resolve_origin_for_code("pac", origins)
    return {
        "nome_remetente": site.get("shipper_name") or conf.cepcerto_shipper_name,
        "cpf_cnpj_remetente": site.get("shipper_doc") or conf.cepcerto_shipper_doc,
        "whatsapp_remetente": site.get("shipper_phone") or conf.cepcerto_shipper_phone,
        "email_remetente": site.get("shipper_email") or conf.cepcerto_shipper_email,
        "numero_endereco_remetente": site.get("shipper_address_number") or conf.cepcerto_shipper_address_number or "0",
        "complemento_remetente": site.get("shipper_complement") or conf.cepcerto_shipper_complement or "",
        "cep_remetente": default_origin.get("cep") or conf.cepcerto_origin_cep,
    }


def _checklist(shipper: dict, origins: dict, configured: bool, saldo_ok: bool | None) -> list[dict]:
    items = []
    items.append({"id": "token", "ok": configured, "label": "Token de postagem (Railway)"})
    items.append({
        "id": "shipper_doc",
        "ok": bool(re.sub(r"\D", "", shipper.get("cpf_cnpj_remetente") or "")),
        "label": "CPF/CNPJ do remetente",
    })
    items.append({"id": "shipper_name", "ok": bool((shipper.get("nome_remetente") or "").strip()), "label": "Nome do remetente"})
    origins_ok = any(len((o.get("cep") or "")) == 8 for o in origins.values())
    items.append({"id": "origins", "ok": origins_ok, "label": "Pelo menos um CEP de origem cadastrado"})
    if saldo_ok is not None:
        items.append({"id": "saldo", "ok": saldo_ok, "label": "Saldo CepCerto disponível"})
    return items


@router.get("/cepcerto/status")
async def cepcerto_status(_admin: dict = Depends(require_admin)):
    conf = get_settings()
    shipper = _shipper_from_settings()
    origins = load_shipping_origins()
    out = {
        "configured": bool(conf.cepcerto_postage_token),
        "has_consumption_key": bool(conf.cepcerto_consumption_key),
        "origin_cep": conf.cepcerto_origin_cep,
        "base_url": conf.cepcerto_base_url,
        "shipper": shipper,
        "origins": origins,
        "service_codes": list(SERVICE_CODES),
        "saldo": None,
        "message": "",
        "checklist": [],
        "ready": False,
    }
    saldo_ok = None
    if not conf.cepcerto_postage_token:
        out["message"] = "Defina CEPCERTO_POSTAGE_TOKEN nas variáveis do Railway (só o token)."
        out["checklist"] = _checklist(shipper, origins, False, None)
        return out
    try:
        out["saldo"] = await cepcerto.get_balance()
        num = out["saldo"].get("saldo_numero")
        saldo_ok = num is None or num > 0
    except Exception as exc:
        out["message"] = str(exc)
        saldo_ok = False
    out["checklist"] = _checklist(shipper, origins, True, saldo_ok)
    out["ready"] = all(i["ok"] for i in out["checklist"] if i["id"] != "saldo") and bool(conf.cepcerto_postage_token)
    return out


@router.post("/cepcerto/quote")
async def cepcerto_admin_quote(payload: dict, _admin: dict = Depends(require_admin)):
    try:
        result = await cepcerto.quote_freight(
            dest_cep=str(payload.get("cep") or ""),
            weight_kg=float(payload.get("weight") or 0.5),
            height_cm=float(payload.get("height") or 12),
            width_cm=float(payload.get("width") or 8),
            length_cm=float(payload.get("length") or 8),
            declared_value=float(payload.get("declared_value") or 50),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/cepcerto/track")
async def cepcerto_admin_track(payload: dict, _admin: dict = Depends(require_admin)):
    try:
        return await cepcerto.track_object(
            str(payload.get("codigo") or payload.get("codigo_objeto") or ""),
            str(payload.get("transportadora") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/cepcerto/credit")
async def cepcerto_credit(payload: dict, _admin: dict = Depends(require_admin)):
    try:
        return await cepcerto.create_credit_pix(float(payload.get("valor") or 0))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/cepcerto/spending")
def cepcerto_spending(days: int = 30, _admin: dict = Depends(require_admin)):
    """Agrega custo de etiquetas e frete cobrado dos clientes."""
    days = max(1, min(365, int(days or 30)))
    with get_connection() as conn:
        rows = rows_to_list(
            conn.execute(
                """SELECT id, shipping_cost, shipping_snapshot, created_at, updated_at
                   FROM orders WHERE datetime(updated_at) >= datetime('now', ?)""",
                (f"-{days} days",),
            ).fetchall()
        )
    label_cost = 0.0
    freight_charged = 0.0
    labeled = 0
    for row in rows:
        snap = parse_json_field(row.get("shipping_snapshot"), {})
        label = snap.get("label") or {}
        if label.get("cancelled"):
            continue
        valor = label.get("valor_etiqueta")
        if valor is None:
            continue
        try:
            v = float(valor)
        except (TypeError, ValueError):
            continue
        labeled += 1
        label_cost += v
        freight_charged += float(row.get("shipping_cost") or 0)
    return {
        "days": days,
        "labels_count": labeled,
        "label_cost_total": round(label_cost, 2),
        "freight_charged_total": round(freight_charged, 2),
        "margin_total": round(freight_charged - label_cost, 2),
    }


def _guess_address_number(text: str) -> str:
    if not text:
        return "0"
    m = re.search(r"(?:n[ºo°.]?\s*|,\s*)(\d+[A-Za-z\-]?)", text, re.I)
    if m:
        return m.group(1)
    m = re.search(r"\b(\d{1,5})\b", text)
    return m.group(1) if m else "0"


@router.post("/orders/{order_id}/label")
async def create_order_label(
    order_id: str,
    payload: dict = Body(default_factory=dict),
    admin: dict = Depends(require_admin),
):
    """Gera etiqueta CepCerto (declaração) para o pedido e salva rastreio + custo."""
    payload = payload or {}
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
        order = row_to_dict(row)
        items = rows_to_list(conn.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall())
        snap = parse_json_field(order.get("shipping_snapshot"), {})

    existing = snap.get("label") or {}
    if existing.get("codigo_objeto") and not existing.get("cancelled") and not payload.get("force"):
        return {
            "label": {
                "ok": True,
                "mensagem": "Etiqueta já emitida — reabrindo dados salvos.",
                "codigo_objeto": existing.get("codigo_objeto"),
                "pdf_url_etiqueta": existing.get("pdf_url_etiqueta"),
                "pdf_url_dce": existing.get("pdf_url_dce"),
                "valor_etiqueta": existing.get("valor_etiqueta"),
                "valor": existing.get("valor_etiqueta"),
                "servico": existing.get("servico"),
                "origin_cep": existing.get("originCep") or existing.get("origin_cep"),
                "request_id": existing.get("request_id"),
                "reused": True,
            },
            "order_id": order_id,
            "reused": True,
        }

    shipper = _shipper_from_settings()
    if not re.sub(r"\D", "", shipper.get("cpf_cnpj_remetente") or ""):
        raise HTTPException(status_code=400, detail="Cadastre o CPF/CNPJ do remetente em Admin → CepCerto.")

    dest_cep = (
        payload.get("cep_destinatario")
        or snap.get("cep")
        or (snap.get("address") or {}).get("cep")
        or ""
    )
    dest_cep = re.sub(r"\D", "", str(dest_cep))
    if len(dest_cep) != 8:
        raise HTTPException(status_code=400, detail="Informe o CEP do destinatário (8 dígitos) para gerar a etiqueta.")

    product_ids = [i["product_id"] for i in items if i.get("product_id")]
    weight = float(payload.get("peso") or 0)
    height = float(payload.get("altura") or 0)
    width = float(payload.get("largura") or 0)
    length = float(payload.get("comprimento") or 0)
    if product_ids and (not weight or not height):
        with get_connection() as conn:
            prows = rows_to_list(
                conn.execute(
                    f"SELECT weight_kg, height_cm, width_cm, length_cm FROM products WHERE id IN ({','.join('?' * len(product_ids))})",
                    product_ids,
                ).fetchall()
            )
        if prows:
            weight = weight or sum(float(p["weight_kg"] or 0.5) for p in prows)
            height = height or max(float(p["height_cm"] or 12) for p in prows)
            width = width or max(float(p["width_cm"] or 8) for p in prows)
            length = length or max(float(p["length_cm"] or 8) for p in prows)
    weight = max(0.1, weight or 0.5)
    height = max(1.0, height or 12)
    width = max(1.0, width or 8)
    length = max(1.0, length or 8)
    while height + width + length > 200:
        height = max(1, height * 0.9)
        width = max(1, width * 0.9)
        length = max(1, length * 0.9)

    declared = float(payload.get("valor_encomenda") or order.get("merchandise") or order.get("total") or 50)
    declared = max(50.0, min(35000.0, declared))

    produtos = []
    for item in items:
        produtos.append(
            {
                "descricao": (item.get("title") or "Produto")[:80],
                "valor": f"{float(item.get('unit_price') or 0):.2f}",
                "quantidade": int(item.get("quantity") or 1),
            }
        )
    if not produtos:
        produtos = [{"descricao": "Pedido Teodora", "valor": f"{declared:.2f}", "quantidade": 1}]

    tipo = payload.get("tipo_entrega") or snap.get("code") or "pac"
    origin_info = resolve_origin_for_code(str(tipo).replace("-", "_"))
    origin_cep = (
        payload.get("cep_remetente")
        or snap.get("originCep")
        or origin_info.get("cep")
        or ""
    )

    request_id = existing.get("request_id") if existing.get("request_id") and payload.get("force") else None
    request_id = str(payload.get("request_id") or request_id or f"teodora-{order_id}")

    body = {
        **shipper,
        "request_id": request_id,
        "tipo_entrega": tipo,
        "cep_remetente": origin_cep,
        "cep_destinatario": dest_cep,
        "peso": f"{weight:.3f}",
        "altura": f"{height:.0f}",
        "largura": f"{width:.0f}",
        "comprimento": f"{length:.0f}",
        "valor_encomenda": f"{declared:.2f}",
        "nome_destinatario": payload.get("nome_destinatario") or order.get("payer_name") or "",
        "cpf_cnpj_destinatario": payload.get("cpf_cnpj_destinatario") or order.get("payer_doc") or "",
        "whatsapp_destinatario": payload.get("whatsapp_destinatario") or order.get("payer_phone") or "",
        "email_destinatario": payload.get("email_destinatario") or order.get("payer_email") or "",
        "numero_endereco_destinatario": str(
            payload.get("numero_endereco_destinatario")
            or snap.get("address_number")
            or _guess_address_number(order.get("payer_address") or "")
        ),
        "complemento_destinatario": payload.get("complemento_destinatario") or snap.get("address_complement") or "",
        "produtos": produtos,
    }
    if payload.get("numero_endereco_destinatario"):
        body["numero_endereco_destinatario"] = str(payload["numero_endereco_destinatario"])

    for key in (
        "nome_remetente", "cpf_cnpj_remetente", "whatsapp_remetente", "email_remetente",
        "numero_endereco_remetente", "complemento_remetente", "cep_remetente",
    ):
        if payload.get(key):
            body[key] = payload[key]

    try:
        label = await cepcerto.create_label(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    tracking = label.get("codigo_objeto") or ""
    pdf = label.get("pdf_url_etiqueta") or ""
    valor_et = label.get("valor_etiqueta") if label.get("valor_etiqueta") is not None else label.get("valor")
    try:
        valor_et = float(valor_et) if valor_et is not None else None
    except (TypeError, ValueError):
        valor_et = None

    note_extra = f"Etiqueta CepCerto: {tracking}"
    if valor_et is not None:
        note_extra += f" | custo R$ {valor_et:.2f}"
    if pdf:
        note_extra += f" | PDF: {pdf}"

    emitido_em = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        prev_notes = order.get("admin_notes") or ""
        notes = (prev_notes + ("\n" if prev_notes else "") + note_extra).strip()
        conn.execute(
            """UPDATE orders SET tracking_code=?, tracking_url=?, admin_notes=?,
               status=CASE WHEN status IN ('pending','approved') THEN 'shipped' ELSE status END,
               updated_at=datetime('now') WHERE id=?""",
            (tracking or order.get("tracking_code") or "", pdf or order.get("tracking_url") or "", notes, order_id),
        )
        snap2 = dict(snap)
        snap2["cep"] = dest_cep
        snap2["originCep"] = label.get("origin_cep") or origin_cep
        snap2["originLabel"] = label.get("origin_label") or origin_info.get("label") or ""
        snap2["label"] = {
            "codigo_objeto": tracking,
            "pdf_url_etiqueta": pdf,
            "pdf_url_dce": label.get("pdf_url_dce") or "",
            "request_id": label.get("request_id") or request_id,
            "servico": label.get("servico"),
            "valor_etiqueta": valor_et,
            "originCep": snap2["originCep"],
            "originLabel": snap2["originLabel"],
            "emitido_em": emitido_em,
            "cancelled": False,
        }
        conn.execute(
            "UPDATE orders SET shipping_snapshot=? WHERE id=?",
            (json.dumps(snap2, ensure_ascii=False), order_id),
        )
        audit(
            conn,
            admin,
            "create_label",
            "order",
            order_id,
            {"codigo": tracking, "request_id": request_id, "valor_etiqueta": valor_et},
        )
        conn.commit()

    shipping_cost = float(order.get("shipping_cost") or 0)
    margin = None if valor_et is None else round(shipping_cost - valor_et, 2)
    return {
        "label": label,
        "order_id": order_id,
        "freight_charged": shipping_cost,
        "label_cost": valor_et,
        "margin": margin,
        "reused": False,
    }


@router.post("/orders/{order_id}/label/cancel")
async def cancel_order_label(order_id: str, admin: dict = Depends(require_admin)):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
        order = row_to_dict(row)
        snap = parse_json_field(order.get("shipping_snapshot"), {})
    label = snap.get("label") or {}
    codigo = label.get("codigo_objeto") or order.get("tracking_code") or ""
    if not codigo:
        raise HTTPException(status_code=400, detail="Pedido sem código de objeto para cancelar.")
    if label.get("cancelled"):
        return {"ok": True, "mensagem": "Etiqueta já estava cancelada.", "cancel": label}

    try:
        result = await cepcerto.cancel_shipment(codigo)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    with get_connection() as conn:
        snap2 = dict(snap)
        lab = dict(label)
        lab["cancelled"] = True
        lab["cancelled_em"] = datetime.now(timezone.utc).isoformat()
        lab["valor_estorno"] = result.get("valor_estorno")
        snap2["label"] = lab
        notes = (order.get("admin_notes") or "") + f"\nCancelamento CepCerto: {codigo} — {result.get('mensagem')}"
        conn.execute(
            "UPDATE orders SET shipping_snapshot=?, admin_notes=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(snap2, ensure_ascii=False), notes.strip(), order_id),
        )
        audit(conn, admin, "cancel_label", "order", order_id, {"codigo": codigo})
        conn.commit()

    return {"ok": True, "cancel": result, "order_id": order_id}
