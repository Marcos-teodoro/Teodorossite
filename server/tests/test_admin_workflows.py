import os
import tempfile
import unittest
from pathlib import Path


_db_file = tempfile.NamedTemporaryFile(prefix="teodora-test-", suffix=".db", delete=False)
_db_file.close()
Path(_db_file.name).unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_db_file.name).as_posix()}"

from fastapi.testclient import TestClient

from app.main import app


class AdminWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()
        admin_login = cls.client.post(
            "/api/auth/login",
            json={"email": "admin@gmail.com", "password": "Admin123!"},
        )
        assert admin_login.status_code == 200, admin_login.text
        cls.admin_headers = {"Authorization": f"Bearer {admin_login.json()['token']}"}

        customer = cls.client.post(
            "/api/auth/register",
            json={"email": "cliente@teste.com", "password": "Senha123!", "name": "Cliente Teste"},
        )
        assert customer.status_code == 200, customer.text
        cls.customer_headers = {"Authorization": f"Bearer {customer.json()['token']}"}

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        Path(_db_file.name).unlink(missing_ok=True)

    def test_complete_admin_commerce_workflow(self):
        product_payload = {
            "title": "Perfume de Teste",
            "brand_tag": "TEODORA",
            "volume": "50 ml",
            "category_slug": "perfumes",
            "price": 100,
            "stock": 8,
            "variants": [
                {"label": "50 ml", "sku": "TESTE-50", "price": 100, "stock": 3},
                {"label": "100 ml", "sku": "TESTE-100", "price": 160, "stock": 5},
            ],
        }
        product_response = self.client.post(
            "/api/admin/products", json=product_payload, headers=self.admin_headers
        )
        self.assertEqual(product_response.status_code, 200, product_response.text)
        product = product_response.json()["product"]
        self.assertEqual(product["stock"], 8)
        self.assertEqual(len(product["variants"]), 2)
        variant_id = product["variants"][0]["id"]

        product_payload["variants"][0].update({"id": variant_id, "stock": 4})
        product_payload["variants"][1]["id"] = product["variants"][1]["id"]
        updated_product = self.client.put(
            f"/api/admin/products/{product['id']}",
            json=product_payload,
            headers=self.admin_headers,
        )
        self.assertEqual(updated_product.status_code, 200, updated_product.text)
        self.assertEqual(updated_product.json()["product"]["variants"][0]["id"], variant_id)

        coupon_response = self.client.post(
            "/api/admin/coupons",
            json={
                "code": "TESTE20",
                "discount_type": "percent",
                "discount_value": 20,
                "min_order": 50,
                "active": True,
            },
            headers=self.admin_headers,
        )
        self.assertEqual(coupon_response.status_code, 200, coupon_response.text)

        coupon_public = self.client.get(
            "/api/storefront/coupon", params={"code": "teste20", "subtotal": 100}
        )
        self.assertEqual(coupon_public.status_code, 200, coupon_public.text)
        self.assertEqual(coupon_public.json()["coupon"]["discount"], 20)

        checkout = self.client.post(
            "/api/checkout/prepare",
            json={
                "items": [{"id": product["id"], "variantId": variant_id, "quantity": 1}],
                "shippingCost": 0,
                "couponCode": "TESTE20",
                "paymentHint": "pix",
                "payer": {"name": "Cliente Teste", "email": "cliente@teste.com"},
            },
            headers=self.customer_headers,
        )
        self.assertEqual(checkout.status_code, 200, checkout.text)
        self.assertEqual(checkout.json()["amount"], 80)
        order_id = checkout.json()["orderId"]

        approved = self.client.patch(
            f"/api/admin/orders/{order_id}",
            json={"status": "approved"},
            headers=self.admin_headers,
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        after_sale = self.client.get(
            f"/api/admin/products/{product['id']}", headers=self.admin_headers
        ).json()["product"]
        self.assertEqual(after_sale["variants"][0]["stock"], 3)

        cancelled = self.client.patch(
            f"/api/admin/orders/{order_id}",
            json={"status": "cancelled"},
            headers=self.admin_headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        restored = self.client.get(
            f"/api/admin/products/{product['id']}", headers=self.admin_headers
        ).json()["product"]
        self.assertEqual(restored["variants"][0]["stock"], 4)

        detail = self.client.get(
            f"/api/admin/orders/{order_id}/detail", headers=self.admin_headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["order"]["items"][0]["sku"], "TESTE-50")
        self.assertEqual(len(detail.json()["order"]["history"]), 2)

        settings = self.client.put(
            "/api/admin/settings",
            json={"hero_title": "Nova vitrine", "installments": "10", "ignored": "no"},
            headers=self.admin_headers,
        )
        self.assertEqual(settings.status_code, 200, settings.text)
        public_settings = self.client.get("/api/storefront/config").json()["settings"]
        self.assertEqual(public_settings["hero_title"], "Nova vitrine")
        self.assertEqual(public_settings["installments"], "10")
        self.assertNotIn("ignored", public_settings)


if __name__ == "__main__":
    unittest.main()
