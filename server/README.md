# Teodora API (FastAPI)

Backend da loja: catálogo, conta, admin, frete [CepCerto](https://cepcerto.com/area-restrita/documentacao), pagamento Mercado Pago (Payment Brick).

Schema SQL para Supabase: [`../supabase/migrations/001_init.sql`](../supabase/migrations/001_init.sql). Em desenvolvimento o BFF usa SQLite local (`teodora.db`) com o mesmo modelo.

## Setup

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# preencha MP_ACCESS_TOKEN, MP_PUBLIC_KEY e (opcional) CEPCERTO_POSTAGE_TOKEN
uvicorn app.main:app --reload --port 3001
```

Abra:

- Loja: http://localhost:3001/
- Conta: http://localhost:3001/conta.html
- Admin: http://localhost:3001/admin/

Admin padrão (seed): `admin@gmail.com` (UID Supabase configurável via `ADMIN_USER_ID`)


## Variáveis

| Variável | Uso |
|----------|-----|
| `MP_ACCESS_TOKEN` / `MP_PUBLIC_KEY` | Mercado Pago (token só no servidor) |
| `CEPCERTO_POSTAGE_TOKEN` | Cotação real `POST /api-cotacao-frete/` |
| `CEPCERTO_CONSUMPTION_KEY` | Opcional: CEP via `/ws/json/...` |
| `CEPCERTO_ORIGIN_CEP` | CEP remetente Teodora |
| `SUPABASE_*` | Opcional — projeto remoto + JWT |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed do primeiro admin |

Sem token CepCerto, a API devolve cotação **estimada** (marcação `demo: true`) para o front continuar testável.

Coleção Postman CepCerto: https://documenter.getpostman.com/view/44371012/2sBYArTru8

## Rotas principais

- `GET /api/health` · `GET /api/config`
- `GET /api/catalog/products` · `GET /api/catalog/categories`
- `GET /api/shipping/quote` · `GET /api/shipping/cep/{cep}`
- `POST /api/auth/register|login` · `GET/PATCH /api/auth/me`
- `CRUD /api/addresses` · `GET /api/orders`
- `POST /api/checkout/prepare` · `POST /api/payments` · `POST /api/webhooks/mercadopago`
- ` /api/admin/*` (dashboard, products, categories, orders, upload fotos)

## Express Node (legado)

O `index.js` (Checkout Pro redirect) ficou obsoleto. Use este FastAPI.

## Supabase

1. Crie o projeto no Supabase  
2. Rode `supabase/migrations/001_init.sql`  
3. Preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`  
4. O BFF valida JWT do Supabase quando `SUPABASE_JWT_SECRET` estiver definido; o catálogo operacional continua no SQLite até você migrar os dados (export/`seed_products.json`).
