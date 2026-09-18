from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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
    variant_id: Optional[int] = Field(None, alias="variantId")
    quantity: int = 1

    model_config = {"populate_by_name": True}


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

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        value = value.strip().lower()
        if not value or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789-" for ch in value):
            raise ValueError("Slug deve conter apenas letras minusculas, numeros e hifens")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nome da categoria e obrigatorio")
        return value


class VariantBody(BaseModel):
    id: Optional[int] = None
    label: str
    sku: str = ""
    price: float
    old_price: Optional[float] = None
    stock: int = 0
    active: bool = True

    @model_validator(mode="after")
    def validate_variant(self):
        if not self.label.strip():
            raise ValueError("Nome da variante e obrigatorio")
        if self.price <= 0 or self.stock < 0:
            raise ValueError("Preco e estoque da variante sao invalidos")
        if self.old_price is not None and self.old_price <= self.price:
            raise ValueError("Preco antigo da variante deve ser maior que o atual")
        return self


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
    variants: list[VariantBody] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Titulo deve ter pelo menos 3 caracteres")
        return value

    @field_validator("price", "weight_kg", "height_cm", "width_cm", "length_cm")
    @classmethod
    def validate_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("Valor deve ser maior que zero")
        return value

    @field_validator("stock")
    @classmethod
    def validate_stock(cls, value: int) -> int:
        if value < 0:
            raise ValueError("Estoque nao pode ser negativo")
        return value

    @model_validator(mode="after")
    def validate_prices(self):
        if self.old_price is not None and self.old_price <= self.price:
            raise ValueError("Preco antigo deve ser maior que o preco atual")
        return self


class CouponBody(BaseModel):
    code: str
    discount_type: str = "percent"
    discount_value: float
    min_order: float = 0
    usage_limit: Optional[int] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    active: bool = True

    @model_validator(mode="after")
    def validate_coupon(self):
        self.code = self.code.strip().upper()
        if not self.code or self.discount_type not in {"percent", "fixed"}:
            raise ValueError("Cupom invalido")
        if self.discount_value <= 0 or (self.discount_type == "percent" and self.discount_value > 100):
            raise ValueError("Valor de desconto invalido")
        if self.min_order < 0 or (self.usage_limit is not None and self.usage_limit < 1):
            raise ValueError("Limites do cupom invalidos")
        return self


def product_to_storefront(
    row: dict[str, Any],
    images: list[dict[str, Any]] | None = None,
    variants: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
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
                "id": variant["id"],
                "size": variant["label"],
                "label": variant["label"],
                "sku": variant.get("sku") or "",
                "price": float(variant["price"]),
                "oldPrice": float(variant["old_price"]) if variant.get("old_price") is not None else None,
                "stock": int(variant.get("stock") or 0),
                "active": bool(variant.get("active")),
            }
            for variant in (variants or [])
            if variant.get("active")
        ] or [{
            "id": None,
            "size": row.get("volume") or "100ml",
            "price": float(row["price"]),
            "oldPrice": float(row["old_price"]) if row.get("old_price") is not None else None,
            "stock": int(row.get("stock") or 0),
            "label": row.get("volume") or "100ml",
        }],
        "images": imgs,
    }
