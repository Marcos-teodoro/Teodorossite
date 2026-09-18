# TEODORA — Perfumes

Loja + painel admin + API (FastAPI) com Mercado Pago Payment Brick e frete CepCerto.

## Rodar

```powershell
# somente ao alterar classes/tema da vitrine
npm install
npm run build:css

cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# configure server/.env (MP_*, CEPCERTO_* opcional)
uvicorn app.main:app --reload --port 3001
```

- Loja: http://localhost:3001/
- Conta: http://localhost:3001/conta.html
- Admin: http://localhost:3001/admin/ (`admin@gmail.com`)

Detalhes em [server/README.md](server/README.md). Schema Supabase em [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql).

## Validar

```powershell
cd server
python -m unittest tests.test_admin_workflows -v
```
