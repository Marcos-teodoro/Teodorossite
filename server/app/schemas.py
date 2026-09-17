from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, Field


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str = ""
    phone: str = ""


class LoginBody(BaseModel):
    email: str
    password: str


class AddressBody(BaseModel):
    label: str = "Casa"
    cep: str
    logradouro: str = ""
    numero: str = ""
    complemento: str = ""
    bairro: str = ""
    cidade: str = ""
    uf: str = ""
    is_default: bool = False


class CartItem(BaseModel):
    id: int
    quantity: int = 1


class PrepareBody(BaseModel):
    items: list[CartItem]
    shipping_cost: float = Field(0, alias="shippingCost")
    coupon_code: str = Field("", alias="couponCode")
    payment_hint: str = Field("pix", alias="paymentHint")
    shipping_option: Optional[dict[str, Any]] = Field(None, alias="shippingOption")
    payer: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class PaymentBody(BaseModel):
    order_id: str = Field(..., alias="orderId")
    form_data: dict[str, Any] = Field(..., alias="formData")

    model_config = {"populate_by_name": True}


class CategoryBody(BaseModel):
    slug: str
    name: str
    sort_order: int = 0
    active: bool = True
    image_url: Optional[str] = None


class ProductBody(BaseModel):
    title: str
    brand_tag: str = ""
    volume: str = ""
    category_slug: str = "perfumes"
    family: str = "floral"
    intensity: str = "edp"
    occasion: str = "dia"
    sensation: str = "romantico"
    price: float
    old_price: Optional[float] = None
    badge: str = ""
    notes: str = ""
    description: str = ""
    ritual: str = ""
    ingredients: str = ""
    pyramid_top: str = ""
    pyramid_heart: str = ""
    pyramid_base: str = ""
    similar_ids: list[int] = Field(default_factory=list)
    stock: int = 50
    active: bool = True
    weight_kg: float = 0.5
    height_cm: float = 12
    width_cm: float = 8
    length_cm: float = 8
    cover_image: Optional[str] = None


def product_to_storefront(row: dict[str, Any], images: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    imgs = images or []
    cover = row.get("cover_image") or (imgs[0]["url"] if imgs else "")
    gallery = [i["url"] for i in imgs] if imgs else ([cover] * 4 if cover else [])
    similar = row.get("similar_ids")
    if isinstance(similar, str):
        try:
            similar = json.loads(similar)
        except json.JSONDecodeError:
            similar = []
    return {
        "id": row["id"],
        "title": row["title"],
        "brandTag": row.get("brand_tag") or "",
        "volume": row.get("volume") or "",
        "category": row.get("category_slug") or "perfumes",
        "family": row.get("family") or "floral",
        "intensity": row.get("intensity") or "edp",
        "occasion": row.get("occasion") or "dia",
        "sensation": row.get("sensation") or "romantico",
        "price": float(row["price"]),
        "oldPrice": float(row["old_price"]) if row.get("old_price") is not None else None,
        "badge": row.get("badge") or "",
        "image": cover,
        "gallery": gallery or [cover],
        "notes": row.get("notes") or "",
        "description": row.get("description") or "",
        "ritual": row.get("ritual") or "Borrife nos pulsos e na nuca.",
        "ingredients": row.get("ingredients") or "",
        "pyramid": {
            "top": row.get("pyramid_top") or "Notas de saída",
            "heart": row.get("pyramid_heart") or "Notas de coração",
            "base": row.get("pyramid_base") or "Notas de fundo",
        },
        "similarIds": similar or [],
        "rating": float(row.get("rating") or 4.8),
        "reviews": int(row.get("reviews") or 48),
        "stock": int(row.get("stock") or 0),
        "active": bool(row.get("active")),
        "weightKg": float(row.get("weight_kg") or 0.5),
        "heightCm": float(row.get("height_cm") or 12),
        "widthCm": float(row.get("width_cm") or 8),
        "lengthCm": float(row.get("length_cm") or 8),
        "variants": [
            {
                "size": row.get("volume") or "100ml",
                "price": float(row["price"]),
                "label": row.get("volume") or "100ml",
            }
        ],
        "images": imgs,
    }
