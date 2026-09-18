from __future__ import annotations

from fastapi import HTTPException


def transition_order_stock(conn, order_id: str, new_status: str) -> None:
    """Apply or reverse stock once when an order crosses an approved boundary."""
    order = conn.execute(
        "SELECT status, stock_deducted FROM orders WHERE id = ?", (order_id,)
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido nao encontrado")

    items = conn.execute(
        "SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ?", (order_id,)
    ).fetchall()

    if new_status in {"approved", "shipped", "delivered"} and not order["stock_deducted"]:
        for item in items:
            if item["product_id"] is None:
                continue
            product = conn.execute("SELECT stock, title FROM products WHERE id = ?", (item["product_id"],)).fetchone()
            available = product["stock"] if product else 0
            if item["variant_id"] is not None:
                variant = conn.execute(
                    "SELECT stock FROM product_variants WHERE id = ? AND product_id = ?",
                    (item["variant_id"], item["product_id"]),
                ).fetchone()
                available = variant["stock"] if variant else 0
            if not product or available < item["quantity"]:
                title = product["title"] if product else str(item["product_id"])
                raise HTTPException(status_code=409, detail=f"Estoque insuficiente para {title}")
        for item in items:
            if item["product_id"] is not None:
                if item["variant_id"] is not None:
                    conn.execute("UPDATE product_variants SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?", (item["quantity"], item["variant_id"]))
                    balance = conn.execute("SELECT stock FROM product_variants WHERE id = ?", (item["variant_id"],)).fetchone()["stock"]
                    conn.execute("UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = ? AND active = 1), updated_at = datetime('now') WHERE id = ?", (item["product_id"], item["product_id"]))
                else:
                    conn.execute("UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?", (item["quantity"], item["product_id"]))
                    balance = conn.execute("SELECT stock FROM products WHERE id = ?", (item["product_id"],)).fetchone()["stock"]
                conn.execute(
                    "INSERT INTO inventory_movements (product_id, variant_id, order_id, movement_type, quantity, balance_after) VALUES (?, ?, ?, 'sale', ?, ?)",
                    (item["product_id"], item["variant_id"], order_id, -item["quantity"], balance),
                )
        coupon = conn.execute("SELECT coupon_code FROM orders WHERE id = ?", (order_id,)).fetchone()
        if coupon and coupon["coupon_code"]:
            conn.execute("UPDATE coupons SET uses_count = uses_count + 1 WHERE code = ?", (coupon["coupon_code"],))
        conn.execute("UPDATE orders SET stock_deducted = 1 WHERE id = ?", (order_id,))

    if new_status in {"cancelled", "rejected"} and order["stock_deducted"]:
        for item in items:
            if item["product_id"] is not None:
                if item["variant_id"] is not None:
                    conn.execute("UPDATE product_variants SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?", (item["quantity"], item["variant_id"]))
                    balance = conn.execute("SELECT stock FROM product_variants WHERE id = ?", (item["variant_id"],)).fetchone()["stock"]
                    conn.execute("UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = ? AND active = 1), updated_at = datetime('now') WHERE id = ?", (item["product_id"], item["product_id"]))
                else:
                    conn.execute("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?", (item["quantity"], item["product_id"]))
                    balance = conn.execute("SELECT stock FROM products WHERE id = ?", (item["product_id"],)).fetchone()["stock"]
                conn.execute(
                    "INSERT INTO inventory_movements (product_id, variant_id, order_id, movement_type, quantity, balance_after) VALUES (?, ?, ?, 'restock', ?, ?)",
                    (item["product_id"], item["variant_id"], order_id, item["quantity"], balance),
                )
        coupon = conn.execute("SELECT coupon_code FROM orders WHERE id = ?", (order_id,)).fetchone()
        if coupon and coupon["coupon_code"]:
            conn.execute("UPDATE coupons SET uses_count = MAX(0, uses_count - 1) WHERE code = ?", (coupon["coupon_code"],))
        conn.execute("UPDATE orders SET stock_deducted = 0 WHERE id = ?", (order_id,))
